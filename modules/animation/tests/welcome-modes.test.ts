import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { connectLease, desktopLaunchArguments, requestWelcome, welcomeSetting } from "../src/desktop/client.ts";
const run = promisify(execFile);
const native = fileURLToPath(new URL("../native/Fairy.swift", import.meta.url));
const assets = fileURLToPath(new URL("../assets", import.meta.url));
const evidence = process.env.FAIRY_MODES_EVIDENCE ?? "/tmp";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Recorder observation, not a visual/audio scheduling deadline: allow the
// production 0.65s/7.2s cue time + intentional 1.2s recorder delay + ~3s
// process-start/poll/file-observation slack. Production fake-clock checks below
// still assert the original scheduling times; a missing record must fail finitely.
const recorderStartDelayMs = 1200;
const welcomeObservationBudgetMs = { simple: 5000, full: 11_500 };
async function waitForWelcomeRecordings(
 read: () => Promise<string[]>, expectedWelcomes: number, budgetMs: number,
 diagnosticFile: string, context: () => unknown = () => ({}),
): Promise<string[]> {
 const started = performance.now(), deadline = started + budgetMs;
 let records: string[] = [];
 while (true) {
  records = await read();
  if (records.filter(cue => cue.startsWith("welcome-")).length >= expectedWelcomes) return records;
  const remaining = deadline - performance.now();
  if (remaining <= 0) break;
  await sleep(Math.min(25, remaining));
 }
 const diagnostic = { expectedWelcomes, budgetMs, elapsedMs: performance.now() - started, records, context: context() };
 await writeFile(diagnosticFile, JSON.stringify(diagnostic, null, 2));
 assert.fail(`Welcome recorder observation timed out: ${JSON.stringify(diagnostic)}; evidence: ${diagnosticFile}`);
}

test("welcome recorder observation times out with diagnostics when no recorder result arrives", { skip: process.platform !== "darwin", timeout: 2000 }, async () => {
 const root = await mkdtemp(evidence + "/absent-recorder-");
 const file = root + "/timeout.json";
 await assert.rejects(waitForWelcomeRecordings(async () => [], 1, 150, file, () => ({ fixture: "no recorder launched" })), /Welcome recorder observation timed out/);
 const diagnostic = JSON.parse(await readFile(file, "utf8"));
 assert.equal(diagnostic.expectedWelcomes, 1); assert.equal(diagnostic.budgetMs, 150);
 assert.ok(diagnostic.elapsedMs >= 150); assert.deepEqual(diagnostic.records, []);
});

test("welcome control uses separate non-lease peers; old owner preserves main lease and no offline bypass", { skip: process.platform !== "darwin" }, async () => {
 const root = await mkdtemp(evidence + "/control-"); const peers: Socket[] = []; let offline = 0;
 const server = createServer(s => { peers.push(s); s.on("data", d => { if (d.toString() === "lease FAIRY2\n") s.write("FAIRY2 123\n"); else s.destroy(); }); });
 await new Promise<void>(r => server.listen(root + "/sock", r));
 const lease = await connectLease(root + "/sock");
 try {
  await assert.rejects(welcomeSetting("simple", { directory: async () => root, offline: async () => { offline++; return "simple"; } }), /不支持开场设置/);
  assert.equal(lease.destroyed, false); assert.equal(offline, 0);
 } finally { lease.destroy(); peers.forEach(p => p.destroy()); await new Promise<void>(r => server.close(() => r())); }
 assert.equal(await welcomeSetting("simple", { directory: async () => root, offline: async () => { offline++; return "simple"; } }), "simple");
 assert.equal(offline, 1);
 await assert.rejects(welcomeSetting("full", { directory: async () => root, offline: async () => "simple" }), /未确认保存/);
});

