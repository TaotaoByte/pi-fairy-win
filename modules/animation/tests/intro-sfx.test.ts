import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { desktopLaunchArguments } from "../src/desktop/client.ts";
const run = promisify(execFile);
const source = fileURLToPath(new URL("../native/Fairy.swift", import.meta.url));
const assets = fileURLToPath(new URL("../assets", import.meta.url));

test("intro SFX packaging/launch and diagnostic fail-closed guard", async () => {
 assert.deepEqual(desktopLaunchArguments("/private").slice(2), []);
 assert.deepEqual(desktopLaunchArguments("/private", "/sounds").slice(2), ["--intro-saved", "--rest-reminder", "--lifecycle-sounds", "/sounds", "--intro-sfx", assets + "/intro/sfx-v4.wav"]);
 const native = await readFile(source, "utf8");
 assert.match(native, /introSFXPath != nil && \(\(!fullIntro && !savedIntro\) \|\| headless \|\| introTest/);
 assert.match(native, /\$0.contains\("diagnostics"\)/);
 assert.match(native, /cover.orderFrontRegardless\(\)\s+introSFX.begin\(path: introSFXPath, start: now\)/);
 assert.match(native, /func cleanup\(\) \{\s+introSFX.stop\(\)/);
 assert.match(native, /retiring = true\s+introSFX.stop\(\)/);
 for (const signal of ["termination", "interrupt"]) assert.ok(native.includes(signal + ".setEventHandler { stopping = true; introSFX.stop() }"));
 assert.match(native, /DispatchQueue.global\(qos: .utility\).async[\s\S]*prepareToPlay\(\)[\s\S]*DispatchQueue.main.async/);
 assert.match(native, /elapsed >= 0, elapsed < IntroSample.end, let prepared/);
 assert.match(native, /prepared.duration >= IntroSample.end, prepared.duration <= 10.1/);
 assert.match(native, /now - lastTick > 1 \|\| elapsed >= IntroSample.end/);
 const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
 for (const path of ["modules/animation/assets/", "modules/animation/scripts/", "modules/animation/native/"]) assert.ok(manifest.files.includes(path));
});

test("IntroSFX production owner and finish/update cancellation with fake player, no windows/device", { skip: process.platform !== "darwin", timeout: 40_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-sfx-state-");
 try {
  const native = await readFile(source, "utf8");
  const section = (a: string, b: string) => native.slice(native.indexOf(a), native.indexOf(b));
  const swift = "import AppKit\n"
   + section("protocol IntroSFXPlayer", "extension AVAudioPlayer")
   + section("final class IntroSFX {", "func prepareIntroSFX")
   + section("enum FairySize:", "struct SizeSettings")
   + section("func sizedFrame(", "let preferenceOverride")
   + section("struct IntroSample", "final class IntroView")
   + `
final class FakePlayer: IntroSFXPlayer {
 var duration = 10.0; var seeks: [Double] = []; var currentTime = 0.0 { didSet { seeks.append(currentTime) } }
 var plays = 0, stops = 0; var succeeds = true
 func play() -> Bool { plays += 1; return succeeds }
 func stop() { stops += 1 }
}
var now = 100.0, loads = 0
var completion: ((IntroSFXPlayer?) -> Void)?
func owner() -> IntroSFX {
 IntroSFX(clock: { now }, load: { _, done in loads += 1; completion = done })
}
var introSFX = owner()
struct Audio { var requests: [String] = []; var stops = 0; mutating func stop(_ now: Double) { stops += 1 }; mutating func request(_ cue: String, now: Double) { requests.append(cue) } }
class View { var introRaster: IntroRaster?; var sample = IntroSample(elapsed: 0); var date = Date(); var needsDisplay = false }
var intro = IntroLifetime(), lifecycleAudio = Audio()
var panel: NSPanel?, introCover: NSPanel?, effectPanel: NSPanel?, introView: View?, imageView: View?
var introScreen: NSScreen?; var introLayout: [String] = []
let simpleIntro = false
let introTest = false, headless = true; let preferenceOverride: String? = nil
let selectedSize = FairySize.standard
struct Menu { let window: NSPanel? = nil }; let sizeMenu = Menu()
func displayLayout() -> [String] { [] }
@MainActor enum DesktopPlacement {
 static func landingFrame(_ screen: NSScreen) -> NSRect { introLanding(selectedSize, visible: screen.visibleFrame) }
 static func displayUUID(_ screen: NSScreen) -> String? { nil }
 static func captureRest(eligible: Bool) {}
}
var savedPosition: SavedPosition?
struct Intent { mutating func suspend() {} }; var restingIntent = Intent()
@MainActor func placeIntroPet(finishing: Bool) -> Bool { true }
`
   + section("@MainActor enum IntroCompletion", "@MainActor func beginIntro")
   + section("@MainActor func updateIntro", "// Original idle-only sampler")
   + `
// Missing option, load failure, bad duration, failed play, stale prep and cancel-before-load.
for mode in ["nil-path", "missing/bad-file", "bad-duration", "short-duration", "long-duration", "play-failure", "stale", "cancel-pending"] {
 now = 100; loads = 0; completion = nil; let sfx = owner(); let p = FakePlayer()
 sfx.begin(path: mode == "nil-path" ? nil : "/fixture", start: now)
 if mode == "nil-path" { precondition(loads == 0) }
 else {
  if mode == "bad-duration" { p.duration = .nan }
  if mode == "short-duration" { p.duration = 9.99 }
  if mode == "long-duration" { p.duration = 10.11 }
  if mode == "play-failure" { p.succeeds = false }
  if mode == "stale" { now += 1.01 }
  if mode == "cancel-pending" { sfx.stop() }
  completion?(mode == "missing/bad-file" ? nil : p)
  precondition(p.plays == (mode == "play-failure" ? 1 : 0))
  if mode != "missing/bad-file" { precondition(p.stops == 1) }
 }
 sfx.begin(path: "/reconnect", start: now); precondition(loads <= 1)
}
// Successful asynchronous preparation uses completion-time offset, seeks only once.
now = 100; loads = 0; let sfx = owner(); let p = FakePlayer()
sfx.begin(path: "/fixture", start: now); now = 100.24; sfx.tick(now, elapsed: 0.24); completion?(p)
precondition(p.plays == 1 && abs(p.seeks[0] - 0.24) < 1e-10)
for tick in 1...180 { now = 100.24 + Double(tick) * 0.05; sfx.tick(now, elapsed: now - 100); sfx.begin(path: "/extra-lease", start: now) }
precondition(loads == 1 && p.seeks.count == 1 && p.stops == 0)
for elapsed in [9.3, 9.99] {
 now = 100 + elapsed; sfx.tick(now, elapsed: elapsed)
 precondition(p.stops == 0 && p.plays == 1 && p.seeks.count == 1)
}
now = 110; sfx.tick(now, elapsed: 10); precondition(p.stops == 1)
sfx.begin(path: "/after-end", start: now); sfx.tick(110.1, elapsed: 10.1)
precondition(loads == 1 && p.plays == 1 && p.seeks.count == 1)
sfx.stop(); precondition(p.stops == 1)
// Pending completion cannot start at/after the intro endpoint, even with fresh ticks.
now = 100; let tail = owner(); let tailPlayer = FakePlayer(); tail.begin(path: "/fixture", start: now)
for i in 1...200 { now = 100 + Double(i) * 0.05; tail.tick(now, elapsed: now - 100) }
completion?(tailPlayer); precondition(tailPlayer.plays == 0 && tailPlayer.stops == 1)
// Late begin cannot seek past end, even without a subsequent tick.
for elapsed in [10.0, 10.01] {
 now = 100; let ended = owner(); let endedPlayer = FakePlayer()
 ended.begin(path: "/late-begin", start: now - elapsed); completion?(endedPlayer)
 precondition(endedPlayer.plays == 0 && endedPlayer.stops == 1)
 ended.begin(path: "/replay", start: now)
 precondition(endedPlayer.plays == 0)
}
// Stop-before-load through production finish, then callback cannot resurrect.
MainActor.assumeIsolated {
 for cancel in [false,true] {
  now = 100; introSFX = owner(); introSFX.begin(path: "/fixture", start: now)
  let pending = FakePlayer(); IntroCompletion.finishIntro(cancel: cancel, now: now); now += 0.2; completion?(pending)
  precondition(pending.plays == 0 && pending.stops == 1)
 }
}
// Production update/finish exercise welcome independence and actual cancellation calls.
MainActor.assumeIsolated {
 for mode in ["lease", "display", "resumed", "cancel-before", "lease-after", "finish", "retirement"] {
  now = 100; intro = IntroLifetime(); intro.begin(now); lifecycleAudio = Audio(); introSFX = owner()
  introSFX.begin(path: "/fixture", start: now); let player = FakePlayer(); now += 0.1; completion?(player)
  if mode == "lease-after" || mode == "finish" {
   for i in 1...156 { now = 100 + Double(i) * 0.05; updateIntro(now, hasLease: true) }
   precondition(lifecycleAudio.requests == ["welcome"])
  }
  if mode == "lease-after" { updateIntro(now + 0.05, hasLease: false) }
  else if mode == "lease" { updateIntro(100.2, hasLease: false) }
  else if mode == "resumed" { updateIntro(102, hasLease: true) }
  else if mode == "display" {
   precondition(intro.tick(100.2, lease: true, displayValid: false).cancelled)
   IntroCompletion.finishIntro(cancel: true, now: 100.2)
  } else { IntroCompletion.finishIntro(cancel: mode != "finish", now: now) }
  precondition(player.stops == 1)
  precondition(lifecycleAudio.stops == (mode == "finish" ? 0 : 1))
  introSFX.begin(path: "/reload", start: 200); precondition(player.plays == 1)
 }
}
print("PASS IntroSFX: once/async seek/failure/stale/pending cancel/tail; production finish/update lease/cancel/display/resume/retirement; welcome independent")
`;
  await writeFile(root + "/state.swift", swift);
  await run("/usr/bin/swiftc", [root + "/state.swift", "-o", root + "/state"], { timeout: 30_000 });
  const { stdout, stderr } = await run(root + "/state", [], { timeout: 5000 });
  assert.equal(stderr, ""); assert.match(stdout, /PASS IntroSFX/); console.log(stdout.trim());
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("IntroDim endpoints/depth/no late pulses and IntroView offscreen 1x/2x alpha/no-button/rest comparisons", { skip: process.platform !== "darwin", timeout: 90_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-sfx-dim-");
 try {
  const native = await readFile(source, "utf8");
  const section = (a: string, b: string) => native.slice(native.indexOf(a), native.indexOf(b));
  const view = section("final class IntroView", "var intro = IntroLifetime()");
  assert.match(view, /IntroRaster\(screenHeight: h[\s\S]*IntroDim\(elapsed: sample.elapsed\).draw\(in: bounds\)[\s\S]*NSGraphicsContext.restoreGraphicsState/);
  // Undimmed same-time control differs only by omission of the new overlay.
  const control = view.replace("final class IntroView", "final class UndimmedIntroView").replace("        IntroDim(elapsed: sample.elapsed).draw(in: bounds)\n", "");
  const swift = "import AppKit\nimport CoreText\n"
   + section("enum FairySize:", "struct SizeSettings")
   + section("func sizedFrame(", "let preferenceOverride")
   + section("struct IntroSample", "final class IntroView")
   + section("struct IdleEffects", "func drawRipples") + view + control + `
for (start, duration, depth) in [(0.55,0.18,0.06),(3.35,0.18,0.07),(4.85,0.20,0.08)] {
 precondition(IntroDim(elapsed: start).brightness == 1)
 precondition(IntroDim(elapsed: start + duration).brightness == 1)
 precondition(abs(IntroDim(elapsed: start + duration/2).brightness - (1-depth)) < 1e-12)
 for i in 0...1000 {
  let u = Double(i)/1000, b = IntroDim(elapsed: start + duration*u).brightness
  precondition(b <= 1 && b >= 1-depth)
  precondition(abs(b - (1-depth*pow(sin(.pi*u),2))) < 1e-12)
 }
}
for i in 6700...11000 { precondition(IntroDim(elapsed: Double(i)/1000).brightness == 1) }
@MainActor func raster(_ view: NSView, scale: Int) -> NSBitmapImageRep {
 let b = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(view.bounds.width)*scale, pixelsHigh: Int(view.bounds.height)*scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
 b.size = view.bounds.size; view.cacheDisplay(in: view.bounds, to: b); return b
}
MainActor.assumeIsolated {
 for (w,h) in [(480,300),(300,480),(630,270),(791,294)] { for scale in [1,2] {
  for time in [0.3,0.55,0.64,0.73,3.35,3.44,3.53,4.85,4.95,5.05,6.7,8.6,9.3,10.0] {
   let v = IntroView(frame: NSRect(x: 0,y: 0,width: w,height: h)), c = UndimmedIntroView(frame: NSRect(x: 0,y: 0,width: w,height: h))
   v.sample = IntroSample(elapsed: time); c.sample = v.sample
   v.date = Date(timeIntervalSince1970: 3661); c.date = v.date
   let a = raster(c, scale: scale), b = raster(v, scale: scale)
   if [0.64,3.44,4.95].contains(time), let output = CommandLine.arguments.dropFirst().first {
    let label = String(w) + "x" + String(h) + "-" + String(scale) + "x-" + String(time)
    try! a.representation(using:.png,properties:[:])!.write(to: URL(fileURLWithPath: output + "/" + label + "-rest.png"))
    try! b.representation(using:.png,properties:[:])!.write(to: URL(fileURLWithPath: output + "/" + label + "-pulse.png"))
   }
   var dimmed = 0, formerButtonDimmed = 0
   for y in 0..<b.pixelsHigh { for x in stride(from: 0, to: b.pixelsWide, by: 3) {
    let old = a.colorAt(x:x,y:y)!.usingColorSpace(.sRGB)!, new = b.colorAt(x:x,y:y)!.usingColorSpace(.sRGB)!
    precondition(old.alphaComponent == new.alphaComponent, "alpha preserved")
    let oldRGB = [old.redComponent,old.greenComponent,old.blueComponent], newRGB = [new.redComponent,new.greenComponent,new.blueComponent]
    let point = NSPoint(x: Double(x)/Double(scale), y: Double(h)-Double(y+1)/Double(scale))
    if NSRect(x: w-124,y: h-54,width:108,height:32).contains(point) && oldRGB != newRGB { formerButtonDimmed += 1 }
    if IntroDim(elapsed: time).brightness == 1 {
     precondition(oldRGB == newRGB, "rest unchanged")
    } else {
     // Generic RGB is the compositing space. ICC conversion mixes channels;
     // a one-code green decrease can increase converted sRGB red slightly.
     let rawOld = a.colorAt(x:x,y:y)!, rawNew = b.colorAt(x:x,y:y)!
     precondition(rawNew.redComponent <= rawOld.redComponent && rawNew.greenComponent <= rawOld.greenComponent && rawNew.blueComponent <= rawOld.blueComponent, "dim-only compositing channels")
     if oldRGB != newRGB { dimmed += 1 }
    }
   } }
   if IntroDim(elapsed: time).brightness < 1 { precondition(dimmed > 100 && formerButtonDimmed > 5, "former button region is ordinary dimmed canvas") }
  }
 } }
 // Graded-alpha overlay independently: dim may not fill transparent pixels.
 let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:30,pixelsHigh:10,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.calibratedRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:bitmap)
 NSColor.clear.setFill(); NSRect(x:0,y:0,width:30,height:10).fill(using:.copy)
 NSColor(srgbRed:0.5,green:0.6,blue:0.7,alpha:0.4).setFill(); NSRect(x:10,y:0,width:10,height:10).fill()
 let alpha = bitmap.colorAt(x:15,y:5)!.alphaComponent
 IntroDim(elapsed:4.95).draw(in:NSRect(x:0,y:0,width:30,height:10))
 precondition(bitmap.colorAt(x:15,y:5)!.alphaComponent == alpha && bitmap.colorAt(x:0,y:5)!.alphaComponent == 0)
 NSGraphicsContext.restoreGraphicsState()
}
print("PASS IntroDim: exact envelopes; 112 offscreen pulse/rest pairs, four aspect ratios x 1x/2x; raw dim-only, exact alpha/rest and ordinary canvas at former button")
`;
  await writeFile(root + "/dim.swift", swift);
  await run("/usr/bin/swiftc", [root + "/dim.swift", "-o", root + "/dim"], { timeout: 30_000 });
  const evidence = process.env.FAIRY_INTRO_AV_RASTERS;
  if (evidence) await mkdir(evidence, { recursive: true });
  const { stdout, stderr } = await run(root + "/dim", evidence ? [evidence] : [], { timeout: 50_000, env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: root + "/settings" } });
  assert.equal(stderr, ""); assert.match(stdout, /PASS IntroDim/); console.log(stdout.trim());
 } finally { await rm(root, { recursive: true, force: true }); }
});

// This executes only the real fail-closed argument guard, before sockets/windows/player.
test("native intro SFX diagnostics reject device playback before creating resources", { skip: process.platform !== "darwin", timeout: 40_000 }, async () => {
 const root = await mkdtemp("/tmp/fairy-sfx-guard-");
 try {
  await run("/usr/bin/swiftc", [source, "-o", root + "/Fairy"], { timeout: 30_000 });
  const privateDir = root + "/private"; await mkdir(privateDir, { mode: 0o700 });
  for (const flags of [["--intro-full", "--headless"], ["--intro-full", "--intro-test"], ["--intro-full", "--intro-diagnostics"], []]) {
   await assert.rejects(run(root + "/Fairy", [privateDir, assets, ...flags, "--intro-sfx", "/missing.wav"], {
    timeout: 3000, env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: privateDir + "/settings" },
   }), (error: any) => error.code === 1 && error.stderr.includes("diagnostics use an injected fake backend"));
   assert.deepEqual(await readdir(privateDir), [], "guard precedes sockets/preferences/device");
  }
 } finally { await rm(root, { recursive: true, force: true }); }
});
