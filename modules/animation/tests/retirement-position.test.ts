import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
test("production retirement retries failed completed-drag intent once and preserves independent settings", { skip: process.platform !== "darwin" }, async () => {
 const root = await mkdtemp((process.env.FAIRY_FIX_EVIDENCE ?? "/tmp") + "/retirement-");
 const source = await readFile(new URL("../native/Fairy.swift", import.meta.url), "utf8");
 const section = (a: string, b: string) => source.slice(source.indexOf(a), source.indexOf(b));
 const start = source.indexOf("        MainActor.assumeIsolated {", source.indexOf('introTrace("retirement commit'));
 const commit = source.slice(start, source.indexOf('        if appeared { lifecycleAudio.request("goodbye"', start));
 const resizeStart = source.indexOf("            MainActor.assumeIsolated {", source.indexOf("    func select(_ size:"));
 const resize = source.slice(resizeStart, source.indexOf("        }\n        do {", resizeStart));
 const intent = source.includes("struct RestingIntent") ? section("struct RestingIntent", "// End resting intent") : "";
 const text = `import AppKit\nimport Darwin\n` + section("enum FairySize:", "let preferenceOverride") + intent + section("func restingPosition", "// Approximate measured") + `
let preferences = SizePreferences(directory: URL(fileURLWithPath: CommandLine.arguments[1]))
var savedPosition: SavedPosition?
var restingIntent = RestingIntent()
struct Audio { func stop(_ now: Double = 0) {} }; let introSFX = Audio(), lifecycleAudio = Audio()
struct Life { var finished = true; var start: Double?; var welcomed = false; mutating func cancel() {} }; var intro = Life()
final class View { var introRaster: Int? }
var imageView: View?, introView: View?
struct Screen { var visibleFrame = NSRect(x: 0, y: 0, width: 1000, height: 800); var uuid: String }
final class FakePanel {
 var frame = NSRect(x: 600, y: 400, width: 200, height: 200)
 var screen: Screen?; var ignoresMouseEvents = false; var alphaValue = 1.0; var isVisible = false
 func orderOut(_ sender: Any?) {}; func close() {}
 func setFrame(_ value: NSRect, display: Bool) { frame = value }
}
var panel: FakePanel?, introCover: FakePanel?
let introTest = false, headless = false
var introLayout: [String] = []
func displayLayout() -> [String] { [] }
@MainActor func placeIntroPet(finishing: Bool) -> Bool { true }
@MainActor enum DesktopPlacement {
 static func displayUUID(_ screen: Screen) -> String? { screen.uuid }
` + section("static func captureRest", "\n}\nvar introCover") + `
}
` + section("@MainActor enum IntroCompletion", "@MainActor func beginIntro") + `
var outroRest: NSRect?, outroStart: Double?
let cinematic = false, appeared = false, now = 100.0, retiring = false
let selectedSize = FairySize.large
func disposeEffects() {}
final class Menu {
 var pendingPosition: SavedPosition?
 var retirementSaveAttempted = false
` + section("    @MainActor func saveDragPosition()", "    func retry()") + `
 func dismiss() {}
 func toggle(at point: NSPoint) {} // Only replace physical warning-window presentation.
 func resized(_ screen: Screen) {
` + resize + `
 }
}
let sizeMenu = Menu()
let desired = SavedPosition(display: "11111111-1111-4111-8111-111111111111", x: 0.2, y: 0.7)
try preferences.save(.large); try preferences.saveWelcome(.simple)
let backup = preferences.directory.appendingPathComponent("backup")
try FileManager.default.moveItem(at: preferences.file, to: backup)
try FileManager.default.createDirectory(at: preferences.file, withIntermediateDirectories: false)
panel = FakePanel(); panel?.screen = Screen(uuid: desired.display)
panel?.frame = sizedFrame(selectedSize, center: NSPoint(x: 200, y: 560), visible: panel!.screen!.visibleFrame)
MainActor.assumeIsolated { sizeMenu.saveDragPosition() }
precondition(sizeMenu.pendingPosition == desired && restingIntent.position == desired)
try FileManager.default.removeItem(at: preferences.file)
try FileManager.default.moveItem(at: backup, to: preferences.file)
` + commit + `
precondition(preferences.settings().position == desired, "retirement must retry completed drag after storage recovery")
precondition(preferences.load() == .large && preferences.settings().welcome == .simple)
let independent = SavedPosition(display: desired.display, x: 0.8, y: 0.1)
try preferences.savePosition(independent)
` + commit + `
precondition(preferences.settings().position == independent, "a repeated commit cannot overwrite a subsequent write")
try preferences.savePosition(desired)
print("PASS actual retirement persistence boundary: failed drag/recovery/preservation/idempotence")
MainActor.assumeIsolated {
 // Run the actual completion/capture boundary with physical windows replaced.
 for scenario in ["complete", "cancel", "missing-display", "no-display"] {
  restingIntent = RestingIntent(); savedPosition = scenario == "missing-display" ? desired : nil
  panel = FakePanel(); panel?.screen = scenario == "no-display" ? nil : Screen(uuid: scenario == "missing-display" ? "22222222-2222-4222-8222-222222222222" : desired.display)
  IntroCompletion.finishIntro(cancel: scenario == "cancel", now: 10)
  precondition((restingIntent.position != nil) == (scenario == "complete"))
  let menu = Menu(); menu.saveRetirementPosition()
  if scenario == "complete" {
   precondition(preferences.settings().position?.x == 0.7 && preferences.settings().position?.y == 0.625)
  }
 }
 // Execute the actual size-menu intent update after a size clamp shifts center.
 restingIntent.capture(desired, eligible: true)
 panel = FakePanel(); let resizeScreen = Screen(uuid: desired.display); panel?.screen = resizeScreen
 let resizing = Menu(); resizing.pendingPosition = desired
 resizing.resized(resizeScreen)
 precondition(resizing.pendingPosition?.x == 0.7 && resizing.pendingPosition?.y == 0.625)
 restingIntent.suspend(); panel?.frame = NSRect(x: 10, y: 10, width: 20, height: 20)
 resizing.resized(resizeScreen)
 precondition(resizing.pendingPosition?.x == 0.7, "fallback resize must not replace user intent")
 resizing.saveRetirementPosition(); precondition(preferences.settings().position?.x == 0.7)
 // Mid-motion and geometry notifications never authorize capture. A valid old
 // intent survives fallback/collapse rather than sampling their frame.
 restingIntent = RestingIntent(); panel = FakePanel(); panel?.screen = Screen(uuid: desired.display)
 DesktopPlacement.captureRest(eligible: false); precondition(restingIntent.position == nil)
 restingIntent.capture(desired, eligible: true); restingIntent.suspend()
 panel?.frame = NSRect(x: 0, y: 0, width: 0.01, height: 0.01)
 DesktopPlacement.captureRest(eligible: false)
 let menu = Menu(); menu.saveRetirementPosition()
 precondition(preferences.settings().position == desired)
 panel?.frame = NSRect(x: 20, y: 20, width: 10, height: 10)
 menu.saveRetirementPosition(); precondition(preferences.settings().position == desired)
}
print("PASS real completion boundary: normal default rest/cancel/missing display/no display/midpoint exclusions and retained intent")
// A final write failure is one bounded best-effort attempt, not a shutdown loop.
let failing = Menu(); failing.pendingPosition = independent
try FileManager.default.moveItem(at: preferences.file, to: backup)
try FileManager.default.createDirectory(at: preferences.file, withIntermediateDirectories: false)
failing.saveRetirementPosition()
precondition(failing.retirementSaveAttempted && failing.pendingPosition == independent)
try FileManager.default.removeItem(at: preferences.file)
try FileManager.default.moveItem(at: backup, to: preferences.file)
failing.saveRetirementPosition()
precondition(preferences.settings().position == desired && failing.pendingPosition == independent)
print("PASS final failure stays pending without a retry loop")
`;
 await writeFile(root + "/main.swift", text);
 await run("/usr/bin/swiftc", ["-O", root + "/main.swift", "-o", root + "/test"]);
 const result = await run(root + "/test", [root + "/settings"]);
 assert.match(result.stdout, /PASS actual retirement/);
 // A different process decodes the actual retired file, not a cached Swift value.
 const check = "import AppKit\nimport Darwin\n" + section("enum FairySize:", "let preferenceOverride") + `
let settings = SizePreferences(directory: URL(fileURLWithPath: CommandLine.arguments[1])).settings()
precondition(settings.position?.x == 0.2 && settings.position?.y == 0.7 && settings.size == .large && settings.welcome == .simple)
print("PASS fresh process restored retirement position")
`;
 await writeFile(root + "/read.swift", check); await run("/usr/bin/swiftc", [root + "/read.swift", "-o", root + "/read"]);
 console.log(result.stdout + (await run(root + "/read", [root + "/settings"])).stdout);
});