test("production slash command reports saved choice/failure without enabling off desktop with obsolete CLI flag", { skip: process.platform !== "darwin" }, async () => {
 const root = await mkdtemp(evidence + "/command-");
 const entry = new URL("../src/index.ts", import.meta.url);
 const source = (await readFile(entry, "utf8")).replace(/from "(\.\/[^\"]+)"/g, (_all, path) => `from ${JSON.stringify(path === "./desktop/client.ts" ? root + "/client.mts" : new URL(path, entry).href)}`);
 await writeFile(root + "/entry.mts", source);
 await writeFile(root + "/client.mts", `
export const eligible = mode => mode === 'tui';
export class DesktopClient { constructor() { throw new Error('unexpected desktop enable'); } }
let saved = 'full';
export async function welcomeSetting(mode) { if (globalThis.fairyCommandFailure) throw new Error('fixture write failed'); return saved = mode ?? saved; }
`);
 const { default: animation } = await import(root + "/entry.mts");
 let command: any; const notifications: [string, string][] = [];
 animation({ registerFlag() {}, on() {}, registerCommand(_name: string, c: unknown) { command = c; }, getFlag() { return "terminal"; } });
 const ctx = { mode: "tui", ui: { setWidget() {}, notify(text: string, kind: string) { notifications.push([text, kind]); } } };
 await command.handler("off", ctx);
 await command.handler("welcome simple", ctx);
 if (process.platform === "darwin") {
  assert.match(notifications.at(-1)![0], /simple 已保存，下一次新共享桌面生命周期生效/);
  await command.handler("welcome", ctx); assert.match(notifications.at(-1)![0], /simple（已保存的选择）/);
  await command.handler("mode terminal", ctx);
  await command.handler("welcome full", ctx); assert.match(notifications.at(-1)![0], /full 已保存，下一次新共享桌面生命周期生效/);
  (globalThis as any).fairyCommandFailure = true;
  try { await command.handler("welcome simple", ctx); assert.equal(notifications.at(-1)![1], "error"); assert.match(notifications.at(-1)![0], /未确认保存/); }
  finally { delete (globalThis as any).fairyCommandFailure; }
 }
 await command.handler("welcome other", ctx); assert.equal(notifications.at(-1)![1], "warning");
});

