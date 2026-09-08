import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, chmod } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { closeSync, fstatSync, openSync } from "node:fs";
import { cachedNativePath, consumeStartupLease, DesktopClient } from "../src/desktop/client.ts";
const run = promisify(execFile);

test("prelude ready follows production cover drawing; original FAIRY2 and bounded claim remain separate", async () => {
 const native = await readFile(new URL("../native/Fairy.swift", import.meta.url), "utf8");
 assert.match(native, /line == "lease FAIRY2", sendLine\("FAIRY2/);
 assert.match(native, /preludeToken != nil && now - peer.accepted >= 15/);
 assert.match(native, /clients\[fd\]!\.readySent, line == "claim/);
 const timer = native.slice(native.indexOf("let timer = Timer"), native.indexOf("@MainActor func effectsAligned"));
 assert.match(timer, /beginIntro\(now\)[\s\S]*updateIntro\(now[\s\S]*introCover\?\.displayIfNeeded\(\); introCover\?\.flush\(\)[\s\S]*sendLine\("FAIRY2 ready/);
 const launch = await readFile(new URL("../native/Startup.swift", import.meta.url), "utf8");
 assert.match(launch, /POSIX_SPAWN_CLOEXEC_DEFAULT \| \(detached \? POSIX_SPAWN_SETSID/);
 assert.match(launch, /let deadline = start \+ 1\.5/);
 assert.match(launch, /fcntl\(lease, F_SETFD, 0\)/);
 assert.match(launch, /execv\(executable/);
 assert.doesNotMatch(launch, /swiftc|signal\(/);
});

test("handoff metadata is consumed even when malformed; stdio/non-socket descriptors are never adopted", () => {
 for (const fd of ["0", "1", "2", "-1", "NaN", "1000000"]) {
  const env = { FAIRY_STARTUP_FD: fd, FAIRY_STARTUP_TOKEN: "11111111-1111-4111-8111-111111111111" };
  assert.equal(consumeStartupLease(env), undefined); assert.deepEqual(env, {});
 }
});

// Inert, exclusively owned raw descriptors exercise cleanup before Socket adoption.
// Actual socket adoption/claim remains covered by startup-entry.py's private Node/PTY suite.
for (const mode of ["before-start", "pending-directory", "rejected-directory", "constructor-failure"] as const) {
 test(`DesktopClient closes unadopted startup fd: ${mode}`, { timeout: 3000 }, async () => {
  const fd = openSync("/dev/null", "r");
  let replacement: number | undefined;
  let resolveDirectory!: (path: string) => void;
  let rejectDirectory!: (error: Error) => void;
  const directory = new Promise<string>((resolve, reject) => { resolveDirectory = resolve; rejectDirectory = reject; });
  let notified!: () => void;
  const notification = new Promise<void>(resolve => { notified = resolve; });
  const messages: string[] = [];
  let launches = 0;
  const client = new DesktopClient(message => { messages.push(message); notified(); }, {
   directory: () => directory,
   launch: async () => { launches++; throw new Error("fixture launch rejected"); },
  }, undefined, { fd, token: "11111111-1111-4111-8111-111111111111" });
  try {
   if (mode !== "before-start") client.start();
   if (mode === "rejected-directory" || mode === "constructor-failure") {
    if (mode === "rejected-directory") rejectDirectory(new Error("fixture directory rejected"));
    else resolveDirectory("/unused"); // /dev/null cannot be adopted by net.Socket.
    await notification;
    assert.equal(messages.length, 1);
    assert.equal(launches, mode === "constructor-failure" ? 1 : 0);
   } else {
    client.dispose();
    assert.throws(() => fstatSync(fd), { code: "EBADF" });
    resolveDirectory("/unused");
    await directory;
    assert.deepEqual(messages, []);
    assert.equal(launches, 0);
   }
   assert.throws(() => fstatSync(fd), { code: "EBADF" });
   // Reuse the released number: repeated cleanup must not close its new owner.
   replacement = openSync("/dev/null", "r");
   assert.equal(replacement, fd);
   client.dispose(); client.dispose(); client.start();
   assert.doesNotThrow(() => fstatSync(replacement!));
  } finally {
   client.dispose();
   if (replacement !== undefined) closeSync(replacement);
   else { try { closeSync(fd); } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "EBADF"); } }
  }
 });
}

test("DesktopClient transfers the raw fd to Socket without later closing a reused descriptor", { timeout: 10_000 }, async () => {
 const source = new URL("../src/desktop/client.ts", import.meta.url).href;
 // Only the child owns fd 3; the parent owns the opposite socketpair endpoint.
 const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
  import assert from 'node:assert/strict';
  import { once } from 'node:events';
  import { openSync, closeSync, fstatSync } from 'node:fs';
  import { DesktopClient } from ${JSON.stringify(source)};
  const client = new DesktopClient(message => { throw new Error(message); }, {
   directory: async () => '/unused', launch: async () => { throw new Error('unexpected launch'); },
  }, undefined, { fd: 3, token: '11111111-1111-4111-8111-111111111111' });
  client.start();
  await Promise.resolve();
  const socket = client.claiming;
  assert.ok(socket);
  await once(socket, 'data');
  assert.equal(client.socket, socket);
  assert.doesNotThrow(() => fstatSync(3));
  const closed = once(socket, 'close');
  client.dispose(); await closed;
  assert.throws(() => fstatSync(3), { code: 'EBADF' });
  const replacement = openSync('/dev/null', 'r');
  assert.equal(replacement, 3);
  client.dispose(); client.dispose();
  assert.doesNotThrow(() => fstatSync(replacement));
  closeSync(replacement);
 `], { stdio: ["ignore", "pipe", "pipe", "pipe"], signal: AbortSignal.timeout(5000) });
 const peer = child.stdio[3]! as import("node:net").Socket;
 let request = "", stderr = "";
 child.stderr!.on("data", chunk => { stderr += chunk; });
 peer.on("data", chunk => {
  request += chunk;
  if (request === "claim 11111111-1111-4111-8111-111111111111\n") peer.write("FAIRY2 claimed 11111111-1111-4111-8111-111111111111\n");
 });
 try {
  const [code, signal] = await once(child, "exit");
  assert.equal(code, 0, stderr); assert.equal(signal, null);
  assert.equal(request, "claim 11111111-1111-4111-8111-111111111111\n");
 } finally { peer.destroy(); if (child.exitCode === null && child.signalCode === null) child.kill(); }
});

test("startup cache resolver is read-only, source-hashed and requires both explicitly prepared executables", { skip: process.platform !== "darwin" }, async () => {
 const root = await mkdtemp("/tmp/fairy-startup-cache-");
 try {
  const script = await readFile(new URL("../scripts/startup-cache.ts", import.meta.url), "utf8");
  assert.doesNotMatch(script, /buildHelper|privateDirectory\(|spawn\(|execFile\(/);
  const fixture = script.replace('"../src/desktop/client.ts"', JSON.stringify(new URL("../src/desktop/client.ts", import.meta.url).href))
   .replace('const directory = `/tmp/pi-fairy-${process.getuid!()}`;', `const directory = ${JSON.stringify(root)};`);
  await writeFile(root + "/resolver.mts", fixture);
  const args = ["--experimental-strip-types", root + "/resolver.mts"];
  await assert.rejects(run(process.execPath, args), { code: 1 });
  const startup = await cachedNativePath("Startup", root), helper = await cachedNativePath("Fairy", root);
  for (const file of [startup, helper]) await writeFile(file, "unused fixture", { mode: 0o700 });
  assert.equal((await run(process.execPath, args)).stdout, `${startup}\n${helper}\n`);
  await chmod(helper, 0o600); await assert.rejects(run(process.execPath, args), { code: 1 });
  await chmod(helper, 0o700); await chmod(root, 0o755);
  await assert.rejects(run(process.execPath, args), { code: 1 });
 } finally { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); }
});
