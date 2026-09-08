import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { DesktopClient } from "../src/desktop/client.ts";

test("DesktopClient retries immediately after slow preparation with a ready listener", { timeout: 5000 }, async t => {
 const dir = await mkdtemp("/tmp/fairy-startup-client-");
 const peers: Socket[] = []; let launches = 0, greeted = false;
 const server = createServer(socket => {
  peers.push(socket); socket.on("data", data => {
   assert.equal(data.toString(), "lease FAIRY2\n"); greeted = true; socket.write("FAIRY2 123\n");
  });
 });
 // Freeze client retry timers: a ready post-launch listener needs no 100ms tick.
 t.mock.timers.enable({ apis: ["setTimeout"] });
 const client = new DesktopClient(message => assert.fail(message), {
  directory: async () => dir,
  launch: async () => {
   launches++; await sleep(150); // compile/launch work, not the IPC budget
   await new Promise<void>(resolve => server.listen(dir + "/sock", resolve));
  },
 });
 try {
  client.start(); await sleep(500);
  assert.equal(launches, 1); assert.equal(greeted, true, "no retry timer needed after successful launch");
 } finally {
  client.dispose(); t.mock.timers.reset(); peers.forEach(peer => peer.destroy());
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
 }
});

test("DesktopClient retains backoff when launched helper is not listening yet", { timeout: 5000 }, async () => {
 const dir = await mkdtemp("/tmp/fairy-startup-delayed-");
 const peers: Socket[] = []; let launches = 0, greeted = false;
 const server = createServer(socket => { peers.push(socket); socket.on("data", () => { greeted = true; socket.write("FAIRY2 123\n"); }); });
 const client = new DesktopClient(message => assert.fail(message), {
  directory: async () => dir, launch: async () => { launches++; await sleep(1100); },
 });
 try {
  client.start(); await sleep(1260);
  assert.equal(launches, 1, "unavailable socket must not cause a launch storm");
  await new Promise<void>(resolve => server.listen(dir + "/sock", resolve));
  await sleep(250); assert.equal(greeted, true); assert.equal(launches, 1);
 } finally {
  client.dispose(); peers.forEach(peer => peer.destroy());
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
 }
});

test("IntroView has no SKIP drawing, callback, hit target or hidden click action", async () => {
 const source = await readFile(new URL("../native/Fairy.swift", import.meta.url), "utf8");
 const view = source.slice(source.indexOf("final class IntroView:"), source.indexOf("var introCover:"));
 assert.doesNotMatch(view, /skip|armed/i);
 for (const method of ["mouseDown", "mouseUp", "rightMouseDown", "rightMouseUp", "otherMouseDown", "otherMouseUp", "scrollWheel"]) {
  assert.match(view, new RegExp(`override func ${method}\\(with event: NSEvent\\) \\{\\}`));
 }
 assert.doesNotMatch(source, /view\.skip|skipRect|skip-before|skip-after/);
});


test("prepare-desktop uses only the existing compile cache; session startup remains the launch boundary", async () => {
 const script = await readFile(new URL("../scripts/prepare-desktop.ts", import.meta.url), "utf8");
 assert.match(script, /import \{ buildHelper \} from "\.\.\/src\/desktop\/client\.ts"/);
 assert.match(script, /console\.log\(await buildHelper\(\)\)/);
 assert.doesNotMatch(script, /DesktopClient|connectLease|spawn\(|execFile\(/);
 const client = await readFile(new URL("../src/desktop/client.ts", import.meta.url), "utf8");
 const build = client.slice(client.indexOf("export function buildHelper"), client.indexOf("export function connectLease"));
 assert.match(build, /120_000/); assert.doesNotMatch(build, /spawn\(|createConnection\(/);
 const entry = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
 assert.match(entry, /pi\.on\("session_start"[\s\S]*attach\(ctx\)/);
 assert.doesNotMatch(entry, /project_trust|process\.argv|buildHelper/);
});