test("production settings, geometry and lifetime decisions (window-free Swift)", { skip: process.platform !== "darwin", timeout: 40_000 }, async () => {
 const root = await mkdtemp(evidence + "/geometry-");
 const source = await readFile(native, "utf8");
 const section = (a: string, b: string) => source.slice(source.indexOf(a), source.indexOf(b));
 const swift = "import AppKit\nimport Darwin\n"
  + section("enum FairySize:", "let preferenceOverride")
  + section("struct IntroSample", "final class IntroView")
  + `
let prefs = SizePreferences(directory: URL(fileURLWithPath: CommandLine.arguments[1]))
try FileManager.default.createDirectory(at: prefs.directory, withIntermediateDirectories: true)
precondition(prefs.load() == .standard && prefs.settings().welcome == .full)
try Data("{\\"version\\":1,\\"size\\":\\"large\\"}".utf8).write(to: prefs.file)
let uuid = "11111111-1111-4111-8111-111111111111"
let position = SavedPosition(display: uuid, x: 0.31, y: 0.62)
precondition(preferredDisplayIndex(saved: uuid, displays: ["other", uuid], pointer: 0) == 1)
precondition(preferredDisplayIndex(saved: uuid, displays: ["other", "remaining"], pointer: 1) == 1)
precondition(preferredDisplayIndex(saved: nil, displays: [nil, "remaining"], pointer: 1) == 1)
precondition(preferredDisplayIndex(saved: uuid, displays: [], pointer: 0) == nil)
precondition(preferredDisplayIndex(saved: uuid, displays: [uuid], pointer: nil) == 0)
try prefs.savePosition(position); try prefs.saveWelcome(.simple)
for size in FairySize.allCases {
 try prefs.save(size)
 precondition(prefs.settings().position == position && prefs.settings().welcome == .simple && prefs.load() == size)
}
let secondWriter = SizePreferences(directory: prefs.directory)
try secondWriter.saveWelcome(.full); try prefs.save(.large)
precondition(secondWriter.settings().welcome == .full && secondWriter.settings().position == position)
for text in ["broken", "{}", "{\\"version\\":99}", "{\\"version\\":2,\\"position\\":{\\"display\\":\\"bad\\",\\"x\\":0.2,\\"y\\":0.5}}", "{\\"version\\":2,\\"position\\":{\\"display\\":\\"11111111-1111-4111-8111-111111111111\\",\\"x\\":1e999,\\"y\\":0.5}}"] {
 try Data(text.utf8).write(to: prefs.file)
 precondition(prefs.settings().position == nil && prefs.settings().welcome == .full)
}
for bad in [Double.nan, .infinity, -0.1, 1.1] {
 precondition(!SavedPosition(display: uuid, x: bad, y: 0.5).valid)
 do { try prefs.savePosition(SavedPosition(display: uuid, x: bad, y: 0.5)); fatalError("invalid save") } catch {}
}
try FileManager.default.removeItem(at: prefs.file)
try FileManager.default.createDirectory(at: prefs.file, withIntermediateDirectories: false)
do { try prefs.saveWelcome(.simple); fatalError("save failure hidden") } catch {}
try FileManager.default.removeItem(at: prefs.file)
try prefs.savePosition(position); try prefs.saveWelcome(.simple)
for visible in [NSRect(x: -1920, y: -200, width: 1920, height: 1040), NSRect(x: 100, y: 40, width: 80, height: 90), NSRect(x: 20, y: 1000, width: 900, height: 1560)] {
 for size in FairySize.allCases { for scale in [1.0, 2.0] {
  let landing = positionFrame(position, display: uuid, size: size, visible: visible)
  precondition(visible.contains(landing))
  let saved = restingPosition(landing, display: uuid, visible: visible, controlled: false)!
  let restored = positionFrame(saved, display: uuid, size: size, visible: visible)
  precondition(abs(restored.midX - landing.midX) * scale < 0.001 && abs(restored.midY - landing.midY) * scale < 0.001)
  precondition(restingPosition(landing, display: uuid, visible: visible, controlled: true) == nil)
  precondition(restingPosition(landing.offsetBy(dx: 9999, dy: 0), display: uuid, visible: visible, controlled: false) == nil)
  precondition(positionFrame(position, display: "absent", size: size, visible: visible) == introLanding(size, visible: visible))
  precondition(prefs.settings().position == position, "fallback must not overwrite original")
  let tiny = SimpleSample(elapsed: 0).body(screen: visible, landing: landing)
  precondition(tiny.width == 2 && tiny.midX == visible.midX && tiny.midY == visible.midY)
  var previous: CGFloat = 0
  for i in 0...65 {
   let body = SimpleSample(elapsed: Double(i)/100).body(screen: visible, landing: landing)
   precondition(body.width >= previous && visible.contains(body)); previous = body.width
  }
  precondition(SimpleSample(elapsed: 0.65).body(screen: visible, landing: landing) == SimpleSample(elapsed: 1).body(screen: visible, landing: landing))
  precondition(SimpleSample(elapsed: 2.4).body(screen: visible, landing: landing) == landing)
  precondition(introBody(IntroSample(elapsed: 10), screen: visible, landing: landing) == landing)
  precondition(OutroSample(elapsed: 0).body(rest: landing) == landing)
  precondition(OutroSample(elapsed: 0.18).scale == 1.065)
  var width = CGFloat.infinity, alpha = CGFloat.infinity
  for i in 18...95 {
   let sample = OutroSample(elapsed: Double(i)/100), body = sample.body(rest: landing)
   precondition(body.width <= width && sample.alpha <= alpha)
   precondition(abs(body.midX - landing.midX) < 0.0001 && abs(body.midY - landing.midY) < 0.0001)
   width = body.width; alpha = sample.alpha
  }
  precondition(alpha == 0)
 } }
}
for simple in [false, true] { for cancel in ["none", "lease", "display", "overdue"] {
 var life = IntroLifetime(); life.begin(100); var welcomes = 0
 for i in 0...240 {
  let time = 100 + Double(i)/20 + (cancel == "overdue" && i >= 5 ? 2 : 0)
  let result = life.tick(time, lease: !(cancel == "lease" && i == 5), displayValid: !(cancel == "display" && i == 5), simple: simple)
  if result.welcome { welcomes += 1; precondition(result.sample.elapsed >= (simple ? 0.65 : 7.2)) }
  if i == 20 { life.begin(time) }
 }
 precondition(life.finished && life.start == 100 && welcomes == (cancel == "none" ? 1 : 0))
} }
precondition(lifecyclePaths("welcome", directory: "/s", full: false) == (1...6).map { "/s/welcome-\\($0).wav" })
precondition(lifecyclePaths("welcome", directory: "/s", full: true) == ["/s/welcome-7.wav"])
print("PASS migration/finite/preservation/failure; saved endpoint/negative/tiny/Retina/fallback; grow-hold-move/local overshoot-collapse; full/simple once/cancel/overdue")
// Shadow only physical screens/window for deterministic production outro cleanup.
enum NSScreen { static var screens = [1] }
final class FakePet {
 var alphaValue: CGFloat = 1; var writes = 0; var hidden = false
 func setFrame(_ frame: NSRect, display: Bool) { writes += 1 }
 func orderOut(_ sender: Any?) { hidden = true }
}
var panel: FakePet? = FakePet()
` + section("var outroStart:", "var theme =") + `
MainActor.assumeIsolated {
 let rest = NSRect(x: -300, y: 100, width: 238, height: 238)
 for interruption in ["none", "no-screen", "suspension"] {
  panel = FakePet(); NSScreen.screens = [1]; outroStart = 100; outroRest = rest
  precondition(!updateOutro(100.18))
  if interruption == "no-screen" { NSScreen.screens = [] }
  precondition(updateOutro(interruption == "no-screen" ? 100.3 : 110))
  precondition(panel!.hidden && outroRest == nil)
  let writes = panel!.writes
  NSScreen.screens = [1]
  precondition(updateOutro(111)); precondition(panel!.writes == writes && panel!.hidden)
 }
 outroStart = nil; outroRest = nil; precondition(updateOutro(0))
}
print("PASS production outro: no-screen/overdue/hidden cleanup and no resurrection")
`;
 await writeFile(root + "/main.swift", swift);
 await run("/usr/bin/swiftc", ["-O", root + "/main.swift", "-o", root + "/geometry"], { timeout: 30_000 });
 const result = await run(root + "/geometry", [root + "/settings"], { timeout: 5000 });
 await writeFile(root + "/result.log", result.stdout + result.stderr); console.log(result.stdout.trim());
});

