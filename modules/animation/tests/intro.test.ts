import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { connectLease, desktopLaunchArguments } from "../src/desktop/client.ts";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const source = fileURLToPath(new URL("../native/Fairy.swift", import.meta.url));
const assets = fileURLToPath(new URL("../assets", import.meta.url));
const sounds = fileURLToPath(new URL("../../voice/sounds", import.meta.url));
const alive = (p: ChildProcess) => p.exitCode === null && p.signalCode === null;
async function until(check: () => boolean | Promise<boolean>, timeout = 6000) {
 const end = performance.now() + timeout;
 while (performance.now() < end) { if (await check()) return; await sleep(40); }
 assert.fail("condition timed out");
}

test("desktopLaunchArguments delegates integrated welcome mode to the helper", () => {
 assert.deepEqual(desktopLaunchArguments("/private").slice(2), []);
 assert.deepEqual(desktopLaunchArguments("/private", "/sounds").slice(2), ["--intro-saved", "--rest-reminder", "--lifecycle-sounds", "/sounds", "--intro-sfx", assets + "/intro/sfx-v4.wav"]);
});

test("IntroPlacement retains no-display cancellation across ordinary ticks and lands once on recovery", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-intro-placement-");
 try {
  const native = await readFile(source, "utf8");
  const section = (start: string, end: string) => native.slice(native.indexOf(start), native.indexOf(end));
  // Compile the actual production decision/geometry/lifetime code, not a TS mock
  // or AppKit windows. Also guard both runtime callers of this decision seam.
  assert.match(section("@MainActor enum IntroCompletion", "@MainActor func beginIntro"), /placeIntroPet\(finishing: true\)/);
  assert.match(section("let timer = Timer", "@MainActor func effectsAligned"), /let canShow = !cinematic \|\| MainActor.assumeIsolated \{ placeIntroPet\(\) \}/);
  const swift = "import AppKit\n"
   + section("enum FairySize:", "struct SizeSettings")
   + section("func sizedFrame(", "let preferenceOverride")
   + section("struct IntroSample", "@Sendable func introBody")
   + section("struct SimpleSample", "func positionFrame")
   + `
for size in FairySize.allCases {
    for visible in [NSRect(x: -1400, y: -100, width: 1000, height: 800), NSRect(x: 300, y: 40, width: 80, height: 90)] {
        var life = IntroLifetime(); life.begin(100)
        precondition(life.tick(100.1, lease: true, displayValid: false).cancelled)
        var placement = IntroPlacement()
        precondition(placement.update(size, visible: nil, finishing: true) == .hidden)
        for tick in 1...2 {
            precondition(placement.update(size, visible: nil) == .hidden, "empty-screen ordinary tick must stay hidden")
            precondition(placement.waitingForDisplay)
            life.begin(100 + Double(tick)) // grace reconnect cannot replay
            precondition(!life.tick(100 + Double(tick), lease: true, displayValid: false).welcome)
        }
        let recovered = placement.update(size, visible: visible)
        precondition(recovered == .landing(introLanding(size, visible: visible)))
        guard case .landing(let frame) = recovered else { fatalError("missing recovery landing") }
        precondition(visible.contains(frame) && !placement.waitingForDisplay)
        precondition(placement.update(size, visible: nil) == .ordinary, "do not pin subsequent dragging or broaden screen handling")
        precondition(life.finished && life.start == 100 && !life.welcomed)
        var normal = IntroPlacement()
        precondition(normal.update(size, visible: visible, finishing: true) == .landing(introLanding(size, visible: visible)))
        precondition(normal.update(size, visible: nil) == .ordinary)
    }
}
print("PASS IntroPlacement: cancellation, two empty ticks, recovery, once-only landing, no replay; 5 sizes x 2 screens")
`;
  await writeFile(root + "/placement.swift", swift);
  await promisify(execFile)("/usr/bin/swiftc", [root + "/placement.swift", "-o", root + "/placement"], { timeout: 20_000 });
  const { stdout, stderr } = await promisify(execFile)(root + "/placement", [], { timeout: 5000 });
  assert.equal(stderr, ""); assert.match(stdout, /PASS IntroPlacement/); console.log(stdout.trim());
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("IntroRaster preserves fullscreen grid and clears pet state at finish/cancel/retirement", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-intro-raster-");
 try {
  const native = await readFile(source, "utf8");
  const section = (start: string, end: string) => native.slice(native.indexOf(start), native.indexOf(end));
  assert.match(section("@MainActor func updateIntro", "// Original idle-only sampler"), /originY: body.minY - screen.frame.minY, opacity: sample.background/);
  assert.match(section("final class PetImageView", "var panel: PetPanel?"), /beginTransparencyLayer[\s\S]*drawPet\(dirtyRect\)[\s\S]*raster.draw[\s\S]*endTransparencyLayer/);
  assert.match(section("let timer = Timer", "@MainActor func effectsAligned"), /retiring = true[\s\S]*intro\.cancel\(\)[\s\S]*imageView\?\.introRaster = nil/);
  // Execute the real finish function with nil panels: never order any window.
  const swift = "import AppKit\n"
   + section("struct IntroRaster", "// All welcome selection")
   + `
final class View { var introRaster: IntroRaster? }
final class Panel { var screen: NSScreen?; var ignoresMouseEvents = true; var alphaValue = 0.0; func orderOut(_ sender: Any?) {}; func close() {} }
struct Life { var welcomed = false; var start: Double?; var cancelled = false; mutating func cancel() { cancelled = true } }
struct Audio { func stop(_ now: Double) {} }
var imageView: View? = View(), panel: Panel?, introCover: Panel?, introView: View?
var intro = Life(), lifecycleAudio = Audio()
struct SFX { func stop() {} }; let introSFX = SFX()
let introTest = false, headless = false
struct Position { var display: String }; var savedPosition: Position?
@MainActor enum DesktopPlacement {
 static func displayUUID(_ screen: NSScreen) -> String? { nil }
 static func captureRest(eligible: Bool) {}
}
var introLayout: [String] = []
func displayLayout() -> [String] { [] }
@MainActor func placeIntroPet(finishing: Bool) -> Bool { true }
`
   + section("@MainActor enum IntroCompletion", "@MainActor func beginIntro")
   + `
MainActor.assumeIsolated {
 for cancel in [false, true] {
  imageView?.introRaster = IntroRaster(screenHeight: 1080, originY: 201.5, opacity: 1)
  IntroCompletion.finishIntro(cancel: cancel, now: 10)
  precondition(imageView?.introRaster == nil)
  precondition(intro.cancelled == cancel)
 }
}
print("PASS IntroRaster: actual finish/cancel clearing; retirement and fullscreen placement callers guarded")
`;
  await writeFile(root + "/raster.swift", swift);
  await promisify(execFile)("/usr/bin/swiftc", ["-O", root + "/raster.swift", "-o", root + "/raster"], { timeout: 20_000 });
  const { stdout, stderr } = await promisify(execFile)(root + "/raster", [], { timeout: 5000 });
  assert.equal(stderr, ""); assert.match(stdout, /PASS IntroRaster/); console.log(stdout.trim());
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("full desktop intro: actual native sampler, renderer and qualified lifetimes", { skip: process.platform !== "darwin", timeout: 180_000 }, async t => {
 const root = await mkdtemp("/tmp/fairy-intro-test-");
 const children: ChildProcess[] = [];
 let retainEvidence = false;
 const sockets: Awaited<ReturnType<typeof connectLease>>[] = [];
 await promisify(execFile)("/usr/bin/swiftc", [source, "-o", root + "/Fairy"], { timeout: 120_000 });
 try {
  await t.test("offscreen phases, real clock, closure, loading, fixed pool, inert input and adaptive geometry", async () => {
   const dir = await mkdtemp(root + "/raster-");
   const { stdout, stderr } = await promisify(execFile)(root + "/Fairy", [dir, assets, "--intro-diagnostics"], {
    env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: dir + "/settings", FAIRY_INTRO_PREVIEW: dir + "/previews" }, timeout: 30_000,
   });
   assert.equal(stderr, ""); assert.match(stdout, /PASS intro/); assert.match(stdout, /PASS intro raster: sRGB rows\/graded alpha\/transparent margins\/zero residual/); assert.match(stdout, /PERF 3840x2160/); console.log(stdout.trim());
  });
  async function fixture(action = "", mode = "", audio = true, missing = false, gui = false) {
   const dir = await mkdtemp(root + "/life-");
   const log = dir + "/recordings";
   await writeFile(dir + "/player", `#!/usr/bin/python3
import os,sys,json,time,signal,pathlib
base=pathlib.Path(__file__).parent
stubborn=${JSON.stringify(mode)} == 'stubborn'
if stubborn: signal.signal(signal.SIGTERM,signal.SIG_IGN)
with open(base/'recordings','a') as f: f.write(json.dumps(dict(path=sys.argv[1],pid=os.getpid(),time=time.monotonic()))+'\\n')
(base/'player-ready').write_text('ready')
time.sleep(60 if stubborn else 0.3)
`, { mode: 0o700 });
   let soundDir = sounds;
   if (missing) {
    soundDir = dir + "/sounds"; await mkdir(soundDir);
    // Existing simple welcome must NOT be a fallback for missing full welcome7.
    await copyFile(sounds + "/welcome-1.wav", soundDir + "/welcome-1.wav");
    await copyFile(sounds + "/goodbye-1.wav", soundDir + "/goodbye-1.wav");
   }
   const child = spawn(root + "/Fairy", [dir, assets, "--intro-full", "--intro-test", ...(gui ? [] : ["--headless"]), ...(audio ? ["--lifecycle-sounds", soundDir, "--lifecycle-player", dir + "/player"] : [])], {
    env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", FAIRY_SETTINGS_DIRECTORY: dir + "/settings", FAIRY_INTRO_TEST_ACTION: action }, stdio: ["ignore", "pipe", "pipe"],
   }); children.push(child);
   let output = "", errors = ""; child.stdout!.on("data", b => output += b); child.stderr!.on("data", b => errors += b);
   const records = async (): Promise<{ path: string; pid: number; time: number }[]> => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(s => JSON.parse(s));
   const connect = async () => {
    let socket: Awaited<ReturnType<typeof connectLease>> | undefined;
    await until(async () => { try { socket = await connectLease(dir + "/sock"); return true; } catch { return false; } });
    sockets.push(socket!); return socket!;
   };
   return { child, records, connect, ready: async () => (await readFile(dir + "/player-ready", "utf8").catch(() => "")) === "ready", done: async () => {
    try { await until(() => !alive(child), mode === "stubborn" ? 14000 : 6000); }
    catch (cause) {
     retainEvidence = true;
     async function snapshot() {
      const events = await records();
      const pids = [child.pid!, ...events.map(r => r.pid), ...[...output.matchAll(/returned pid=(\d+)/g)].map(m => Number(m[1]))];
      const ps = await promisify(execFile)("/bin/ps", ["-o", "pid,ppid,state,etime,command", "-p", [...new Set(pids)].join(",")], { timeout: 1000 }).then(r => r.stdout).catch(e => String(e));
      return { action, mode, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
       stdout: output, stderr: errors, recordings: events, ready: await readFile(dir + "/player-ready", "utf8").catch(() => "absent"), ps };
     }
     const failed = await snapshot();
     await writeFile(dir + "/timeout-at-deadline.json", JSON.stringify(failed, null, 2));
     // Observation only: the original deadline has ALREADY failed and is not
     // converted into a pass if retirement completes during this extra window.
     await until(() => !alive(child), 8000).catch(() => {});
     await writeFile(dir + "/timeout-observation.json", JSON.stringify(await snapshot(), null, 2));
     throw new Error("native intro exit timeout: " + JSON.stringify(failed) + "; retained " + dir, { cause });
    }
    assert.equal(child.exitCode, 0, errors); assert.equal(errors, "");
    await assert.rejects(readFile(dir + "/settings/settings.json"), { code: "ENOENT" });
    console.log(output.trim()); return output; } };
  }
  await t.test("prompt ack, no early/duplicate welcome7, full landing, grace reconnect and goodbye", async () => {
   const f = await fixture(); const start = performance.now(), a = await f.connect();
   assert.ok(performance.now() - start < 2000, "ack before cinematic completes");
   const b = await f.connect(); a.destroy();
   await sleep(6800); assert.deepEqual(await f.records(), [], "no audio during signal/clock/errors/HDD/materialization");
   await until(async () => (await f.records()).length === 1);
   assert.ok((await f.records())[0].path.endsWith("/welcome-7.wav"));
   await sleep(3000); b.destroy(); await sleep(400); const c = await f.connect(); await sleep(500);
   assert.equal((await f.records()).length, 1); c.destroy();
   const output = await f.done(); assert.match(output, /finished cancel=false welcomed=true/);
   assert.equal((await f.records()).length, 2); assert.match((await f.records())[1].path, /goodbye-[1-6]\.wav$/);
  });
  for (const action of ["display", "lease"]) {
   await t.test(`${action}: immediate cancellation, grace reconnect never replays`, async () => {
    const f = await fixture(action); const a = await f.connect(); await sleep(600); a.destroy();
    await sleep(400); const b = await f.connect(); await sleep(7200);
    assert.deepEqual(await f.records(), []); b.destroy();
    assert.match(await f.done(), /finished cancel=true welcomed=false/);
    assert.equal((await f.records()).length, 1); assert.match((await f.records())[0].path, /goodbye-/);
   });
  }
  await t.test("lease loss after welcome stops stubborn own player; later goodbye remains bounded", async () => {
   const f = await fixture("", "stubborn"); const a = await f.connect();
   await until(async () => (await f.records()).length === 1, 9000); const welcome = (await f.records())[0];
   await until(f.ready);
   a.destroy(); // Real final-lease EOF cancels the intro and its own player.
   await until(() => { try { process.kill(welcome.pid, 0); return false; } catch { return true; } }, 3000);
   assert.throws(() => process.kill(welcome.pid, 0), "ready recording player was reaped by bounded lease-loss cleanup");
   a.destroy(); assert.match(await f.done(), /finished cancel=true welcomed=true/);
   assert.equal((await f.records()).length, 2);
   const goodbye = (await f.records())[1];
   assert.throws(() => process.kill(goodbye.pid, 0), "bounded goodbye cleanup");
  });
  for (const kind of ["silent", "missing"]) {
   await t.test(`${kind} player never stalls full animation or falls back to welcome1`, async () => {
    const f = await fixture("", "", kind !== "silent", kind === "missing"); const a = await f.connect();
    await sleep(10400); assert.deepEqual(await f.records(), []); a.destroy();
    assert.match(await f.done(), /finished cancel=false welcomed=true/);
   });
  }
  await t.test("retirement interrupts pre-reveal without delayed welcome", async () => {
   const f = await fixture(); const a = await f.connect(); await sleep(300); f.child.kill("SIGTERM");
   assert.match(await f.done(), /finished cancel=true welcomed=false/); a.destroy();
   assert.equal((await f.records()).length, 1); assert.match((await f.records())[0].path, /goodbye-/);
  });
  // Explicit opt-in ONE real overlay; default npm test does not cover the desktop.
  if (process.env.FAIRY_INTRO_GUI_SMOKE === "1") await t.test("single controlled nonkey real-panel full lifetime", async () => {
   const f = await fixture("", "", true, false, true); const a = await f.connect();
   await sleep(10400); a.destroy(); const output = await f.done();
   assert.match(output, /pre-lease pet hidden/); assert.match(output, /finished cancel=false welcomed=true/);
   assert.equal((await f.records()).length, 2);
  });
 } finally {
  for (const socket of sockets) socket.destroy();
  for (const child of children) if (alive(child)) child.kill("SIGTERM");
  const deadline = performance.now() + 14000;
  while (children.some(alive) && performance.now() < deadline) await sleep(100);
  // Fixtures only; the helper owns/reaps its recording player before exit.
  for (const child of children) if (alive(child)) child.kill("SIGKILL");
  if (retainEvidence) console.log("Retained native intro timeout evidence: " + root);
  else await rm(root, { recursive: true, force: true });
 }
});
