import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, lstat, readdir } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { connectLease, DesktopClient } from "../src/desktop/client.ts";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 6000) {
 const end = performance.now() + timeout;
 while (performance.now() < end) { if (await check()) return; await sleep(50); }
 assert.fail(message);
}
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
type Recording = { phase: string; cue: string; path: string; pid: number; parent: number; time: number };

test("native lifecycle ownership with recording-only player", { skip: process.platform !== "darwin", timeout: 150_000 }, async t => {
 const root = await mkdtemp("/tmp/fairy-lifecycle-test-");
 const source = fileURLToPath(new URL("../native/Fairy.swift", import.meta.url));
 const assets = fileURLToPath(new URL("../assets", import.meta.url));
 const sounds = fileURLToPath(new URL("../../voice/sounds", import.meta.url));
 const children: ChildProcess[] = [], sockets: Socket[] = [];
 await promisify(execFile)("/usr/bin/swiftc", [source, "-o", root + "/Fairy"], { timeout: 120_000 });
 async function fixture(name: string) {
  const dir = await mkdtemp(root + "/" + name);
  const log = dir + "/recordings";
  // This executable only records argv/parentage. No shell, afplay, or audio device.
  await writeFile(dir + "/player", `#!/usr/bin/python3
import os,sys,json,time,signal,pathlib
base=pathlib.Path(__file__).parent
cue=pathlib.Path(sys.argv[1]).name.split('-')[0]
def record(phase):
 with open(base/'recordings','a') as f: f.write(json.dumps(dict(phase=phase,cue=cue,path=sys.argv[1],pid=os.getpid(),parent=os.getppid(),time=time.monotonic()))+'\\n')
record('start')
mode=(base/'mode').read_text() if (base/'mode').exists() else ''
if mode == 'hang' or mode == 'hang-'+cue:
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 time.sleep(60)
else: time.sleep(0.5 if cue == 'welcome' else 1.5)
record('finish')
`, { mode: 0o700 });
  const records = async (): Promise<Recording[]> => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const starts = async () => (await records()).filter(r => r.phase === "start");
  const launch = (gui = false, audio = true) => {
   const child = spawn(root + "/Fairy", [dir, assets, ...(gui ? [] : ["--headless"]), ...(audio ? ["--lifecycle-sounds", sounds, "--lifecycle-player", dir + "/player"] : [])], {
    stdio: ["ignore", "ignore", "pipe"], env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", FAIRY_SETTINGS_DIRECTORY: dir + "/settings" },
   });
   child.stderr?.on("data", d => process.stderr.write(d)); children.push(child); return child;
  };
  const connect = async () => {
   let socket: Socket | undefined;
   await until(async () => { try { socket = await connectLease(dir + "/sock"); return true; } catch { return false; } }, "valid lease connects");
   sockets.push(socket!); return socket!;
  };
  const raw = async (text?: string) => {
   const socket = createConnection(dir + "/sock"); sockets.push(socket); socket.on("error", () => {}); socket.resume();
   await new Promise<void>(r => socket.once("connect", r));
   if (text) socket.write(text);
   return socket;
  };
  return { dir, records, starts, launch, connect, raw };
 }
 try {
  await t.test("cold helper, silent peer, malformed probe and animation-only launch are silent", async () => {
   const f = await fixture("cold-"); const owner = f.launch();
   await until(async () => !!await lstat(f.dir + "/sock").catch(() => undefined), "socket exists");
   const silent = await f.raw(), bad = await f.raw("not a lease\n");
   await until(() => silent.destroyed && bad.destroyed, "unqualified peers expire");
   await until(() => !alive(owner), "cold helper exits after 3s");
   assert.deepEqual(await f.records(), []);
   await assert.rejects(lstat(f.dir + "/sock"), { code: "ENOENT" });
   const standalone = f.launch(false, false), lease = await f.connect();
   await sleep(200); lease.destroy(); await until(() => !alive(standalone), "animation-only helper exits");
   assert.deepEqual(await f.records(), []);
  });
  await t.test("eight launches, first/last leases, reconnect in grace, owner lock and native GUI visibility", async () => {
   const f = await fixture("shared-");
   const contenders = Array.from({ length: 8 }, () => f.launch(true));
   const a = await f.connect(), b = await f.connect();
   await until(async () => (await f.starts()).length === 1, "first welcome");
   assert.equal(contenders.filter(alive).length, 1, "losing locks never play");
   const owner = contenders.find(alive)!;
   assert.equal((await f.starts())[0].parent, owner.pid, "helper, not Pi, owns player");
   a.destroy(); await sleep(3300);
   assert.deepEqual((await f.starts()).map(r => r.cue), ["welcome"]);
   b.destroy(); await sleep(2200); const c = await f.connect(); await sleep(1200);
   assert.deepEqual((await f.starts()).map(r => r.cue), ["welcome"], "grace reconnect emits neither cue");
   c.destroy(); await sleep(2700); assert.equal((await f.starts()).length, 1, "full 3s grace");
   await until(async () => (await f.starts()).length === 2, "last farewell");
   assert.ok(alive(owner), "helper stays alive through farewell");
   const loser = f.launch(); await until(() => !alive(loser), "lock held during farewell");
   await until(() => !alive(owner), "exit after player finishes");
   assert.deepEqual((await f.starts()).map(r => r.cue), ["welcome", "goodbye"]);
   assert.deepEqual((await f.records()).map(r => r.phase), ["start", "finish", "start", "finish"]);
   for (const r of await f.records()) assert.ok(r.path.startsWith(sounds + "/"), "integrated local cue path");
   await assert.rejects(lstat(f.dir + "/sock"), { code: "ENOENT" });
  });
  await t.test("SIGKILL of final Pi client still plays farewell; newcomer during farewell reaches next owner", async () => {
   const f = await fixture("crash-"); const owner = f.launch();
   await until(async () => !!await lstat(f.dir + "/sock").catch(() => undefined), "socket ready");
   const peer = spawn(process.execPath, ["-e", `require('net').createConnection(${JSON.stringify(f.dir + "/sock")}).on('connect',function(){this.write('lease FAIRY2\\n')}).on('data',()=>{});`], { stdio: "ignore" });
   children.push(peer);
   await until(async () => (await f.starts()).length === 1, "crashed peer was a real qualified lease");
   peer.kill("SIGKILL"); await until(() => !alive(peer), "Pi exited");
   await until(async () => (await f.starts()).length === 2, "helper plays after Pi death");
   assert.ok(alive(owner));
   const messages: string[] = []; let launches = 0;
   const client = new DesktopClient(m => messages.push(m), {
    directory: async () => f.dir,
    launch: async () => { launches++; f.launch(); },
   });
   try {
    client.start(); await sleep(300); assert.equal(launches, 0, "retiring owner prevents futile launches");
    await until(async () => (await f.starts()).length === 3, "next owner welcome within original connect budget", 10_000);
    assert.equal(launches, 1); assert.deepEqual(messages, []); assert.ok(!alive(owner));
    assert.deepEqual((await f.starts()).map(r => r.cue), ["welcome", "goodbye", "welcome"]);
   } finally { client.dispose(); }
   await until(async () => (await f.starts()).length === 4, "next final farewell");
   await until(() => children.every(c => !alive(c)), "all helper/player cleanup");
  });
  await t.test("welcome is preempted without overlapping native cues; stubborn farewell is bounded", async () => {
   const f = await fixture("bounded-"); await writeFile(f.dir + "/mode", "hang");
   const owner = f.launch(), lease = await f.connect();
   await until(async () => (await f.starts()).length === 1, "long welcome starts");
   lease.destroy();
   await until(async () => (await f.starts()).length === 2, "goodbye replaces welcome");
   const [welcome, goodbye] = await f.starts();
   assert.throws(() => process.kill(welcome.pid, 0), "welcome reaped before goodbye starts");
   await until(() => !alive(owner), "stubborn player killed and helper exits", 10_000);
   assert.throws(() => process.kill(goodbye.pid, 0), "no orphan farewell player");
   assert.equal((await f.starts()).length, 2);
   await assert.rejects(lstat(f.dir + "/sock"), { code: "ENOENT" });
  });
 } finally {
  for (const socket of sockets) socket.destroy();
  for (const child of children) if (alive(child)) child.kill("SIGTERM");
  await sleep(300);
  // Kill only mock players recorded in this private fixture if an assertion failed.
  for (const name of await readdir(root)) {
   const records = await readFile(root + "/" + name + "/recordings", "utf8").catch(() => "");
   if (records) console.log(`Recording evidence ${name}: ${records.trim()}`);
   for (const line of records.trim().split("\n").filter(Boolean)) { try { process.kill(JSON.parse(line).pid, "SIGKILL"); } catch {} }
  }
  for (const child of children) if (alive(child)) child.kill("SIGKILL");
  await sleep(200); await rm(root, { recursive: true, force: true });
 }
});