test("real headless owner: persisted control, next lifetime, two leases/grace and recording-only six versus seven", { skip: process.platform !== "darwin", timeout: 90_000 }, async () => {
 const root = await mkdtemp(evidence + "/owner-"); const ipc = root + "/ipc", settings = root + "/settings";
 await mkdir(ipc, { mode: 0o700 }); await mkdir(settings);
 const binary = process.env.FAIRY_MODES_BINARY ?? root + "/Fairy";
 if (!process.env.FAIRY_MODES_BINARY) await run("/usr/bin/swiftc", ["-O", native, "-o", binary], { timeout: 30_000 });
 const env = { ...process.env, FAIRY_SETTINGS_DIRECTORY: settings };
 const offline = (mode?: string) => run(binary, [ipc, assets, "--welcome-setting", ...(mode ? [mode] : [])], { env, timeout: 3000 });
 await writeFile(settings + "/settings.json", '{"version":1,"size":"large"}');
 assert.equal((await offline()).stdout.trim(), "full");
 assert.equal((await offline("simple")).stdout.trim(), "simple");
 assert.equal(JSON.parse(await readFile(settings + "/settings.json", "utf8")).size, "large");
 // Concurrent commands serialize by nonblocking owner flock: winners confirm, losers fail honestly.
 const races = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => offline(i % 2 ? "simple" : "full")));
 assert.ok(races.some(r => r.status === "fulfilled"));
 for (const r of races) if (r.status === "rejected") assert.match(String(r.reason), /busy/);
 await offline("simple");
 await mkdir(root + "/sounds");
 for (const cue of ["welcome", "goodbye"]) for (let i = 1; i <= 7; i++) await writeFile(`${root}/sounds/${cue}-${i}.wav`, "fixture, never decoded");
 await writeFile(root + "/player", `#!/usr/bin/python3\nimport pathlib,sys,time\np=pathlib.Path(__file__).parent\nif pathlib.Path(sys.argv[1]).name.startswith('welcome-'): time.sleep(${recorderStartDelayMs / 1000}) # Intentional recorder readiness delay, not audio.\nwith (p/'recordings').open('a') as f: f.write(pathlib.Path(sys.argv[1]).name+'\\n'); f.flush()\ntime.sleep(1.0 if 'goodbye' in sys.argv[1] else 0.15)\n`, { mode: 0o700 });
 const recordings = async () => (await readFile(root + "/recordings", "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
 const children: ReturnType<typeof spawn>[] = [], leases: Socket[] = [];
 async function launch() {
  const args = desktopLaunchArguments(ipc, root + "/sounds");
  args.splice(args.indexOf("--intro-sfx"), 2); // Diagnostics explicitly forbid the real SFX player.
  args.splice(args.indexOf("--rest-reminder"), 1); // Shared reminders require real desktop views; tested separately with injected owners.
  assert.ok(args.includes("--intro-saved") && args.includes("--lifecycle-sounds"));
  const child = spawn(binary, [...args, "--headless", "--lifecycle-player", root + "/player"], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); let log = ""; child.stdout!.on("data", d => { log += d; }); child.stderr!.on("data", d => { log += d; });
  child.on("exit", () => { void writeFile(root + `/owner-${children.indexOf(child)}.log`, log); });
  let socket: Socket | undefined;
  for (let i = 0; i < 100; i++) { try { socket = await connectLease(ipc + "/sock", 100); break; } catch { await sleep(30); } }
  assert.ok(socket); leases.push(socket); return { child, socket };
 }
 try {
  const first = await launch(); const second = await connectLease(ipc + "/sock"); leases.push(second);
  await assert.rejects(offline("full"), /busy/);
  assert.equal(await requestWelcome(ipc + "/sock", "full"), "full");
  const recorderContext = () => ({ recordingFile: root + "/recordings", owners: children.map(c => ({ pid: c.pid, exitCode: c.exitCode, signalCode: c.signalCode })) });
  const simpleRecords = await waitForWelcomeRecordings(recordings, 1, welcomeObservationBudgetMs.simple, root + "/simple-timeout.json", recorderContext);
  assert.equal(simpleRecords.length, 1); assert.match(simpleRecords[0], /^welcome-[1-6]\.wav$/);
  first.socket.destroy(); await sleep(3200); assert.equal(first.child.exitCode, null);
  second.destroy(); await sleep(400); const reconnected = await connectLease(ipc + "/sock"); leases.push(reconnected);
  await sleep(400); assert.equal((await recordings()).filter(x => x.startsWith("welcome")).length, 1);
  // Failure must be acknowledged, not reported as a successful socket write.
  const { rename } = await import("node:fs/promises");
  await rename(settings + "/settings.json", settings + "/saved.json"); await mkdir(settings + "/settings.json");
  await assert.rejects(requestWelcome(ipc + "/sock", "simple"), /未确认保存/);
  const { rmdir } = await import("node:fs/promises"); await rmdir(settings + "/settings.json"); await rename(settings + "/saved.json", settings + "/settings.json");
  reconnected.destroy();
  // Control reads are not leases and cannot prolong the final grace.
  for (let i = 0; i < 7; i++) { await sleep(400); await requestWelcome(ipc + "/sock").catch(() => {}); }
  await sleep(350);
  await assert.rejects(connectLease(ipc + "/sock"), { code: "FAIRY_RETIRING" });
  assert.equal(first.child.exitCode, null, "owner lock retained while farewell player runs");
  await assert.rejects(offline("simple"), /busy/);
  await sleep(1100); assert.equal(first.child.exitCode, 0);
  assert.equal((await recordings()).filter(x => x.startsWith("goodbye")).length, 1);
  const next = await launch();
  const fullRecords = await waitForWelcomeRecordings(recordings, 2, welcomeObservationBudgetMs.full, root + "/full-timeout.json", recorderContext);
  assert.deepEqual(fullRecords.map(cue => cue.split("-")[0]), ["welcome", "goodbye", "welcome"]);
  assert.equal(fullRecords[2], "welcome-7.wav");
  next.socket.destroy(); await sleep(4400); assert.equal(next.child.exitCode, 0);
  console.log("PASS actual owner: control/failure/busy/concurrent writes, two leases/reconnect/no replay/non-lease grace, simple1-6 then full7 restart");
 } catch (error) {
  await writeFile(root + "/failure-before-cleanup.json", JSON.stringify({ error: String(error), recordings: await recordings(), owners: children.map(c => ({ pid: c.pid, exitCode: c.exitCode, signalCode: c.signalCode })) }, null, 2));
  throw error;
 } finally { leases.forEach(s => s.destroy()); children.forEach(c => { if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL"); }); }
});
