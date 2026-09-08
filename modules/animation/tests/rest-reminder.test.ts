import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { desktopLaunchArguments } from "../src/desktop/client.ts";
const run = promisify(execFile);
const nativeURL = new URL("../native/Fairy.swift", import.meta.url);

test("rest reminder is opted in on both integrated launch paths, diagnostics fail closed", async () => {
 assert.ok(desktopLaunchArguments("/private", "/sounds").includes("--rest-reminder"));
 assert.ok(!desktopLaunchArguments("/private").includes("--rest-reminder"));
 const startup = await readFile(new URL("../native/Startup.swift", import.meta.url), "utf8");
 assert.match(startup, /"--intro-saved", "--rest-reminder", "--lifecycle-sounds", package \+ "\/modules\/voice\/sounds"/);
 const source = await readFile(nativeURL, "utf8");
 assert.match(source, /restReminder && \(lifecycleSounds == nil \|\| headless/);
 assert.match(source, /restSchedule.retire\(\); restPrompt.close\(\)/);
 assert.match(source, /let visible = panel\?\.isVisible == true && \(panel\?\.alphaValue \?\? 0\) > 0/);
 assert.match(source, /if visible \{ restSchedule.firstVisible\(\) \}/);
 assert.match(source, /allowed: visible && !NSScreen.screens.isEmpty && \(!cinematic \|\| intro.finished\) && lifecycleAudio.idle/);
 assert.match(source, /restPrompt.show\(\)\s+lifecycleAudio.request\("activity", now: now\)/);
 assert.match(source, /alignEffects\(\); restPrompt.align\(\)/);
});

test("production awake schedule, bounded audio owner and offscreen interaction views", { skip: process.platform !== "darwin", timeout: 120_000 }, async () => {
 const root = process.env.FAIRY_REST_EVIDENCE ?? await mkdtemp("/tmp/fairy-rest-test-");
 await mkdir(root, { recursive: true });
 const source = await readFile(nativeURL, "utf8");
 const section = (a: string, b: string) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, a); return source.slice(start, end);
 };
 const fixture = "import AppKit\nimport Darwin\n"
  + section("enum FairySize:", "struct SizeSettings")
  + section("func restAwakeTime()", "let restSchedule =")
  + section("enum InteractionPalette", "final class RestPromptController")
  + section("final class SizeMenuView:", "final class SizeMenuController")
  + section("final class LifecycleAudio", "let lifecycleAudio =")
  + section("func lifecyclePaths(", "struct IntroLifetime")
  + `
let lifecycleSounds: String? = CommandLine.arguments[1]
let lifecyclePlayer = CommandLine.arguments[2]
let fullIntro = false
func introTrace(_ text: String) {}
var clock = 100.0
let schedule = RestSchedule(clock: { clock })
precondition(!schedule.presentIfDue(allowed: true)) // No qualified/visible pet yet.
schedule.firstVisible()
clock = 3699; precondition(!schedule.presentIfDue(allowed: true))
// Additional clients and reload/grace reconnect all revisit visibility, not reset.
for _ in 0..<20 { schedule.firstVisible() }
clock = 3700; precondition(!schedule.presentIfDue(allowed: false)) // welcome still owns audio
precondition(schedule.presentIfDue(allowed: true))
// Arbitrary wall sleep has no effect: awake clock remains fixed. No replay on wake.
for _ in 0..<100 { precondition(!schedule.presentIfDue(allowed: true)); schedule.firstVisible() }
clock += 7 * 86400; precondition(!schedule.presentIfDue(allowed: true)); precondition(schedule.unresolved)
precondition(schedule.choose(later: true)); precondition(!schedule.choose(later: false))
let clicked = clock
clock += 299; precondition(!schedule.presentIfDue(allowed: true))
clock = clicked - 100; precondition(!schedule.presentIfDue(allowed: true)) // rollback never accelerates
clock = clicked + 300; precondition(schedule.presentIfDue(allowed: true))
precondition(schedule.choose(later: false)); clock += 3599
precondition(!schedule.presentIfDue(allowed: true)); clock += 1
precondition(schedule.presentIfDue(allowed: true)); schedule.retire()
precondition(!schedule.unresolved && !schedule.choose(later: true))
clock += 100000; schedule.firstVisible(); precondition(!schedule.presentIfDue(allowed: true))
let next = RestSchedule(clock: { clock }); next.firstVisible(); precondition(!next.presentIfDue(allowed: true))
clock += 3600; precondition(next.presentIfDue(allowed: true))
precondition(restAwakeTime() > 0)
// Real production Process ownership, recording-only executable; no audio device.
let audio = LifecycleAudio()
audio.request("activity", now: 0)
precondition(audio.player != nil && !audio.idle && audio.deadline == 9)
let first = audio.player!.arguments![0]
audio.request("goodbye", now: 0.1) // farewell preempts our owned activity
precondition(audio.killAt == 0.3 || abs((audio.killAt ?? 0) - 0.3) < 1e-12)
precondition(audio.pending == "goodbye")
for i in 1...100 { usleep(10000); audio.tick(0.1 + Double(i) * 0.01); if audio.idle { break } }
precondition(audio.idle && audio.deadline < 9) // goodbye launched with its original 8s budget
audio.request("activity", now: 2)
precondition(audio.deadline == 11)
precondition(audio.player!.arguments![0] != first)
for i in 1...100 { usleep(10000); audio.tick(2 + Double(i) * 0.01); if audio.idle { break } }
precondition(audio.idle)
try FileManager.default.removeItem(atPath: lifecycleSounds!)
audio.request("activity", now: 4); precondition(audio.idle) // missing audio cannot wedge schedule
// NSViews only: no window creation, ordering, focus, event monitors or audio.
for visible in [NSRect(x: 0, y: 0, width: 640, height: 480), NSRect(x: -1920, y: -100, width: 1920, height: 1080)] {
 for x in [visible.minX, visible.midX, visible.maxX - 100] {
  for y in [visible.minY, visible.midY, visible.maxY - 100] {
   let prompt = restPromptFrame(pet: NSRect(x: x, y: y, width: 100, height: 100), visible: visible)
   let menu = menuBesideRest(prompt, visible: visible)
   precondition(visible.contains(prompt) && visible.contains(menu) && !prompt.intersects(menu))
   precondition(menu.width >= 180 && menu.height >= 170)
  }
 }
}
let output = CommandLine.arguments[3]
for scale in [1, 2] {
 for name in ["rest", "rest-hover", "menu", "menu-hover", "menu-warning"] {
  let view: NSView
  if name.hasPrefix("rest") {
   let rest = RestPromptView(frame: NSRect(x: 0, y: 0, width: 300, height: 164))
   if name == "rest-hover" { rest.hovered = 0 }
   var choices: [Bool] = []; rest.choose = { choices.append($0) }
   // Hit-test real view handlers; outside and right clicks cannot resolve.
   func event(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent {
    NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
   }
   rest.mouseDown(with: event(.leftMouseDown, NSPoint(x: 2, y: 2)))
   rest.rightMouseDown(with: event(.rightMouseDown, NSPoint(x: 20, y: 80)))
   precondition(choices.isEmpty)
   rest.mouseDown(with: event(.leftMouseDown, rest.convert(NSPoint(x: 30, y: 80), to: nil)))
   rest.mouseDown(with: event(.leftMouseDown, rest.convert(NSPoint(x: 30, y: 120), to: nil)))
   precondition(choices == [true, false])
   view = rest
  } else {
   let menu = SizeMenuView(frame: NSRect(x: 0, y: 0, width: 274, height: 270))
   menu.warning = name == "menu-warning"; if name == "menu-hover" { menu.hovered = .large }
   var choices: [FairySize] = []; var retries = 0, dismissals = 0
   menu.choose = { choices.append($0) }; menu.retry = { retries += 1 }; menu.dismiss = { dismissals += 1 }
   func click(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent {
    NSEvent.mouseEvent(with: type, location: menu.convert(point, to: nil), modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
   }
   for (index, size) in FairySize.allCases.enumerated() {
    menu.mouseDown(with: click(.leftMouseDown, NSPoint(x: 30, y: 55 + index * 34)))
    precondition(choices.last == size)
   }
   menu.mouseDown(with: click(.leftMouseDown, NSPoint(x: 30, y: 230)))
   precondition(retries == (menu.warning ? 1 : 0))
   menu.rightMouseDown(with: click(.rightMouseDown, NSPoint(x: 30, y: 30))); precondition(dismissals == 1)
   view = menu
  }
  let w = Int(view.bounds.width), h = Int(view.bounds.height)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w * scale, pixelsHigh: h * scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = view.bounds.size
  view.cacheDisplay(in: view.bounds, to: rep)
  try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/" + name + "-" + String(scale) + "x.png"))
 }
}
print("PASS production rest schedule / awake sleep / rollback / two choices / long unanswered / reconnect / retire / recording audio / missing assets / offscreen 1x 2x")
`;
 try {
  await writeFile(root + "/RestFixture.swift", fixture);
  await mkdir(root + "/sounds", { recursive: true });
  for (const name of ["activity-1.wav", "activity-2.wav", "activity-3.wav", "goodbye-1.wav"]) await writeFile(root + "/sounds/" + name, "recording fixture");
  await writeFile(root + "/player", "#!/usr/bin/python3\nimport sys,time\nwith open(" + JSON.stringify(root + "/audio.log") + ", 'a') as f: f.write(sys.argv[1] + '\\n')\ntime.sleep(.03)\n", { mode: 0o700 });
  const compiled = await run("/usr/bin/swiftc", [root + "/RestFixture.swift", "-o", root + "/RestFixture"], { timeout: 90_000 });
  await writeFile(root + "/fixture-compile.log", compiled.stderr);
  const result = await run(root + "/RestFixture", [root + "/sounds", root + "/player", root], { timeout: 10_000 });
  await writeFile(root + "/fixture.log", result.stdout + result.stderr);
  assert.match(result.stdout, /PASS production rest schedule/);
 } finally { if (!process.env.FAIRY_REST_EVIDENCE) await rm(root, { recursive: true, force: true }); }
});

test("real native reminder diagnostic options reject before resources or playback", { skip: process.platform !== "darwin", timeout: 120_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-rest-guard-");
 try {
  await run("/usr/bin/swiftc", [nativeURL.pathname, "-o", root + "/Fairy"], { timeout: 90_000 });
  for (const extra of [[], ["--headless"], ["--size-gui-test"], ["--effects-diagnostics"]]) {
   await assert.rejects(run(root + "/Fairy", [root + "/nonexistent-ipc", root + "/no-assets", "--rest-reminder", "--lifecycle-sounds", root + "/no-sounds", ...extra, ...(extra.length ? [] : ["--headless"])], {
    env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: root + "/preferences" }, timeout: 3000,
   }), (error: any) => error.code === 1 && /rest reminder requires a normal desktop launch/.test(error.stderr));
  }
 } finally { await rm(root, { recursive: true, force: true }); }
});
