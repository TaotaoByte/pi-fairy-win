// Original MIT runtime; PNG artwork retains the Apache-2.0 scope in ../NOTICE.
import AppKit
import CoreText
import AVFoundation
import Darwin

func fail(_ text: String) -> Never {
    fputs("Fairy: \(text)\n", stderr); exit(1)
}
enum FairySize: String, Codable, CaseIterable {
    case xsmall, small, standard, large, xlarge
    var multiplier: CGFloat { [0.70, 0.85, 1, 1.20, 1.45][Self.allCases.firstIndex(of: self)!] }
    var points: CGFloat { 238 * multiplier }
}
enum WelcomeMode: String, Codable { case full, simple }
struct SavedPosition: Codable, Equatable {
    let display: String
    let x: Double
    let y: Double
    var valid: Bool { UUID(uuidString: display) != nil && x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y) }
}
struct SizeSettings: Codable {
    var version = 2
    var size: FairySize = .standard
    var welcome: WelcomeMode = .full
    var position: SavedPosition?
    enum CodingKeys: String, CodingKey { case version, size, welcome, position }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let version = try c.decode(Int.self, forKey: .version)
        guard version == 1 || version == 2 else { throw CocoaError(.coderReadCorrupt) }
        size = (try? c.decode(FairySize.self, forKey: .size)) ?? .standard
        welcome = (try? c.decode(WelcomeMode.self, forKey: .welcome)) ?? .full
        if let p = try? c.decode(SavedPosition.self, forKey: .position), p.valid { position = p }
    }
}
struct SizePreferences {
    let directory: URL
    var file: URL { directory.appendingPathComponent("settings.json") }
    func readSettings() throws -> SizeSettings {
        let data: Data
        do { data = try Data(contentsOf: file) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return SizeSettings() }
        guard data.count <= 4096, let value = try? JSONDecoder().decode(SizeSettings.self, from: data) else { return SizeSettings() }
        return value
    }
    func settings() -> SizeSettings { (try? readSettings()) ?? SizeSettings() }
    func load() -> FairySize { settings().size }
    // Only the flock owner (desktop or short-lived offline command) writes.
    // Reread inside that authority: never overwrite another setting from a snapshot.
    func update(_ change: (inout SizeSettings) -> Void) throws {
        var value = try readSettings(); change(&value)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: file, options: .atomic)
    }
    func save(_ size: FairySize) throws { try update { $0.size = size } }
    func saveWelcome(_ mode: WelcomeMode) throws { try update { $0.welcome = mode } }
    func savePosition(_ position: SavedPosition) throws {
        guard position.valid else { throw CocoaError(.validationMissingMandatoryProperty) }
        try update { $0.position = position }
    }
}
func sizedFrame(_ size: FairySize, center: NSPoint, visible: NSRect) -> NSRect {
    let side = min(size.points, visible.width, visible.height)
    return NSRect(x: min(max(visible.minX, center.x - side / 2), visible.maxX - side),
                  y: min(max(visible.minY, center.y - side / 2), visible.maxY - side), width: side, height: side)
}
let preferenceOverride = ProcessInfo.processInfo.environment["FAIRY_SETTINGS_DIRECTORY"]
let preferences = SizePreferences(directory: preferenceOverride.map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/pi-fairy-animation"))
var selectedSize = preferences.load()
// Explicit isolated diagnostics; never uses the real preference directory.
func sizeSelfTest() throws {
    guard preferenceOverride != nil else { fail("self-test requires FAIRY_SETTINGS_DIRECTORY") }
    if CommandLine.arguments.contains("--expect-large") {
        precondition(preferences.load() == .large)
        print("PASS size preference survives a new process")
        return
    }
    precondition(preferences.load() == .standard)
    for size in FairySize.allCases {
        try preferences.save(size)
        precondition(preferences.load() == size)
        let visible = NSRect(x: -1200, y: -100, width: 1000, height: 800)
        let center = NSPoint(x: -700, y: 300)
        let frame = sizedFrame(size, center: center, visible: visible)
        precondition(abs(frame.width - size.points) < 0.001 && frame.midX == center.x && frame.midY == center.y)
        precondition(visible.contains(sizedFrame(size, center: NSPoint(x: -1200, y: 900), visible: visible)))
        precondition(sizedFrame(size, center: .zero, visible: NSRect(x: 0, y: 0, width: 80, height: 90)).width == 80)
    }
    for text in ["{}", "broken", "{\"version\":99,\"size\":\"large\"}", "{\"version\":1,\"size\":\"huge\"}"] {
        try Data(text.utf8).write(to: preferences.file)
        precondition(preferences.load() == .standard)
    }
    try FileManager.default.removeItem(at: preferences.file)
    try Data().write(to: preferences.file)
    let blocked = SizePreferences(directory: preferences.file)
    do { try blocked.save(.large); fail("save should fail") } catch {}
    try FileManager.default.removeItem(at: preferences.file)
    try preferences.save(.large)
    print("PASS size preferences: all presets, round-trip, invalid/version fallback, write failure, center/clamp/tiny screen")
}
let args = CommandLine.arguments
if args.contains("--size-self-test") {
    do { try sizeSelfTest(); exit(0) } catch { fail("size self-test: \(error)") }
}
let guiSizeTest = args.contains("--size-gui-test")
if guiSizeTest && preferenceOverride == nil { fail("GUI size test requires FAIRY_SETTINGS_DIRECTORY") }
let headless = args.contains("--headless")
guard args.count >= 3 else { fail("usage: Fairy private-directory assets-directory [--headless]") }
let directory = args[1], assets = args[2]
func option(_ name: String) -> String? {
    guard let index = args.firstIndex(of: name) else { return nil }
    guard index + 1 < args.count, args[index + 1].hasPrefix("/") else { fail("\(name) requires an absolute path") }
    return args[index + 1]
}
// Audio is opt-in: animation-only launches and GUI diagnostics remain silent.
let savedIntro = args.contains("--intro-saved")
var fullIntro = args.contains("--intro-full")
var simpleIntro = false
var cinematic: Bool { fullIntro || simpleIntro }
let introTest = args.contains("--intro-test")
if introTest && (preferenceOverride == nil || !fullIntro) { fail("intro test requires private preferences and --intro-full") }
func introTrace(_ text: String) {
    if introTest { print("TRACE \(ProcessInfo.processInfo.systemUptime) \(text)"); fflush(stdout) }
}
let lifecycleSounds = option("--lifecycle-sounds")
let restReminder = args.contains("--rest-reminder")
if restReminder && (lifecycleSounds == nil || headless || args.contains(where: { $0.hasPrefix("--") && ($0.contains("test") || $0.contains("diagnostics")) })) {
    fail("rest reminder requires a normal desktop launch with lifecycle sounds; tests use injected owners")
}
let lifecyclePlayer = option("--lifecycle-player") ?? "/usr/bin/afplay"
if args.contains("--lifecycle-player") && lifecycleSounds == nil { fail("player requires lifecycle sounds") }
if (headless || introTest) && lifecycleSounds != nil && !args.contains("--lifecycle-player") { fail("headless/test audio requires an explicit recording player") }
// Explicit asset opt-in; diagnostic invocations must never open an audio device.
var introSFXPath = option("--intro-sfx")
if introSFXPath != nil && ((!fullIntro && !savedIntro) || headless || introTest || args.contains(where: { $0.hasPrefix("--") && ($0.contains("diagnostics") || $0.contains("test")) })) {
    fail("intro SFX requires a normal full opening; diagnostics use an injected fake backend")
}
// Ownership and callbacks run on main. Only preparation runs off-main, so slow
// file/device initialization cannot hold the visual timeline or welcome request.
protocol IntroSFXPlayer: AnyObject {
    var duration: TimeInterval { get }
    var currentTime: TimeInterval { get set }
    func play() -> Bool
    func stop()
}
extension AVAudioPlayer: IntroSFXPlayer {}
final class IntroSFX {
    typealias Load = (String, @escaping (IntroSFXPlayer?) -> Void) -> Void
    private let load: Load
    private let clock: () -> TimeInterval
    private var attempted = false
    private var active = false
    private var lastTick: TimeInterval = 0
    private var player: IntroSFXPlayer?
    init(clock: @escaping () -> TimeInterval, load: @escaping Load) {
        self.clock = clock; self.load = load
    }
    func begin(path: String?, start: TimeInterval) {
        guard !attempted else { return }
        attempted = true
        guard let path else { return }
        active = true; lastTick = start
        let requested = clock()
        load(path) { [weak self] prepared in
            guard let self else { prepared?.stop(); return }
            let now = self.clock(), elapsed = now - start
            guard self.active, now - requested <= 1, now - self.lastTick <= 1,
                  elapsed >= 0, elapsed < IntroSample.end, let prepared,
                  prepared.duration.isFinite, prepared.duration >= IntroSample.end, prepared.duration <= 10.1 else {
                prepared?.stop(); self.stop(); return
            }
            // A single best-effort seek; no retries or drift-chasing. Device output
            // latency is not measured/compensated by this monotonic media offset.
            prepared.currentTime = elapsed
            self.player = prepared
            if !prepared.play() { self.stop() }
        }
    }
    func tick(_ now: TimeInterval, elapsed: TimeInterval) {
        guard active else { return }
        if now - lastTick > 1 || elapsed >= IntroSample.end { stop(); return }
        lastTick = now
    }
    func stop() {
        active = false
        player?.stop(); player = nil
    }
}
func prepareIntroSFX(_ path: String, completion: @escaping (IntroSFXPlayer?) -> Void) {
    DispatchQueue.global(qos: .utility).async {
        let player = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
        let prepared = player?.prepareToPlay() == true ? player : nil
        DispatchQueue.main.async { completion(prepared) }
    }
}
let introSFX = IntroSFX(clock: { ProcessInfo.processInfo.systemUptime }, load: prepareIntroSFX)

final class LifecycleAudio {
    var player: Process?
    var pending: String?
    var deadline: TimeInterval = 0
    var killAt: TimeInterval?
    var previousActivity: String?
    func stop(_ now: TimeInterval) {
        introTrace("audio stop pid=\(player?.processIdentifier ?? 0)")
        pending = nil
        if let player, player.isRunning, killAt == nil { player.terminate(); killAt = now + 0.2 }
    }
    func request(_ cue: String, now: TimeInterval) {
        guard lifecycleSounds != nil else { return }
        pending = cue
        introTrace("audio request \(cue)")
        if let player, player.isRunning { player.terminate(); killAt = now + 0.2 }
        tick(now)
    }
    func tick(_ now: TimeInterval) {
        if let process = player {
            if process.isRunning {
                if let killAt, now >= killAt { kill(process.processIdentifier, SIGKILL) }
                else if now >= deadline && killAt == nil { process.terminate(); killAt = now + 0.2 }
                return
            }
            introTrace("audio reaped pid=\(process.processIdentifier)")
            player = nil; killAt = nil
        }
        guard let cue = pending, let directory = lifecycleSounds else { return }
        pending = nil
        let paths = lifecyclePaths(cue, directory: directory, full: fullIntro).filter { FileManager.default.isReadableFile(atPath: $0) }
        let candidates = cue == "activity" && paths.count > 1 ? paths.filter { $0 != previousActivity } : paths
        guard let path = candidates.randomElement() else { return }
        if cue == "activity" { previousActivity = path }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: lifecyclePlayer)
        process.arguments = [path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            introTrace("audio Process.run begin cue=\(cue)")
            try process.run(); player = process; deadline = now + (cue == "activity" ? 9 : 8)
            introTrace("audio Process.run returned pid=\(process.processIdentifier) deadline=\(deadline)")
        }
        catch { fputs("Fairy: lifecycle player failed: \(error)\n", stderr) }
    }
    var idle: Bool { player == nil && pending == nil }
}
let lifecycleAudio = LifecycleAudio()
var info = stat()
guard lstat(directory, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0 else { fail("unsafe private directory") }
umask(0o077)
let lock = open(directory + "/lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
guard lock >= 0, fstat(lock, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0 else { fail("unsafe lock") }
// Never unlink this inode: OS releases flock even after SIGKILL.
let welcomeCommand = args.firstIndex(of: "--welcome-setting")
guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
    if welcomeCommand != nil { fail("desktop owner busy; retry after all Pi desktop leases close") }
    exit(0)
}
if let index = welcomeCommand {
    do {
        if index + 1 < args.count {
            guard let mode = WelcomeMode(rawValue: args[index + 1]) else { fail("invalid welcome mode") }
            try preferences.saveWelcome(mode)
        }
        print(try preferences.readSettings().welcome.rawValue); exit(0)
    } catch { fail("welcome NOT SAVED: \(error)") }
}
selectedSize = preferences.load()
var savedPosition = preferences.settings().position
if savedIntro {
    fullIntro = preferences.settings().welcome == .full
    simpleIntro = !fullIntro
    if simpleIntro { introSFXPath = nil }
}
let path = directory + "/sock"
guard path.utf8.count < 104 else { fail("socket path too long") }
var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
withUnsafeMutableBytes(of: &address.sun_path) { target in
    _ = path.withCString { memcpy(target.baseAddress!, $0, path.utf8.count + 1) }
}
func withAddress<T>(_ body: (UnsafePointer<sockaddr>, socklen_t) -> T) -> T {
    withUnsafePointer(to: &address) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
}
if lstat(path, &info) == 0 {
    guard (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == getuid() else { fail("unsafe socket") }
    let probe = socket(AF_UNIX, SOCK_STREAM, 0)
    _ = fcntl(probe, F_SETFL, O_NONBLOCK)
    let result = withAddress { connect(probe, $0, $1) }
    let code = errno
    close(probe)
    guard result < 0, code == ECONNREFUSED || code == ENOENT else { fail("socket active without our lock; refusing removal") }
    guard unlink(path) == 0 else { fail("stale socket removal failed") }
}
let server = socket(AF_UNIX, SOCK_STREAM, 0)
_ = fcntl(server, F_SETFD, FD_CLOEXEC)
guard server >= 0, withAddress({ bind(server, $0, $1) }) == 0 else { fail("bind failed") }
guard listen(server, 32) == 0, fcntl(server, F_SETFL, O_NONBLOCK) == 0 else { fail("listen failed") }
var socketInfo = stat()
_ = lstat(path, &socketInfo)
func cleanup() {
    introSFX.stop()
    var current = stat()
    if lstat(path, &current) == 0 && current.st_ino == socketInfo.st_ino && current.st_dev == socketInfo.st_dev { unlink(path) }
    close(server)
}

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
// Full opening is an elapsed-time presentation, never a computer scan. Timing is
// intentionally approximate; wall time is used only by the displayed clock.
struct IntroSample {
    static let clockStart = 0.7, slipStart = 2.7, errorsStart = 3.4, hddStart = 4.9
    static let revealStart = 6.7, welcomeStart = 7.2, moveStart = 7.8, end = 10.0
    let elapsed: Double
    var phase: String {
        if elapsed < Self.clockStart { return "signal" }
        if elapsed < Self.slipStart { return "clock" }
        if elapsed < Self.errorsStart { return "slip" }
        if elapsed < Self.hddStart { return "errors" }
        if elapsed < Self.revealStart { return "hdd" }
        if elapsed < Self.welcomeStart { return "reveal" }
        if elapsed < Self.moveStart { return "hold" }
        return elapsed < Self.end ? "fade" : "end"
    }
    func progress(_ start: Double, _ end: Double) -> CGFloat { CGFloat(min(1, max(0, (elapsed - start) / (end - start)))) }
    var loading: CGFloat { progress(Self.hddStart, Self.revealStart - 0.1) }
    var materialized: CGFloat { progress(Self.revealStart, Self.welcomeStart) }
    var motion: CGFloat { let p = progress(Self.moveStart, Self.end); return p * p * (3 - 2 * p) }
    var background: CGFloat { 1 - progress(Self.moveStart, Self.moveStart + 1.5) }
    var errorCount: Int { min(9, max(0, Int((elapsed - Self.errorsStart) / 0.17) + 1)) }
    func clock(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute, .second], from: date)
        return String(format: "%02d  %02d  %02d", c.hour!, c.minute!, c.second!)
    }
}
// Three brief dim-only cover pulses; no monitor/gamma or pet state changes.
struct IntroDim {
    let elapsed: Double
    var brightness: Double {
        for (start, duration, depth) in [(0.55, 0.18, 0.06), (3.35, 0.18, 0.07), (4.85, 0.20, 0.08)] {
            let u = (elapsed - start) / duration
            if u > 0 && u < 1 { return 1 - depth * pow(sin(.pi * u), 2) }
        }
        return 1
    }
    func draw(in bounds: NSRect) {
        guard brightness < 1, let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.setBlendMode(.sourceAtop)
        context.setFillColor(NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 1 - brightness).cgColor)
        context.fill(bounds)
        context.restoreGState()
    }
}
// One logical-point grid in cover coordinates, shared by the separate pet panel.
// sourceAtop preserves graded artwork/cover alpha; never paints transparent margins.
struct IntroRaster {
    let screenHeight: CGFloat
    let originY: CGFloat
    let opacity: CGFloat
    func draw(in bounds: NSRect) {
        guard opacity > 0, let context = NSGraphicsContext.current?.cgContext else { return }
        let count = min(500, Int(screenHeight / 3))
        guard count > 0 else { return }
        context.saveGState()
        context.setBlendMode(.sourceAtop)
        context.setFillColor(NSColor(srgbRed: 0.78, green: 0.91, blue: 0.96, alpha: 0.035 * opacity).cgColor)
        for row in 0..<count {
            let y = CGFloat(row) * screenHeight / CGFloat(count) - originY
            if y + 1 > bounds.minY && y < bounds.maxY {
                context.fill(NSRect(x: bounds.minX, y: y, width: bounds.width, height: 1))
            }
        }
        context.restoreGState()
    }
}
// All welcome selection flows through this function, including diagnostics.
func lifecyclePaths(_ cue: String, directory: String, full: Bool) -> [String] {
    if cue == "activity" { return (1...3).map { directory + "/activity-\($0).wav" } }
    if cue == "welcome" && full { return [directory + "/welcome-7.wav"] }
    return (1...6).map { directory + "/\(cue)-\($0).wav" }
}
struct IntroLifetime {
    var start: Double?
    var lastTick: Double?
    var finished = false
    var welcomed = false
    mutating func begin(_ now: Double) { guard start == nil && !finished else { return }; start = now; lastTick = now }
    mutating func cancel() { finished = true }
    // A resumed/overdue loop must not play a stale welcome or strand a cover.
    mutating func tick(_ now: Double, lease: Bool, displayValid: Bool, simple: Bool = false) -> (sample: IntroSample, welcome: Bool, cancelled: Bool) {
        let sample = IntroSample(elapsed: now - (start ?? now))
        guard start != nil && !finished else { return (sample, false, false) }
        let end = simple ? SimpleSample.end : IntroSample.end
        if !lease || !displayValid || now - (lastTick ?? now) > 1 || sample.elapsed > end + 0.5 {
            cancel(); return (sample, false, true)
        }
        lastTick = now
        let welcome = !welcomed && sample.elapsed >= (simple ? SimpleSample.grow : IntroSample.welcomeStart)
        if welcome { welcomed = true }
        if sample.elapsed >= end { finished = true }
        return (sample, welcome, false)
    }
}
@Sendable func introLanding(_ size: FairySize, visible: NSRect) -> NSRect {
    let side = min(size.points, visible.width, visible.height)
    let margin = min(40, max(8, min(visible.width, visible.height) * 0.04))
    return sizedFrame(size, center: NSPoint(x: visible.maxX - margin - side / 2, y: visible.maxY - margin - side / 2), visible: visible)
}
// Only a handoff with no display waits; ordinary desktop movement stays untouched.
struct IntroPlacement {
    enum Decision: Equatable { case ordinary, hidden, landing(NSRect) }
    private(set) var waitingForDisplay = false
    mutating func update(_ size: FairySize, visible: NSRect?, finishing: Bool = false) -> Decision {
        guard finishing || waitingForDisplay else { return .ordinary }
        waitingForDisplay = visible == nil
        guard let visible else { return .hidden }
        return .landing(introLanding(size, visible: visible))
    }
}
@Sendable func introBody(_ sample: IntroSample, screen: NSRect, landing: NSRect) -> NSRect {
    let side = min(min(screen.width, screen.height) * 0.64, max(landing.width * 1.8, 580))
    let central = NSRect(x: screen.midX - side / 2, y: screen.midY - side / 2, width: side, height: side)
    let p = sample.motion
    if p == 1 { return landing }
    return NSRect(x: central.minX + (landing.minX - central.minX) * p, y: central.minY + (landing.minY - central.minY) * p,
                  width: side + (landing.width - side) * p, height: side + (landing.height - side) * p)
}
// Simple opening and local farewell use the same pet, never a cover.
struct SimpleSample {
    static let grow = 0.65, holdEnd = 1.0, end = 2.4
    let elapsed: Double
    func body(screen: NSRect, landing: NSRect) -> NSRect {
        let large = min(min(screen.width, screen.height) * 0.64, max(landing.width * 1.8, 580))
        let growth = ease(elapsed / Self.grow)
        let side = 2 + (large - 2) * growth
        let central = NSRect(x: screen.midX - side / 2, y: screen.midY - side / 2, width: side, height: side)
        let p = ease((elapsed - Self.holdEnd) / (Self.end - Self.holdEnd))
        if p == 1 { return landing }
        return NSRect(x: central.minX + (landing.minX - central.minX) * p, y: central.minY + (landing.minY - central.minY) * p,
                      width: side + (landing.width - side) * p, height: side + (landing.height - side) * p)
    }
}
func ease(_ value: Double) -> CGFloat { let p = CGFloat(min(1, max(0, value))); return p * p * (3 - 2 * p) }
struct OutroSample {
    static let anticipation = 0.18, end = 0.95
    let elapsed: Double
    var scale: CGFloat { elapsed < Self.anticipation ? 1 + 0.065 * ease(elapsed / Self.anticipation) : 1.065 * (1 - ease((elapsed - Self.anticipation) / (Self.end - Self.anticipation))) }
    var alpha: CGFloat { 1 - ease((elapsed - Self.anticipation) / (Self.end - Self.anticipation)) }
    func body(rest: NSRect) -> NSRect {
        let side = max(0.01, rest.width * scale)
        return NSRect(x: rest.midX - side / 2, y: rest.midY - side / 2, width: side, height: side)
    }
}
func preferredDisplayIndex(saved: String?, displays: [String?], pointer: Int?) -> Int? {
    if let saved, let index = displays.firstIndex(where: { $0 == saved }) { return index }
    if let pointer, displays.indices.contains(pointer) { return pointer }
    return displays.isEmpty ? nil : 0
}
func positionFrame(_ position: SavedPosition?, display: String?, size: FairySize, visible: NSRect) -> NSRect {
    guard let p = position, p.valid, p.display == display else { return introLanding(size, visible: visible) }
    return sizedFrame(size, center: NSPoint(x: visible.minX + visible.width * p.x, y: visible.minY + visible.height * p.y), visible: visible)
}
func restingPosition(_ frame: NSRect, display: String, visible: NSRect, controlled: Bool) -> SavedPosition? {
    guard !controlled, visible.width > 0, visible.height > 0, frame.width > 0, frame.height > 0,
          [frame.minX, frame.minY, frame.width, frame.height].allSatisfy({ $0.isFinite }), visible.contains(frame) else { return nil }
    let p = SavedPosition(display: display, x: (frame.midX - visible.minX) / visible.width, y: (frame.midY - visible.minY) / visible.height)
    return p.valid ? p : nil
}
// Approximate measured monitor-content crop: (24,50)..(815,344) in the
// reference. Fit this 791:294 stage rather than stretching glyphs on portrait.
struct IntroLayout {
    let bounds: NSRect
    var stage: NSRect {
        let w = min(bounds.width, bounds.height * 791 / 294)
        return NSRect(x: bounds.midX - w / 2, y: bounds.midY - w * 294 / 791 / 2, width: w, height: w * 294 / 791)
    }
    func sourceRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
        let s = stage, scale = s.width / 791
        return NSRect(x: s.minX + x * scale, y: s.maxY - (y + h) * scale, width: w * scale, height: h * scale)
    }
    var title: NSRect { sourceRect(156, 81, 501, 54) }
    var bar: NSRect { sourceRect(79, 150, 640, 35) }
    var subtitle: NSRect { sourceRect(160, 201, 482, 17) }
    func clockPair(_ index: Int) -> NSRect { sourceRect(224 + CGFloat(index) * 134, 94, 76, 94) }
    func clockLabel(_ index: Int) -> NSRect {
        let pair = clockPair(index)
        return NSRect(x: pair.minX, y: pair.minY - stage.height * 0.09, width: pair.width, height: stage.height * 0.045)
    }
    func error(_ index: Int) -> NSRect {
        let w = min(bounds.width * 0.38, bounds.height * 1.05), h = w / 2.1
        let p = CGFloat(min(8, max(0, index))) / 8
        return NSRect(x: bounds.minX + bounds.width * 0.012 + p * (bounds.width * 0.976 - w),
                      y: bounds.maxY - bounds.height * 0.012 - h - p * (bounds.height * 0.976 - h), width: w, height: h)
    }
}

final class IntroView: NSView {
    var sample = IntroSample(elapsed: 0)
    var date = Date()
    let ink = NSColor(srgbRed: 0.78, green: 0.91, blue: 0.96, alpha: 1)
    // Approximate unobstructed reference crop patches, not averages of glyphs,
    // bezel or subtitles. Cached small radial fields avoid 4K CPU gradients.
    static func backdrop(_ peak: NSColor) -> [NSColor] {
        return (0..<2048).map { index in
            let x = Double(index % 64), y = Double(index / 64)
            let p = CGFloat(exp(-(pow((x - 32) / 40, 2) + pow((y - 24) / 24, 2)) * 1.8))
            // Compare reference HDTV and own Generic-RGB PNGs only after ICC
            // conversion to common sRGB; these are fixed scene colors, not a
            // correction for the user's monitor. Scanlines add a little light.
            let red = (36.0 + (peak.redComponent * 255.0 - 36.0) * p) / 255.0
            let green = (52.0 + (peak.greenComponent * 255.0 - 52.0) * p) / 255.0
            let blue = (57.0 + (peak.blueComponent * 255.0 - 57.0) * p) / 255.0
            return NSColor(srgbRed: red, green: green, blue: blue, alpha: 1)
        }
    }
    static let clockBackdrop = backdrop(NSColor(srgbRed: 58/255, green: 88/255, blue: 125/255, alpha: 1))
    static let errorBackdrop = backdrop(NSColor(srgbRed: 55/255, green: 75/255, blue: 95/255, alpha: 1))
    // Fixed 128x64 tile, generated once; no per-frame screen-pixel random work.
    static let noise: NSImage = {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 128, pixelsHigh: 64, bitsPerSample: 8,
                                  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 512, bitsPerPixel: 32)!
        let rng = IdleEffects(time: 0)
        for y in 0..<64 { for x in 0..<128 {
            let v = CGFloat(0.12 + rng.noise(y * 128 + x) * 0.12)
            rep.setColor(NSColor(calibratedRed: v * 0.75, green: v, blue: v * 1.2, alpha: 1), atX: x, y: y)
        } }
        let image = NSImage(size: NSSize(width: 128, height: 64)); image.addRepresentation(rep); return image
    }()
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    // The nonkey cover absorbs pointer events without a dismissal action.
    override func mouseDown(with event: NSEvent) {}
    override func mouseUp(with event: NSEvent) {}
    override func rightMouseDown(with event: NSEvent) {}
    override func rightMouseUp(with event: NSEvent) {}
    override func otherMouseDown(with event: NSEvent) {}
    override func otherMouseUp(with event: NSEvent) {}
    override func scrollWheel(with event: NSEvent) {}
    func text(_ text: String, rect: NSRect, size: CGFloat, glow: Bool = false, tall: Bool = false) {
        NSGraphicsContext.saveGraphicsState()
        if glow { let shadow = NSShadow(); shadow.shadowColor = ink; shadow.shadowBlurRadius = 15; shadow.set() }
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: size, weight: tall ? .semibold : .medium), .foregroundColor: ink]
        let measured = (text as NSString).size(withAttributes: attrs)
        let sx = min(1, rect.width / max(1, measured.width)) * (tall ? 0.70 : 1)
        let sy: CGFloat = tall ? 1.7 : 1
        let transform = NSAffineTransform(); transform.translateX(by: rect.midX - measured.width * sx / 2, yBy: rect.midY - measured.height * sy / 2)
        transform.scaleX(by: sx, yBy: sy); transform.concat()
        (text as NSString).draw(at: .zero, withAttributes: attrs)
        NSGraphicsContext.restoreGraphicsState()
    }
    // System glyph outlines, not downloaded fonts or rasterized reference text.
    // Impact + shear approximates the reference's heavy narrow italic face.
    func lettering(_ value: String, rect: NSRect, font name: String = "Impact", tracking: CGFloat = 0,
                   shear: CGFloat = 0, outlined: Bool = false, glow: Bool = false) {
        guard let context = NSGraphicsContext.current?.cgContext, rect.width > 0, rect.height > 0 else { return }
        let font = NSFont(name: name, size: 100) ?? NSFont.systemFont(ofSize: 100, weight: .heavy)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: [.font: font, .kern: tracking]))
        let path = CGMutablePath()
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
            let count = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: count), positions = [CGPoint](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
            let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
            for i in 0..<count {
                if let glyph = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) {
                    path.addPath(glyph, transform: CGAffineTransform(a: 1, b: 0, c: shear, d: 1, tx: positions[i].x, ty: positions[i].y))
                }
            }
        }
        let box = path.boundingBoxOfPath
        guard box.width > 0, box.height > 0 else { return }
        var transform = CGAffineTransform(a: rect.width / box.width, b: 0, c: 0, d: rect.height / box.height,
                                         tx: rect.minX - box.minX * rect.width / box.width, ty: rect.minY - box.minY * rect.height / box.height)
        guard let fitted = path.copy(using: &transform) else { return }
        let bloom = NSColor(srgbRed: 0.34, green: 0.66, blue: 1, alpha: 0.9).cgColor
        context.saveGState()
        if glow { context.setShadow(offset: .zero, blur: max(4, rect.height * 0.16), color: bloom) }
        if outlined {
            context.addPath(fitted); context.clip()
            let fill = NSColor(srgbRed: 0.50, green: 0.77, blue: 0.96, alpha: 1)
            NSGradient(starting: fill.withAlphaComponent(0.22), ending: fill.withAlphaComponent(0.50))!.draw(in: rect, angle: 90)
            ink.withAlphaComponent(0.22).setFill()
            for row in 0..<24 { NSRect(x: rect.minX, y: rect.minY + rect.height * CGFloat(row) / 24, width: rect.width, height: max(0.4, rect.height / 100)).fill() }
            context.restoreGState(); context.saveGState()
            if glow { context.setShadow(offset: .zero, blur: max(4, rect.height * 0.16), color: bloom) }
            context.addPath(fitted); context.setStrokeColor(NSColor(srgbRed: 0.84, green: 0.95, blue: 0.98, alpha: 1).cgColor)
            context.setLineWidth(max(0.5, rect.height * 0.022)); context.strokePath()
        } else { context.addPath(fitted); context.setFillColor(ink.cgColor); context.fillPath() }
        context.restoreGState()
    }
    func drawError(_ index: Int, layout: IntroLayout) {
        let r = layout.error(index), unit = r.width / 294, header = r.height * 0.16
        NSGraphicsContext.saveGraphicsState()
        // Late windows slant together with their contents. This approximates the
        // reference's torn overlaps without extra windows or random placement.
        let transform = NSAffineTransform(); transform.translateX(by: r.minX, yBy: r.minY); transform.concat()
        if sample.errorCount >= 6 {
            let shear = NSAffineTransform(); shear.transformStruct = NSAffineTransformStruct(m11: 1, m12: 0, m21: 0.12, m22: 1, tX: -r.height * 0.06, tY: 0); shear.concat()
        }
        let local = NSRect(origin: .zero, size: r.size)
        NSGradient(starting: NSColor(srgbRed: 0.72, green: 0.76, blue: 0.74, alpha: 1), ending: NSColor(srgbRed: 0.23, green: 0.30, blue: 0.32, alpha: 1))!.draw(in: local, angle: index == 0 ? 270 : 90)
        NSColor(calibratedRed: 0.18, green: 0.29, blue: 0.34, alpha: 1).setFill()
        NSRect(x: 0, y: r.height - header, width: r.width, height: header).fill()
        ink.withAlphaComponent(0.9).setStroke(); NSBezierPath(rect: local).stroke()
        for i in 0..<3 {
            NSColor(calibratedWhite: 0.94, alpha: 1).setFill()
            NSBezierPath(ovalIn: NSRect(x: r.width - CGFloat(3 - i) * 18 * unit, y: r.height - header * 0.78, width: header * 0.56, height: header * 0.56)).fill()
        }
        let dark = NSColor(calibratedRed: 0.12, green: 0.20, blue: 0.23, alpha: 1)
        if index == 0 {
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 8 * unit, weight: .bold), .foregroundColor: dark]
            for (row, line) in ["Error loading signal...", "Retry", "Opening channel interrupted", "Awaiting carrier response"].enumerated() {
                (line as NSString).draw(at: NSPoint(x: 7 * unit, y: r.height - header - CGFloat(row + 1) * 13 * unit), withAttributes: attrs)
            }
        } else {
            let box = NSRect(x: r.width * 0.32, y: r.height * 0.27, width: r.width * 0.36, height: r.height * 0.35)
            dark.setFill(); box.fill()
            lettering("LOADING", rect: NSRect(x: box.minX + 3 * unit, y: box.midY + 1 * unit, width: box.width - 6 * unit, height: box.height * 0.40), tracking: 2)
            lettering("ERROR", rect: NSRect(x: box.minX + 3 * unit, y: box.minY + 3 * unit, width: box.width - 6 * unit, height: box.height * 0.46), tracking: 6)
        }
        for row in 0..<80 {
            NSColor(calibratedWhite: row % 2 == 0 ? 0.94 : 0.11, alpha: 0.20).setFill()
            NSRect(x: 0, y: CGFloat(row) * r.height / 80, width: r.width, height: max(0.4, r.height / 180)).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
    }
    override func draw(_ dirtyRect: NSRect) {
        NSGraphicsContext.saveGraphicsState()
        NSColor.clear.setFill(); bounds.fill(using: .copy)
        let w = bounds.width, h = bounds.height
        let phase = sample.phase
        if sample.elapsed < IntroSample.revealStart {
            if phase != "signal" {
                let colors = phase == "errors" ? Self.errorBackdrop : Self.clockBackdrop
                for row in 0..<32 { for col in 0..<64 {
                    colors[row * 64 + col].setFill()
                    NSRect(x: CGFloat(col) * w / 64, y: CGFloat(row) * h / 32, width: w / 64 + 0.5, height: h / 32 + 0.5).fill()
                } }
            }
        } else {
            NSColor(calibratedRed: 0.015, green: 0.075, blue: 0.28, alpha: sample.background).setFill(); bounds.fill()
        }
        if sample.elapsed < IntroSample.revealStart {
            if phase == "signal" {
                NSColor(patternImage: Self.noise).setFill(); bounds.fill()
                let seed = IdleEffects(time: 0, seed: UInt64(max(0, Int(sample.elapsed * 20))))
                for row in 0..<24 {
                    let y = CGFloat(seed.noise(row)) * h
                    ink.withAlphaComponent(0.07 + CGFloat(seed.noise(row + 50)) * 0.08).setFill()
                    NSRect(x: CGFloat(seed.noise(row + 100)) * w * 0.1, y: y, width: w, height: max(1, CGFloat(seed.noise(row + 200)) * h * 0.02)).fill()
                }
            } else if phase == "clock" || phase == "slip" {
                let layout = IntroLayout(bounds: bounds)
                text("L O C A L   S Y S T E M", rect: layout.sourceRect(190, 54, 410, 16), size: 18 * layout.stage.width / 791)
                let digits = phase == "clock" ? sample.clock(date).components(separatedBy: "  ") : [731,1297,2473].map { String(format: "%02d", Int(sample.elapsed * Double($0)) % 100) }
                for i in 0..<3 {
                    lettering(digits[i], rect: layout.clockPair(i), font: "DINCondensed-Bold", glow: true)
                    text(["HH", "MM", "SS"][i], rect: layout.clockLabel(i), size: 12 * layout.stage.width / 791)
                }
            } else if phase == "errors" {
                let layout = IntroLayout(bounds: bounds)
                for i in 0..<sample.errorCount { drawError(i, layout: layout) }
            } else if phase == "hdd" {
                let layout = IntroLayout(bounds: bounds)
                lettering("H.D.D. SYSTEM", rect: layout.title, tracking: 1, shear: 0.22, outlined: true, glow: true)
                let bar = layout.bar
                ink.withAlphaComponent(0.85).setStroke(); NSBezierPath(rect: bar).stroke()
                let fill = NSRect(x: bar.minX, y: bar.minY, width: bar.width * sample.loading, height: bar.height)
                NSGradient(starting: ink.withAlphaComponent(0.24), ending: ink.withAlphaComponent(0.55))!.draw(in: fill, angle: 90)
                for row in 0..<20 {
                    ink.withAlphaComponent(0.25).setFill()
                    NSRect(x: bar.minX, y: bar.minY + CGFloat(row) * bar.height / 20, width: bar.width, height: max(0.4, bar.height / 70)).fill()
                }
                lettering("HOLLOW DEEP DIVE SYSTEM", rect: layout.subtitle, tracking: 32, shear: 0.22, outlined: true)
            }
        }
        IntroRaster(screenHeight: h, originY: 0, opacity: 1).draw(in: bounds)
        IntroDim(elapsed: sample.elapsed).draw(in: bounds)
        NSGraphicsContext.restoreGraphicsState()
    }
}
var intro = IntroLifetime()
// Only explicit user intent or a normally completed landing can authorize a save.
struct RestingIntent {
    var position: SavedPosition?
    var onRestingDisplay = false
    mutating func capture(_ value: SavedPosition?, eligible: Bool) {
        guard eligible, let value else { return }
        position = value; onRestingDisplay = true
    }
    mutating func suspend() { onRestingDisplay = false }
}
// End resting intent
var restingIntent = RestingIntent()
@MainActor enum DesktopPlacement {
static func displayUUID(_ screen: NSScreen) -> String? {
    guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
          let uuid = CGDisplayCreateUUIDFromDisplayID(number.uint32Value)?.takeRetainedValue() else { return nil }
    return CFUUIDCreateString(nil, uuid) as String
}
static func preferredScreen() -> NSScreen? {
    let screens = NSScreen.screens
    let pointer = screens.firstIndex(where: { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) })
    guard let index = preferredDisplayIndex(saved: savedPosition?.display, displays: screens.map { DesktopPlacement.displayUUID($0) }, pointer: pointer) else { return nil }
    return screens[index]
}
static func landingFrame(_ screen: NSScreen) -> NSRect {
    positionFrame(savedPosition, display: DesktopPlacement.displayUUID(screen), size: selectedSize, visible: screen.visibleFrame)
}
static func captureRest(eligible: Bool) {
    guard let pet = panel, let screen = pet.screen, let uuid = DesktopPlacement.displayUUID(screen) else { return }
    restingIntent.capture(restingPosition(pet.frame, display: uuid, visible: screen.visibleFrame, controlled: false), eligible: eligible)
}
}
var introCover: PetPanel?
var introView: IntroView?
var introScreen: NSScreen?
var introLayout: [String] = []
var introPlacement = IntroPlacement()
@Sendable func displayLayout() -> [String] {
    NSScreen.screens.map { "\($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]!)|\($0.frame)|\($0.visibleFrame)|\($0.backingScaleFactor)" }
}
// Shared by finish/cancel and the ordinary timer, including reload grace.
@MainActor func placeIntroPet(finishing: Bool = false) -> Bool {
    var visible: NSRect?
    var targetScreen: NSScreen?
    if finishing || introPlacement.waitingForDisplay {
        let remaining = NSScreen.screens
        let targetID = introScreen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        let screen = remaining.first(where: { savedPosition != nil && DesktopPlacement.displayUUID($0) == savedPosition?.display })
            ?? remaining.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber) == targetID }) ?? DesktopPlacement.preferredScreen()
        targetScreen = screen
        visible = screen?.visibleFrame
    }
    switch introPlacement.update(selectedSize, visible: visible, finishing: finishing) {
    case .ordinary: return true
    case .hidden:
        effectPanel?.orderOut(nil); panel?.orderOut(nil)
        return false
    case .landing(let frame):
        if let pet = panel {
            pet.setFrame(targetScreen.map { DesktopPlacement.landingFrame($0) } ?? frame, display: true)
            alignEffects()
            if !retiring {
                if let effect = effectPanel, effect.parent == nil { pet.addChildWindow(effect, ordered: .below) }
                pet.orderFrontRegardless()
                effectPanel?.order(.below, relativeTo: pet.windowNumber)
            }
        }
        return true
    }
}
@MainActor enum IntroCompletion {
static func finishIntro(cancel: Bool, now: Double) {
    introSFX.stop()
    if cancel { intro.cancel(); lifecycleAudio.stop(now) }
    imageView?.introRaster = nil
    panel?.ignoresMouseEvents = false; panel?.alphaValue = 1
    if introTest { print("INTRO finished cancel=\(cancel) welcomed=\(intro.welcomed) elapsed=\(now - (intro.start ?? now))") }
    guard !headless else { return }
    _ = placeIntroPet(finishing: true)
    let screen = panel?.screen
    DesktopPlacement.captureRest(eligible: !cancel && screen != nil && (savedPosition == nil || screen.map { DesktopPlacement.displayUUID($0) } == savedPosition?.display))
    introLayout = displayLayout()
    introCover?.orderOut(nil); introCover?.close(); introCover = nil; introView = nil
}
}
@MainActor func beginIntro(_ now: Double) {
    guard intro.start == nil && !intro.finished else { return }
    intro.begin(now)
    restingIntent.suspend()
    if introTest { precondition(panel?.isVisible != true); print("INTRO began; pre-lease pet hidden") }
    guard !headless else { return }
    guard let screen = DesktopPlacement.preferredScreen() else {
        IntroCompletion.finishIntro(cancel: true, now: now); return
    }
    introScreen = screen; introLayout = displayLayout()
    sizeMenu.dismiss(); panel?.ignoresMouseEvents = true
    if let effect = effectPanel { panel?.removeChildWindow(effect); effect.orderOut(nil) }
    if simpleIntro {
        panel?.setFrame(SimpleSample(elapsed: 0).body(screen: screen.visibleFrame, landing: DesktopPlacement.landingFrame(screen)), display: true)
        panel?.alphaValue = 1; panel?.orderFrontRegardless(); panel?.displayIfNeeded(); panel?.flush()
        return
    }
    let cover = PetPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    cover.isReleasedWhenClosed = false; cover.isOpaque = false; cover.backgroundColor = .clear
    cover.hasShadow = false; cover.hidesOnDeactivate = false; cover.level = .statusBar
    cover.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    let view = IntroView(frame: NSRect(origin: .zero, size: screen.frame.size))
    cover.contentView = view; introCover = cover; introView = view
    cover.orderFrontRegardless()
    introSFX.begin(path: introSFXPath, start: now)
}
@MainActor func updateIntro(_ now: Double, hasLease: Bool) {
    guard intro.start != nil && !intro.finished else { return }
    let elapsed = now - intro.start!
    let action = introTest ? ProcessInfo.processInfo.environment["FAIRY_INTRO_TEST_ACTION"] : nil
    let displayValid = (headless || displayLayout() == introLayout) && !(action == "display" && elapsed >= 0.4)
    let result = intro.tick(now, lease: hasLease, displayValid: displayValid, simple: simpleIntro)
    if result.cancelled { restingIntent.suspend(); IntroCompletion.finishIntro(cancel: true, now: now); return }
    let sample = result.sample
    introSFX.tick(now, elapsed: sample.elapsed)
    introView?.sample = sample; introView?.date = Date(); introView?.needsDisplay = true
    if !headless, let screen = introScreen, let pet = panel, simpleIntro || sample.elapsed >= IntroSample.revealStart {
        let body = simpleIntro ? SimpleSample(elapsed: sample.elapsed).body(screen: screen.visibleFrame, landing: DesktopPlacement.landingFrame(screen))
            : introBody(sample, screen: screen.frame, landing: DesktopPlacement.landingFrame(screen))
        imageView?.introRaster = !simpleIntro && sample.background > 0 ? IntroRaster(screenHeight: screen.frame.height, originY: body.minY - screen.frame.minY, opacity: sample.background) : nil
        pet.setFrame(body, display: true)
        pet.alphaValue = simpleIntro ? 1 : sample.materialized
        pet.orderFrontRegardless()
        // Flush the central Fairy before the single welcome attempt.
        if result.welcome { pet.displayIfNeeded() }
    }
    if introTest && !headless {
        precondition(introCover?.isVisible == true && introCover?.canBecomeKey == false && introCover?.canBecomeMain == false)
        precondition(introCover?.ignoresMouseEvents == false && panel?.ignoresMouseEvents == true)
        precondition(sizeMenu.window == nil && effectPanel?.parent == nil)
        if sample.elapsed < IntroSample.revealStart { precondition(panel?.isVisible == false) }
        if result.welcome { precondition(panel?.isVisible == true && panel?.alphaValue == 1) }
    }
    if result.welcome {
        if introTest { print("INTRO welcome at \(sample.elapsed); HDD=\(sample.loading) materialized=\(sample.materialized)") }
        lifecycleAudio.request("welcome", now: now)
    }
    if intro.finished { IntroCompletion.finishIntro(cancel: false, now: now) }
}

// Original idle-only sampler. Reference observations and editable approximations:
// docs/DESKTOP-IDLE-EFFECTS.md. No task, audio, random global state or extra timer.
struct IdleEffects {
    let time: Double
    let seed: UInt64
    init(time: Double, seed: UInt64 = 0xFA17) { self.time = max(0, time); self.seed = seed }
    func noise(_ index: Int) -> Double {
        var x = UInt64(max(0, index)) &+ seed &+ 0x9e3779b97f4a7c15
        x = (x ^ (x >> 30)) &* 0xbf58476d1ce4e5b9
        x = (x ^ (x >> 27)) &* 0x94d049bb133111eb
        return Double((x ^ (x >> 31)) >> 11) / 9007199254740992
    }
    func glitchStart(_ index: Int) -> Double { 4 + Double(index) * 5.5 + noise(index) * 1.4 }
    var glitchIndex: Int { max(0, Int((time - 4) / 5.5)) }
    var glitchAge: Double { time - glitchStart(glitchIndex) }
    var glitchDuration: Double { noise(glitchIndex + 400) < 0.5 ? 0.15 : 0.20 }
    var glitch: Bool { glitchAge >= 0 && glitchAge < glitchDuration }
    var coarse: Bool { noise(glitchIndex + 800) < 0.25 }
    var stripCount: Int { coarse ? 13 : 180 }
    func displacement(_ strip: Int) -> CGFloat {
        guard glitch else { return 0 }
        let tick = Int(glitchAge / 0.05)
        let envelope = 1 - 0.65 * glitchAge / glitchDuration
        return CGFloat((noise(strip + tick * 211 + glitchIndex * 997) * 2 - 1) * (coarse ? 0.025 : 0.009) * envelope)
    }
    struct Ring { let radius: CGFloat; let alpha: CGFloat }
    var rings: [Ring] {
        let age = (time - 1).truncatingRemainder(dividingBy: 6.4)
        return (0..<3).compactMap { index in
            let p = (age - Double(index) * 0.26) / 1.8
            guard p > 0 && p < 1 else { return nil }
            return Ring(radius: CGFloat(0.32 + 0.42 * p),
                        alpha: CGFloat(0.20 * min(1, p / 0.12) * pow(1 - p, 1.3)))
        }
    }
}
@Sendable func effectFrame(_ body: NSRect) -> NSRect { body.insetBy(dx: -body.width * 0.4, dy: -body.height * 0.4) }
func drawRipples(_ sample: IdleEffects, in bounds: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    let side = bounds.width / 1.8
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    for ring in sample.rings {
        let colors = [0.0, 0.25, 1.0, 0.3, 0.0].map {
            NSColor(calibratedRed: 0.88, green: 0.95, blue: 1, alpha: ring.alpha * $0).cgColor
        }
        let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray,
                                  locations: [0, 0.25, 0.5, 0.75, 1])!
        context.drawRadialGradient(gradient, startCenter: center, startRadius: (ring.radius - 0.065) * side,
                                   endCenter: center, endRadius: (ring.radius + 0.065) * side, options: [])
    }
}
final class RippleView: NSView {
    var sample = IdleEffects(time: 0)
    override func draw(_ dirtyRect: NSRect) { drawRipples(sample, in: bounds) }
}
var effectPanel: PetPanel?
var rippleView: RippleView?
var geometryObservers: [NSObjectProtocol] = []
@MainActor func alignEffects() {
    if let body = panel { effectPanel?.setFrame(effectFrame(body.frame), display: true) }
}
@MainActor func disposeEffects() {
    for observer in geometryObservers { NotificationCenter.default.removeObserver(observer) }
    geometryObservers.removeAll()
    if let effect = effectPanel { panel?.removeChildWindow(effect); effect.orderOut(nil); effect.close() }
    effectPanel = nil; rippleView = nil
    precondition(geometryObservers.isEmpty && !(panel?.childWindows?.contains { $0 is PetPanel } ?? false))
}

final class PetImageView: NSImageView {
    var sample = IdleEffects(time: 0)
    var introRaster: IntroRaster? { didSet { needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        // Isolate sourceAtop from the cover beneath this view (also in snapshots).
        if let raster = introRaster, let context = NSGraphicsContext.current?.cgContext {
            context.saveGState()
            context.beginTransparencyLayer(auxiliaryInfo: nil)
            drawPet(dirtyRect)
            raster.draw(in: bounds)
            context.endTransparencyLayer()
            context.restoreGState()
        } else { drawPet(dirtyRect) }
    }
    private func drawPet(_ dirtyRect: NSRect) {
        guard sample.glitch, let image else { super.draw(dirtyRect); return }
        // Disjoint destination strips cover every source row; each redraw starts clean.
        // Translate the full source under each clip, never paste blank source rectangles.
        let count = sample.stripCount
        for row in 0..<count {
            let y0 = bounds.height * CGFloat(row) / CGFloat(count)
            let y1 = bounds.height * CGFloat(row + 1) / CGFloat(count)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.cgContext.setShouldAntialias(false)
            NSRect(x: 0, y: y0, width: bounds.width, height: y1 - y0).clip()
            image.draw(in: bounds.offsetBy(dx: sample.displacement(row) * bounds.width, dy: 0),
                       from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            NSGraphicsContext.restoreGraphicsState()
        }
    }
    // Allow dragging without first activating Fairy or stealing keyboard focus.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        guard !retiring && (!cinematic || intro.finished) else { return }
        sizeMenu.dismiss()
        window?.performDrag(with: event)
        MainActor.assumeIsolated { sizeMenu.saveDragPosition() }
    }
    override func rightMouseDown(with event: NSEvent) { if !retiring && (!cinematic || intro.finished) { sizeMenu.toggle(at: NSEvent.mouseLocation) } }
}
var panel: PetPanel?
var imageView: PetImageView?
// Original HDD-inspired geometry, not imported CSS/art. Mouse-only transient monitors
// keep the desktop non-key; Escape deliberately remains with the user's active app.
// Awake elapsed lifetime, not work/input detection. mach_time.h documents that
// mach_continuous_time, unlike mach_absolute_time, advances during sleep.
func restAwakeTime() -> Double {
    var scale = mach_timebase_info_data_t(); mach_timebase_info(&scale)
    return Double(mach_absolute_time()) * Double(scale.numer) / Double(scale.denom) / 1_000_000_000
}
final class RestSchedule {
    private let clock: () -> Double
    private var last: Double = 0
    private var deadline: Double?
    private(set) var unresolved = false
    private(set) var retired = false
    init(clock: @escaping () -> Double) { self.clock = clock }
    private func now() -> Double {
        let value = clock()
        if value.isFinite { last = max(last, value) }
        return last // Defend against a broken/injected clock rolling backwards.
    }
    func firstVisible() {
        guard deadline == nil && !unresolved && !retired else { return }
        deadline = now() + 3600
    }
    func presentIfDue(allowed: Bool) -> Bool {
        guard !retired, !unresolved, let deadline, now() >= deadline, allowed else { return false }
        unresolved = true; return true
    }
    @discardableResult func choose(later: Bool) -> Bool {
        guard unresolved && !retired else { return false }
        unresolved = false; deadline = now() + (later ? 300 : 3600); return true
    }
    func retire() { retired = true; unresolved = false; deadline = nil }
}
let restSchedule = RestSchedule(clock: restAwakeTime)

// Interaction chrome only: never used by pet artwork, intro or terminal themes.
enum InteractionPalette {
    static let background = NSColor(srgbRed: 0.065, green: 0.085, blue: 0.105, alpha: 1)
    static let row = NSColor(srgbRed: 0.105, green: 0.135, blue: 0.165, alpha: 1)
    static let selected = NSColor(srgbRed: 0.23, green: 0.32, blue: 0.39, alpha: 1)
    static let hover = NSColor(srgbRed: 0.17, green: 0.23, blue: 0.28, alpha: 1)
    static let accent = NSColor(srgbRed: 0.66, green: 0.78, blue: 0.85, alpha: 1)
    static let text = NSColor(srgbRed: 0.87, green: 0.90, blue: 0.93, alpha: 1)
    static let muted = NSColor(srgbRed: 0.62, green: 0.68, blue: 0.73, alpha: 1)
    static let border = NSColor(srgbRed: 0.35, green: 0.43, blue: 0.49, alpha: 1)
    static let failure = NSColor(srgbRed: 0.79, green: 0.68, blue: 0.68, alpha: 1)
}
func restPromptFrame(pet: NSRect, visible: NSRect) -> NSRect {
    let w = min(300, visible.width), h = min(164, visible.height)
    let x = pet.minX >= visible.minX + w + 8 ? pet.minX - w - 8 : pet.maxX + 8
    return NSRect(x: min(max(visible.minX, x), visible.maxX - w),
                  y: min(max(visible.minY, pet.midY - h / 2), visible.maxY - h), width: w, height: h)
}
// When both panels are open, fit the menu in the largest remaining strip.
// Scaling only on very small displays preserves every row and both rest choices.
func menuBesideRest(_ prompt: NSRect, visible: NSRect) -> NSRect {
    let spaces = [NSRect(x: visible.minX, y: visible.minY, width: max(0, prompt.minX - visible.minX - 8), height: visible.height),
                  NSRect(x: prompt.maxX + 8, y: visible.minY, width: max(0, visible.maxX - prompt.maxX - 8), height: visible.height),
                  NSRect(x: visible.minX, y: visible.minY, width: visible.width, height: max(0, prompt.minY - visible.minY - 8)),
                  NSRect(x: visible.minX, y: prompt.maxY + 8, width: visible.width, height: max(0, visible.maxY - prompt.maxY - 8))]
    let space = spaces.max { min($0.width / 274, $0.height / 270) < min($1.width / 274, $1.height / 270) }!
    let scale = min(1, space.width / 274, space.height / 270)
    return NSRect(x: space.minX, y: space.minY, width: 274 * scale, height: 270 * scale)
}
final class RestPromptView: NSView {
    var choose: ((Bool) -> Void)?
    var hovered: Int? { didSet { needsDisplay = true } }
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas(); trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways], owner: self))
    }
    func button(_ index: Int) -> NSRect { NSRect(x: 14, y: 70 + index * 40, width: 272, height: 32) }
    override func mouseMoved(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil); hovered = (0...1).first { button($0).contains(p) }
    }
    override func mouseExited(with event: NSEvent) { hovered = nil }
    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if let i = (0...1).first(where: { button($0).contains(p) }) { choose?(i == 0) }
    }
    override func rightMouseDown(with event: NSEvent) {} // Not a dismissal.
    override func draw(_ dirtyRect: NSRect) {
        InteractionPalette.background.setFill(); bounds.fill()
        InteractionPalette.border.setStroke(); NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5)).stroke()
        func text(_ value: String, x: CGFloat, y: CGFloat, size: CGFloat, color: NSColor) {
            (value as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: .medium), .foregroundColor: color])
        }
        InteractionPalette.accent.setFill(); NSRect(x: 0, y: 0, width: 4, height: 32).fill()
        text("FAIRY / REST", x: 14, y: 12, size: 12, color: InteractionPalette.accent)
        text("主人，该起来活动一下了。", x: 14, y: 39, size: 14, color: InteractionPalette.text)
        for (i, label) in ["稍后 · 5 分钟", "去休息 · 1 小时"].enumerated() {
            (hovered == i ? InteractionPalette.hover : InteractionPalette.row).setFill(); button(i).fill()
            InteractionPalette.border.setStroke(); NSBezierPath(rect: button(i).insetBy(dx: 0.5, dy: 0.5)).stroke()
            text(label, x: 26, y: button(i).minY + 7, size: 13, color: InteractionPalette.text)
        }
    }
}
final class RestPromptController {
    var window: PetPanel?
    func close() { window?.orderOut(nil); window?.close(); window = nil }
    func align() {
        guard let window, let pet = panel, let screen = pet.screen ?? NSScreen.screens.first else { return }
        window.setFrame(restPromptFrame(pet: pet.frame, visible: screen.visibleFrame), display: true)
        window.contentView?.setBoundsSize(NSSize(width: 300, height: 164))
        if let menu = sizeMenu.window {
            menu.setFrame(menuBesideRest(window.frame, visible: screen.visibleFrame), display: true)
            menu.contentView?.setBoundsSize(NSSize(width: 274, height: 270))
        }
    }
    func show() {
        guard window == nil, let pet = panel, let screen = pet.screen ?? NSScreen.screens.first else { return }
        let rect = restPromptFrame(pet: pet.frame, visible: screen.visibleFrame)
        let prompt = PetPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        prompt.isReleasedWhenClosed = false; prompt.hidesOnDeactivate = false; prompt.hasShadow = false
        prompt.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        prompt.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        let view = RestPromptView(frame: NSRect(origin: .zero, size: rect.size))
        view.choose = { [weak self] later in
            guard restSchedule.choose(later: later) else { return }
            self?.close() // Both responses intentionally silent; no permission/goodbye effects.
        }
        prompt.contentView = view; window = prompt; align(); prompt.orderFrontRegardless()
    }
}
let restPrompt = RestPromptController()

final class SizeMenuView: NSView {
    var selected: FairySize = .standard
    var warning = false
    var choose: ((FairySize) -> Void)?
    var dismiss: (() -> Void)?
    var retry: (() -> Void)?
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    let accent = InteractionPalette.accent
    var hovered: FairySize?
    override func updateTrackingAreas() {
        super.updateTrackingAreas(); trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways], owner: self))
    }
    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hovered = FairySize.allCases.enumerated().first { NSRect(x: 12, y: CGFloat(48 + $0.offset * 34), width: 250, height: 29).contains(point) }?.element
        needsDisplay = true
    }
    override func mouseExited(with event: NSEvent) { hovered = nil; needsDisplay = true }
    func label(_ text: String, _ x: CGFloat, _ y: CGFloat, _ color: NSColor, _ size: CGFloat = 12) {
        (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .semibold), .foregroundColor: color])
    }
    override func draw(_ dirtyRect: NSRect) {
        InteractionPalette.background.setFill(); bounds.fill()
        InteractionPalette.border.setStroke()
        let border = NSBezierPath(rect: bounds.insetBy(dx: 1, dy: 1)); border.lineWidth = 1; border.stroke()
        accent.setFill(); NSRect(x: 0, y: 0, width: 7, height: 36).fill()
        label("FAIRY / SIZE", 18, 12, accent, 13)
        label("01", 234, 12, accent)
        for (index, size) in FairySize.allCases.enumerated() {
            let y = CGFloat(48 + index * 34), active = size == selected
            (active ? InteractionPalette.selected : hovered == size ? InteractionPalette.hover : InteractionPalette.row).setFill()
            NSRect(x: 12, y: y, width: 250, height: 29).fill()
            let ink = InteractionPalette.text
            label(active ? "[x]" : "[ ]", 20, y + 7, ink)
            label(size.rawValue.uppercased(), 54, y + 7, ink)
            label(String(format: "%.2fx", Double(size.multiplier)), 214, y + 7, ink, 11)
        }
        label(warning ? "NOT SAVED / CLICK TO RETRY" : "GLOBAL / AUTO-SAVE", 16, 226,
              warning ? InteractionPalette.failure : InteractionPalette.muted, 11)
        label("CLOSE: OUTSIDE / RIGHT CLICK", 16, 247, InteractionPalette.muted, 10)
    }
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if warning && point.y >= 220 { retry?(); return }
        for (index, size) in FairySize.allCases.enumerated() {
            if NSRect(x: 12, y: CGFloat(48 + index * 34), width: 250, height: 29).contains(point) { choose?(size); return }
        }
    }
    override func rightMouseDown(with event: NSEvent) { dismiss?() }
}
final class SizeMenuController {
    var window: PetPanel?
    var localMonitor: Any?
    var outsideMonitor: Any?
    var pendingSave = false
    var pendingPosition: SavedPosition?
    var retirementSaveAttempted = false
    @MainActor func saveDragPosition() {
        guard !retiring && (!cinematic || intro.finished), let pet = panel, let screen = pet.screen, let uuid = DesktopPlacement.displayUUID(screen) else { return }
        // A completed drag can overlap a display edge; settle it before capture.
        pet.setFrame(sizedFrame(selectedSize, center: NSPoint(x: pet.frame.midX, y: pet.frame.midY), visible: screen.visibleFrame), display: true)
        guard let position = restingPosition(pet.frame, display: uuid, visible: screen.visibleFrame, controlled: false) else { return }
        restingIntent.capture(position, eligible: true)
        pendingPosition = position
        retryPosition()
        if pendingPosition != nil { toggle(at: NSPoint(x: pet.frame.midX, y: pet.frame.midY)) }
    }
    func retryPosition() {
        guard let position = pendingPosition else { return }
        do { try preferences.savePosition(position); savedPosition = position; pendingPosition = nil }
        catch { fputs("Fairy: position NOT SAVED; right click Fairy to retry: \(error)\n", stderr) }
    }
    func saveRetirementPosition() {
        guard !retirementSaveAttempted else { return }
        retirementSaveAttempted = true
        // Retry qualified intent, never sample the moving/hidden/fallback panel.
        pendingPosition = pendingPosition ?? restingIntent.position
        retryPosition()
    }
    func retry() {
        retryPosition()
        if pendingSave { select(selectedSize) }
        if !pendingSave && pendingPosition == nil { dismiss() }
        else if let view = window?.contentView as? SizeMenuView { view.warning = true; view.needsDisplay = true }
    }
    func dismiss() {
        if let monitor = localMonitor { NSEvent.removeMonitor(monitor) }
        if let monitor = outsideMonitor { NSEvent.removeMonitor(monitor) }
        localMonitor = nil; outsideMonitor = nil
        window?.orderOut(nil); window = nil
    }
    func select(_ size: FairySize) {
        selectedSize = size
        if let pet = panel, let screen = pet.screen ?? NSScreen.screens.first {
            pet.setFrame(sizedFrame(size, center: NSPoint(x: pet.frame.midX, y: pet.frame.midY), visible: screen.visibleFrame), display: true)
            MainActor.assumeIsolated {
                let eligible = restingIntent.onRestingDisplay && restingIntent.position?.display == DesktopPlacement.displayUUID(screen)
                DesktopPlacement.captureRest(eligible: eligible)
                if eligible && pendingPosition != nil { pendingPosition = restingIntent.position }
            }
        }
        do {
            try preferences.save(size); pendingSave = false
            if pendingPosition == nil { dismiss() }
            else if let view = window?.contentView as? SizeMenuView { view.selected = size; view.warning = true; view.needsDisplay = true }
        }
        catch {
            pendingSave = true
            fputs("Fairy: size changed for this process but NOT SAVED: \(error)\n", stderr)
            if let view = window?.contentView as? SizeMenuView {
                view.selected = size; view.warning = true; view.needsDisplay = true
            }
        }
    }
    func toggle(at point: NSPoint) {
        if window != nil { dismiss(); return }
        guard let screen = NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) }) ?? panel?.screen else { return }
        let visible = screen.visibleFrame
        let rect = NSRect(x: min(max(visible.minX, point.x), visible.maxX - 274),
                          y: min(max(visible.minY, point.y - 270), visible.maxY - 270), width: 274, height: 270)
        let menu = PetPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        menu.isReleasedWhenClosed = false; menu.hidesOnDeactivate = false
        menu.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        menu.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        menu.hasShadow = false
        let view = SizeMenuView(frame: NSRect(origin: .zero, size: rect.size))
        view.selected = selectedSize; view.warning = pendingSave || pendingPosition != nil
        view.retry = { [weak self] in self?.retry() }
        view.choose = { [weak self] in self?.select($0) }
        view.dismiss = { [weak self] in self?.dismiss() }
        menu.contentView = view; window = menu
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            // Fairy handles its own right click (toggle) and left click (dismiss + drag).
            if event.window !== self?.window && event.window !== panel { self?.dismiss() }
            return event
        }
        // Mouse events only: no Accessibility permission; never suppress outside clicks.
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in self?.dismiss() }
        restPrompt.align()
        menu.orderFrontRegardless()
    }
}
let sizeMenu = SizeMenuController()
var frames: [String: [NSImage]] = [:]
let app: NSApplication? = headless ? nil : NSApplication.shared
if !headless {
    guard !NSScreen.screens.isEmpty else { cleanup(); fail("no graphical screen available") }
    app!.setActivationPolicy(.accessory)
    for theme in ["dark", "light"] {
        frames[theme] = (0..<120).map { index in
            guard let image = NSImage(contentsOfFile: assets + "/frames/\(theme)/" + String(format: "%03d.png", index)) else { cleanup(); fail("missing frame \(theme)/\(index)") }
            return image
        }
    }
    let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.screens[0]
    let visible = screen.visibleFrame
    let initialFrame = sizedFrame(selectedSize, center: NSPoint(x: visible.minX + visible.width * 0.8,
                                                               y: visible.maxY - visible.height / 3), visible: visible)
    let size = initialFrame.width
    let window = PetPanel(contentRect: initialFrame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = false
    window.ignoresMouseEvents = false; window.hidesOnDeactivate = false
    window.level = .statusBar
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    let view = PetImageView(frame: NSRect(x: 0, y: 0, width: size, height: size))
    view.imageScaling = .scaleProportionallyUpOrDown
    view.autoresizingMask = [.width, .height]
    window.contentView = view
    panel = window; imageView = view
    let effect = PetPanel(contentRect: effectFrame(initialFrame), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    effect.isReleasedWhenClosed = false
    effect.isOpaque = false; effect.backgroundColor = .clear; effect.hasShadow = false
    effect.ignoresMouseEvents = true; effect.hidesOnDeactivate = false
    effect.level = window.level; effect.collectionBehavior = window.collectionBehavior
    let ripple = RippleView(frame: NSRect(origin: .zero, size: effect.frame.size))
    ripple.autoresizingMask = [.width, .height]; effect.contentView = ripple
    effectPanel = effect; rippleView = ripple
    window.addChildWindow(effect, ordered: .below)
    for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
        geometryObservers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { _ in MainActor.assumeIsolated { alignEffects(); restPrompt.align() } })
    }
}
// FAIRY2 qualifies a lease only after its explicit hello; probes never show the pet.
struct Peer { var input = Data(); var qualified = false; var preludeToken: String?; var readySent = false; let accepted: TimeInterval }
var clients: [Int32: Peer] = [:]
var emptySince: TimeInterval? = ProcessInfo.processInfo.systemUptime
var appeared = false
var retiring = false
var outroStart: Double?
var outroRest: NSRect?
@MainActor func updateOutro(_ now: Double) -> Bool {
    guard let start = outroStart, let rest = outroRest else { panel?.orderOut(nil); return true }
    let sample = OutroSample(elapsed: now - start)
    guard sample.elapsed < OutroSample.end, !NSScreen.screens.isEmpty else {
        panel?.orderOut(nil); outroRest = nil; return true
    }
    panel?.setFrame(sample.body(rest: rest), display: true); panel?.alphaValue = sample.alpha
    return false
}
var theme = "auto"
let started = ProcessInfo.processInfo.systemUptime
var stopping = false
signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGHUP, SIG_IGN); signal(SIGPIPE, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termination.setEventHandler { stopping = true; introSFX.stop() }; termination.resume()
let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
interrupt.setEventHandler { stopping = true; introSFX.stop() }; interrupt.resume()
func dropPeer(_ fd: Int32) { introTrace("drop fd=\(fd) qualified=\(clients[fd]?.qualified ?? false)"); close(fd); clients.removeValue(forKey: fd) }
func sendLine(_ line: String, to fd: Int32) -> Bool {
    line.withCString { write(fd, $0, strlen($0)) == strlen($0) }
}
var lastIntroTrace: TimeInterval = 0
let timer = Timer(timeInterval: 0.05, repeats: true) { _ in
    let now = ProcessInfo.processInfo.systemUptime
    lifecycleAudio.tick(now)
    if introTest && now - lastIntroTrace >= 1 {
        lastIntroTrace = now
        introTrace("poll leases=\(clients.values.filter { $0.qualified }.count) retiring=\(retiring) player=\(lifecycleAudio.player?.processIdentifier ?? 0) running=\(lifecycleAudio.player?.isRunning ?? false) pending=\(lifecycleAudio.pending ?? "none") deadline=\(lifecycleAudio.deadline) killAt=\(lifecycleAudio.killAt ?? 0)")
    }
    // Drain queued accepts before the retirement commit. Under flood, defer commit
    // to another frame instead of blocking the AppKit main loop indefinitely.
    var drained = false
    for _ in 0..<128 {
        let fd = accept(server, nil, nil)
        if fd < 0 { drained = true; break }
        _ = fcntl(fd, F_SETFL, O_NONBLOCK)
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        if retiring { _ = sendLine("FAIRY2 retiring\n", to: fd); close(fd); continue }
        if clients.count >= 64 { close(fd); continue }
        clients[fd] = Peer(accepted: now)
    }
    for fd in Array(clients.keys) {
        if let peer = clients[fd], peer.preludeToken != nil && now - peer.accepted >= 15 { dropPeer(fd); continue }
        var total = 0
        while clients[fd] != nil {
            var bytes = [UInt8](repeating: 0, count: 256)
            let count = read(fd, &bytes, bytes.count)
            if count == 0 || (count < 0 && errno != EAGAIN && errno != EINTR) { dropPeer(fd); break }
            if count < 0 { break }
            total += count
            clients[fd]!.input.append(contentsOf: bytes.prefix(count))
            if total > 256 || clients[fd]!.input.count > 256 { dropPeer(fd); break }
            while let end = clients[fd]?.input.firstIndex(of: 10) {
                let line = String(data: clients[fd]!.input.prefix(upTo: end), encoding: .utf8)
                clients[fd]!.input.removeSubrange(...end)
                if !clients[fd]!.qualified {
                    if let line, ["welcome FAIRY2", "welcome FAIRY2 full", "welcome FAIRY2 simple"].contains(line) {
                        do {
                            if let mode = line.split(separator: " ").last.flatMap({ WelcomeMode(rawValue: String($0)) }) { try preferences.saveWelcome(mode) }
                            _ = sendLine("FAIRY2 welcome \(try preferences.readSettings().welcome.rawValue)\n", to: fd)
                        } catch { _ = sendLine("FAIRY2 welcome error\n", to: fd) }
                        dropPeer(fd); break
                    }
                    if let line, line.hasPrefix("prelude FAIRY2 "), cinematic,
                       let token = UUID(uuidString: String(line.dropFirst(15))) {
                        clients[fd]!.preludeToken = token.uuidString
                    } else if line == "lease FAIRY2", sendLine("FAIRY2 \(getpid())\n", to: fd) {
                        // The original public lease protocol remains unchanged.
                    } else { dropPeer(fd); break }
                    clients[fd]!.qualified = true
                    introTrace("qualified fd=\(fd)")
                } else if let token = clients[fd]!.preludeToken {
                    guard clients[fd]!.readySent, line == "claim \(token)", sendLine("FAIRY2 claimed \(token)\n", to: fd) else { dropPeer(fd); break }
                    clients[fd]!.preludeToken = nil
                } else if let line, ["theme auto", "theme light", "theme dark"].contains(line) { theme = String(line.dropFirst(6)) }
                else { dropPeer(fd); break }
            }
        }
        if let peer = clients[fd], !peer.qualified && now - peer.accepted >= 1 { dropPeer(fd) }
    }
    let hasLease = clients.values.contains { $0.qualified }
    if !hasLease {
        if emptySince == nil { emptySince = now; introTrace("zero leases; grace begins") }
    } else { emptySince = nil }
    // This main-loop transition is the commit boundary: later newcomers receive
    // retiring, cannot cancel goodbye, and retry the next owner without a spawn storm.
    if !retiring && (stopping || (drained && emptySince != nil && now - emptySince! >= 3)) {
        retiring = true
        introSFX.stop()
        restSchedule.retire(); restPrompt.close()
        introTrace("retirement commit stopping=\(stopping)")
        for fd in Array(clients.keys) { dropPeer(fd) }
        MainActor.assumeIsolated {
            sizeMenu.saveRetirementPosition()
            // Freeze the actual local frame before cancellation can resolve a landing.
            if cinematic && appeared && panel?.isVisible == true { outroRest = panel?.frame; outroStart = now }
            if cinematic && !intro.finished {
                intro.cancel(); introSFX.stop(); lifecycleAudio.stop(now)
                imageView?.introRaster = nil
                introCover?.orderOut(nil); introCover?.close(); introCover = nil; introView = nil
            }
            sizeMenu.dismiss(); panel?.ignoresMouseEvents = true; disposeEffects()
            if outroRest == nil { panel?.orderOut(nil) }
        }
        if appeared { lifecycleAudio.request("goodbye", now: now) }
    }
    if retiring {
        let visualDone = MainActor.assumeIsolated { updateOutro(now) }
        if visualDone && lifecycleAudio.idle {
            timer.invalidate(); panel?.orderOut(nil); panel?.close(); panel = nil; imageView = nil
            termination.cancel(); interrupt.cancel(); cleanup(); exit(0)
        }
        return
    }
    if !headless {
        let palette = theme == "auto" ? (app!.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? "dark" : "light") : theme
        let sample = IdleEffects(time: now - started)
        imageView?.sample = sample; imageView?.needsDisplay = true
        rippleView?.sample = sample; rippleView?.needsDisplay = true
        imageView?.image = frames[palette]![Int((now - started) / 0.05) % 120]
        // Keep the image visible during reload grace without resetting its clock.
        if cinematic && intro.finished && displayLayout() != introLayout {
            restingIntent.suspend()
            MainActor.assumeIsolated { _ = placeIntroPet(finishing: true) }
            introLayout = displayLayout()
        }
        if !cinematic || intro.finished {
            let canShow = !cinematic || MainActor.assumeIsolated { placeIntroPet() }
            if hasLease && canShow { panel?.orderFrontRegardless() }
        }
    }
    if hasLease && !appeared && (cinematic || headless || panel?.isVisible == true) {
        appeared = true
        if cinematic { MainActor.assumeIsolated { beginIntro(now) } }
        else { lifecycleAudio.request("welcome", now: now) }
    }
    if cinematic { MainActor.assumeIsolated { updateIntro(now, hasLease: hasLease) } }
    if restReminder {
        MainActor.assumeIsolated {
            // Qualification/cover ordering is not pet visibility. Full starts only
            // once materialization has nonzero alpha; simple starts at its first draw.
            let visible = panel?.isVisible == true && (panel?.alphaValue ?? 0) > 0
            if visible { restSchedule.firstVisible() }
            if restSchedule.presentIfDue(allowed: visible && !NSScreen.screens.isEmpty && (!cinematic || intro.finished) && lifecycleAudio.idle) {
                restPrompt.show()
                lifecycleAudio.request("activity", now: now)
            }
            restPrompt.align()
        }
    }
    // A prelude ready acknowledgement follows actual software ordering/drawing,
    // never the original early FAIRY2 greeting. This is not WindowServer proof.
    MainActor.assumeIsolated {
        if appeared && clients.values.contains(where: { $0.preludeToken != nil && !$0.readySent }) && (headless || introCover?.isVisible == true || panel?.isVisible == true) {
            introCover?.displayIfNeeded(); introCover?.flush()
            if simpleIntro { panel?.displayIfNeeded(); panel?.flush() }
            for fd in Array(clients.keys) {
                if let token = clients[fd]?.preludeToken, clients[fd]?.readySent == false {
                    if sendLine("FAIRY2 ready \(token)\n", to: fd) { clients[fd]!.readySent = true }
                    else { dropPeer(fd) }
                }
            }
        }
    }
}
@MainActor func effectsAligned(_ pet: PetPanel) -> Bool {
    let actual = effectPanel!.frame, expected = effectFrame(pet.frame)
    // AppKit rounds borderless frames to device-aligned point bounds.
    return abs(actual.midX - expected.midX) <= 1 && abs(actual.midY - expected.midY) <= 1
        && abs(actual.width - expected.width) <= 1 && abs(actual.height - expected.height) <= 1
}
// Own-view raster diagnostics, opt-in through the existing isolated GUI smoke.
@MainActor func effectsDiagnostics(_ pet: PetPanel) {
    precondition(effectPanel?.parent == pet && effectPanel!.ignoresMouseEvents)
    precondition(!effectPanel!.isOpaque && !effectPanel!.hasShadow && !effectPanel!.canBecomeKey)
    let original = pet.frame
    for size in FairySize.allCases {
        pet.setFrame(NSRect(x: original.minX + 17, y: original.minY - 11, width: size.points, height: size.points), display: true)
        precondition(effectsAligned(pet), "native move/resize alignment")
    }
    pet.setFrame(original, display: true)
    for index in 0..<1000 {
        let sample = IdleEffects(time: 0)
        let start = sample.glitchStart(index)
        let gap = sample.glitchStart(index + 1) - start
        precondition(gap >= 4.1 && gap <= 6.9)
        precondition(!IdleEffects(time: start - 0.001).glitch)
        precondition(IdleEffects(time: start + 0.01).glitch)
        precondition(!IdleEffects(time: start + 0.201).glitch)
    }
    var previousRadius: CGFloat = 0, previousAlpha: CGFloat = 1
    for tick in 22..<180 {
        let ring = IdleEffects(time: 1 + Double(tick) / 100).rings[0]
        precondition(ring.radius > previousRadius && ring.alpha < previousAlpha)
        previousRadius = ring.radius; previousAlpha = ring.alpha
    }
    for tick in 0..<10000 {
        let sample = IdleEffects(time: Double(tick) / 100)
        for ring in sample.rings { precondition(ring.radius >= 0.32 && ring.radius <= 0.74 && ring.alpha >= 0 && ring.alpha <= 0.20) }
        for row in 0..<sample.stripCount { precondition(abs(sample.displacement(row)) <= 0.025) }
    }
    guard let output = ProcessInfo.processInfo.environment["FAIRY_EFFECTS_PREVIEW"] else {
        print("PASS effects: seeded timing/bounds, native child alignment, clickthrough/nonkey")
        return
    }
    do { try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true) }
    catch { fail("effect preview directory: \(error)") }
    let start = IdleEffects(time: 0).glitchStart(0)
    let times: [(String, Double)] = [("rest", 0), ("ripple-early", 1.4), ("ripple-middle", 2.0), ("ripple-late", 2.6), ("glitch", start + 0.05), ("recovered", start + 0.25)]
    for size in FairySize.allCases {
        for palette in ["dark", "light"] {
            for (name, time) in times {
                let side = size.points
                let canvas = NSView(frame: NSRect(x: 0, y: 0, width: side * 1.8, height: side * 1.8))
                let ripple = RippleView(frame: canvas.bounds); ripple.sample = IdleEffects(time: time)
                let body = PetImageView(frame: NSRect(x: side * 0.4, y: side * 0.4, width: side, height: side))
                body.imageScaling = .scaleProportionallyUpOrDown
                body.image = frames[palette]![0]; body.sample = IdleEffects(time: time)
                canvas.addSubview(ripple); canvas.addSubview(body)
                guard let bitmap = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { fail("effect bitmap") }
                canvas.cacheDisplay(in: canvas.bounds, to: bitmap)
                precondition(bitmap.colorAt(x: 0, y: 0)!.alphaComponent == 0)
                do { try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/\(size.rawValue)-\(palette)-\(name).png")) }
                catch { fail("effect preview: \(error)") }
            }
        }
    }
    print("PASS effects: seeded timing/bounds, native child alignment, clickthrough/nonkey, 60 own-view transparent keyframes")
}

// Explicit isolated diagnostics never capture a screen or order a window front.
@MainActor func introDiagnostics() {
    precondition(preferenceOverride != nil && !headless)
    precondition(panel?.isVisible == false && introCover == nil, "no visible pre-lease pet")
    precondition(IntroSample.slipStart - IntroSample.clockStart == 2)
    let names = [0.0, 0.7, 2.7, 3.4, 4.9, 6.7, 7.2, 7.8, 10.0].map { IntroSample(elapsed: $0).phase }
    precondition(names == ["signal", "clock", "slip", "errors", "hdd", "reveal", "hold", "fade", "end"])
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    precondition(IntroSample(elapsed: 1).clock(Date(timeIntervalSince1970: 3661), calendar: calendar) == "01  01  01")
    precondition(IntroSample(elapsed: 2).clock(Date(timeIntervalSince1970: 3662), calendar: calendar) == "01  01  02")
    var previous: CGFloat = 0
    for tick in 0...1000 {
        let sample = IntroSample(elapsed: Double(tick) / 100)
        precondition(sample.loading >= previous && sample.loading <= 1); previous = sample.loading
    }
    precondition(previous == 1)
    var previousErrors = 0
    for tick in 340...489 {
        let count = IntroSample(elapsed: Double(tick) / 100).errorCount
        precondition(count >= previousErrors && count <= 9); previousErrors = count
    }
    precondition(previousErrors == 9)
    precondition(lifecyclePaths("welcome", directory: "/sounds", full: true) == ["/sounds/welcome-7.wav"])
    precondition(lifecyclePaths("welcome", directory: "/sounds", full: false).count == 6)
    for cancellation in ["none", "lease-after", "lease", "display", "overdue"] {
        var life = IntroLifetime(); life.begin(100); var welcomes = 0
        for tick in 0...240 {
            let elapsed = Double(tick) / 20
            let r = life.tick(100 + elapsed + (cancellation == "overdue" && tick >= 40 ? 5 : 0),
                              lease: !((cancellation == "lease" && tick == 20) || (cancellation == "lease-after" && tick == 150)), displayValid: !(cancellation == "display" && tick == 20))
            if r.welcome { precondition(r.sample.materialized == 1 && r.sample.loading == 1); welcomes += 1 }
            if tick == 60 { life.begin(103) } // More leases/reconnect must not reset start.
        }
        precondition(life.finished && life.start == 100)
        precondition(welcomes == (["none", "lease-after"].contains(cancellation) ? 1 : 0))
    }
    let dimensions: [(CGFloat, CGFloat)] = [(1920,1080),(1920,1200),(2520,1080),(900,1600),(80,90),(3840,2160)]
    for (w,h) in dimensions { for scale in [1.0,2.0] { for size in FairySize.allCases {
        let screen = NSRect(x: -w, y: -120, width: w, height: h)
        let visible = screen.insetBy(dx: min(4,w/10), dy: min(24,h/10))
        let landing = introLanding(size, visible: visible)
        let layout = IntroLayout(bounds: screen)
        precondition(abs(layout.stage.width / layout.stage.height - 791.0 / 294.0) < 0.0001)
        precondition(abs(layout.title.width / layout.bar.width - 501.0 / 640.0) < 0.0001)
        precondition(layout.title.minY > layout.bar.maxY && layout.bar.minY > layout.subtitle.maxY)
        for column in 0..<3 { precondition(layout.clockPair(column).midX == layout.clockLabel(column).midX) }
        for index in 0..<9 {
            let error = layout.error(index)
            precondition(screen.contains(error))
            if index > 0 { precondition(error.minX > layout.error(index - 1).minX && error.minY < layout.error(index - 1).minY) }
        }
        precondition(visible.contains(landing) && landing.width == min(size.points, visible.width, visible.height))
        for tick in 0...200 {
            let rect = introBody(IntroSample(elapsed: Double(tick) / 20), screen: screen, landing: landing)
            precondition(screen.insetBy(dx: -0.001, dy: -0.001).contains(rect) && rect.width.isFinite && rect.width * scale > 0)
        }
        precondition(introBody(IntroSample(elapsed: 10), screen: screen, landing: landing) == landing)
    } } }
    let view = IntroView(frame: NSRect(x: 0, y: 0, width: 960, height: 600))
    func click(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent {
        NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
    }
    precondition(view.acceptsFirstMouse(for: nil))
    // Former button position and ordinary canvas clicks both remain inert.
    for p in [NSPoint(x: 890, y: 562), NSPoint(x: 480, y: 300), .zero] {
        let elapsed = view.sample.elapsed
        view.mouseDown(with: click(.leftMouseDown, p))
        view.mouseUp(with: click(.leftMouseUp, p))
        view.mouseUp(with: click(.leftMouseUp, p))
        view.rightMouseDown(with: click(.rightMouseDown, p))
        view.rightMouseUp(with: click(.rightMouseUp, p))
        view.otherMouseDown(with: click(.otherMouseDown, p))
        view.otherMouseUp(with: click(.otherMouseUp, p))
        precondition(view.sample.elapsed == elapsed && view.subviews.isEmpty)
    }
    guard let output = ProcessInfo.processInfo.environment["FAIRY_INTRO_PREVIEW"] else { fail("diagnostics require FAIRY_INTRO_PREVIEW") }
    do { try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true) } catch { fail("intro output: \(error)") }
    // Separate transparent pet rasters exercise the production isolation, not a
    // flattened cover substitute. Fractional positions expose backing-grid drift.
    for scale in [1, 2] { for (index, body) in [NSRect(x: 200, y: 201.5, width: 280, height: 280), NSRect(x: 430, y: 403, width: 190, height: 190)].enumerated() {
        let pet = PetImageView(frame: NSRect(origin: .zero, size: body.size))
        pet.imageScaling = .scaleProportionallyUpOrDown; pet.image = frames["dark"]![30]
        var idle: NSBitmapImageRep?
        for (label, opacity) in [("idle", CGFloat(0)), ("full", CGFloat(1)), ("fade", CGFloat(0.4)), ("late", CGFloat(0))] {
            pet.introRaster = opacity > 0 ? IntroRaster(screenHeight: 1080, originY: body.minY, opacity: opacity) : nil
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(body.width) * scale, pixelsHigh: Int(body.height) * scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            bitmap.size = body.size
            pet.cacheDisplay(in: pet.bounds, to: bitmap)
            if let idle {
                var changed = 0
                // Convert both rasters to common sRGB before comparing colors.
                // Sample every seventh column but every row to detect grid drift.
                for y in 0..<bitmap.pixelsHigh { for x in stride(from: 0, to: bitmap.pixelsWide, by: 7) {
                    let a = idle.colorAt(x: x, y: y)!.usingColorSpace(.sRGB)!
                    let b = bitmap.colorAt(x: x, y: y)!.usingColorSpace(.sRGB)!
                    precondition(a.alphaComponent == b.alphaComponent, "graded alpha changed")
                    let differs = a.redComponent != b.redComponent || a.greenComponent != b.greenComponent || a.blueComponent != b.blueComponent
                    let low = body.minY + body.height - CGFloat(y + 1) / CGFloat(scale)
                    let high = body.minY + body.height - CGFloat(y) / CGFloat(scale)
                    let row = floor((high - 0.000001) / 3) * 3
                    let onGrid = row + 1 > low + 0.000001
                    if opacity == 0 || !onGrid || a.alphaComponent == 0 { precondition(!differs, "residual or off-grid raster") }
                    if differs { changed += 1 }
                } }
                precondition(opacity == 0 || changed > 0, "missing pet raster")
            } else { idle = bitmap }
            do { try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/pet-\(scale)x-\(index)-\(label).png")) } catch { fail("pet raster: \(error)") }
        }
    } }
    print("PASS intro raster: sRGB rows/graded alpha/transparent margins/zero residual; 2 positions/sizes x 1x/2x")
    let times: [(String, Double)] = [("signal",0.3),("clock",1.2),("slip",3.0),("errors-early",3.41),("errors-mid",4.0),("errors",4.7),("hdd",6.0),("hdd-complete",6.699),("blue",6.7),("reveal",6.95),("hold",7.5),("fade",8.6),("end",10)]
    for (w,h) in [(960.0,600.0),(600.0,960.0),(1260.0,540.0),(791.0,294.0)] {
        for (name,time) in times {
            let canvas = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h))
            let cover = IntroView(frame: canvas.bounds); cover.sample = IntroSample(elapsed: time); cover.date = Date(timeIntervalSince1970: 3661)
            canvas.addSubview(cover)
            if time >= IntroSample.revealStart {
                let pet = PetImageView(frame: introBody(cover.sample, screen: canvas.bounds, landing: introLanding(.standard, visible: canvas.bounds)))
                pet.imageScaling = .scaleProportionallyUpOrDown; pet.image = frames["dark"]![Int(time / 0.05) % 120]; pet.alphaValue = cover.sample.materialized
                pet.introRaster = cover.sample.background > 0 ? IntroRaster(screenHeight: h, originY: pet.frame.minY, opacity: cover.sample.background) : nil
                canvas.addSubview(pet)
            }
            guard let bitmap = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else { fail("intro bitmap") }
            canvas.cacheDisplay(in: canvas.bounds, to: bitmap)
            do { try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/\(Int(w))-\(name).png")) } catch { fail("intro preview: \(error)") }
        }
    }
    // Measure own-view raster work, not compositor/physical monitor frame pacing.
    for scale in [1, 2] {
        let large = IntroView(frame: NSRect(x: 0, y: 0, width: 3840 / scale, height: 2160 / scale))
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 3840, pixelsHigh: 2160, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = large.bounds.size
        var durations: [Double] = []
        for (name, time) in times {
            var phaseTimes: [Double] = []
            for _ in 0..<3 {
                large.sample = IntroSample(elapsed: time)
                let began = ProcessInfo.processInfo.systemUptime
                large.cacheDisplay(in: large.bounds, to: bitmap)
                phaseTimes.append((ProcessInfo.processInfo.systemUptime - began) * 1000)
            }
            durations += phaseTimes
            print("PERF \(scale)x phase=\(name) mean=\(phaseTimes.reduce(0,+)/3) max=\(phaseTimes.max()!) ms")
        }
        print("PERF \(3840 / scale)x\(2160 / scale) logical / \(scale)x bitmap, 39 own-view rasters, no PNG encoding: mean \(durations.reduce(0,+)/Double(durations.count)) ms, max \(durations.max()!) ms")
        for time in [6.95, 7.5, 8.6, 9.3] {
            let sample = IntroSample(elapsed: time)
            let body = introBody(sample, screen: large.bounds, landing: introLanding(.standard, visible: large.bounds))
            let pet = PetImageView(frame: NSRect(origin: .zero, size: body.size))
            pet.imageScaling = .scaleProportionallyUpOrDown; pet.image = frames["dark"]![30]
            pet.introRaster = sample.background > 0 ? IntroRaster(screenHeight: large.bounds.height, originY: body.minY, opacity: sample.background) : nil
            let raster = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(body.width) * scale, pixelsHigh: Int(body.height) * scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            raster.size = body.size
            let began = ProcessInfo.processInfo.systemUptime
            for _ in 0..<3 { pet.cacheDisplay(in: pet.bounds, to: raster) }
            print("PERF pet \(scale)x elapsed=\(time) mean=\((ProcessInfo.processInfo.systemUptime - began) * 1000 / 3) ms")
        }
    }
    print("PASS intro: phase/clock/loading/once/cancel/overdue/geometry 6 displays x 2 scales x 5 sizes, diagonal errors, aligned columns, source-relative HDD, first-mouse/inert pointer input, 52 own-view previews")
    precondition(panel?.isVisible == false && introCover == nil)
}
// Private own-view checks: hidden production panels are never ordered front.
@MainActor func presentationDiagnostics() throws {
    guard preferenceOverride != nil, let output = ProcessInfo.processInfo.environment["FAIRY_MODES_PREVIEW"],
          let pet = panel, let screen = pet.screen ?? NSScreen.screens.first, let uuid = DesktopPlacement.displayUUID(screen) else { fail("presentation diagnostics require private settings/output/display") }
    precondition(!pet.isVisible && introCover == nil)
    try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
    let rest = sizedFrame(.standard, center: NSPoint(x: screen.visibleFrame.midX, y: screen.visibleFrame.midY), visible: screen.visibleFrame)
    pet.setFrame(rest, display: false)
    sizeMenu.saveDragPosition() // The production performDrag completion boundary, without injecting mouse events.
    let saved = preferences.settings().position!
    precondition(saved.display == uuid && sizeMenu.pendingPosition == nil)
    try preferences.saveWelcome(.simple)
    for size in FairySize.allCases {
        sizeMenu.select(size)
        precondition(preferences.settings().position == saved && preferences.settings().welcome == .simple)
    }
    // An unrelated size success cannot clear a failed position retry.
    sizeMenu.pendingPosition = saved
    sizeMenu.select(.standard)
    let resizedIntent = restingPosition(pet.frame, display: uuid, visible: screen.visibleFrame, controlled: false)
    precondition(resizedIntent != nil && sizeMenu.pendingPosition == resizedIntent)
    precondition(preferences.settings().position == saved, "size success must not claim a position save")
    sizeMenu.retry(); precondition(sizeMenu.pendingPosition == nil && !sizeMenu.pendingSave)
    precondition(preferences.settings().position == resizedIntent)
    precondition(!pet.isVisible && sizeMenu.window == nil)
    let canvasRect = NSRect(x: 0, y: 0, width: 800, height: 500)
    let endpoint = NSRect(x: 90, y: 55, width: 140, height: 140)
    let samples: [(String, NSRect, CGFloat)] = [0.0, 0.325, 0.65, 1.0, 1.7, 2.4].map {
        ("simple-\($0)", SimpleSample(elapsed: $0).body(screen: canvasRect, landing: endpoint), 1)
    } + [0.0, 0.18, 0.4, 0.7, 0.95].map {
        let sample = OutroSample(elapsed: $0)
        return ("outro-\($0)", sample.body(rest: endpoint), sample.alpha)
    }
    for scale in [1, 2] { for (name, frame, alpha) in samples {
        let canvas = NSView(frame: canvasRect)
        let body = PetImageView(frame: frame)
        body.imageScaling = .scaleProportionallyUpOrDown; body.image = frames["dark"]![30]; body.alphaValue = alpha
        body.sample = IdleEffects(time: 1)
        canvas.addSubview(body)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 800 * scale, pixelsHigh: 500 * scale, bitsPerSample: 8,
                                      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = canvasRect.size; canvas.cacheDisplay(in: canvas.bounds, to: bitmap)
        precondition(bitmap.colorAt(x: 0, y: 0)!.alphaComponent == 0)
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/\(scale)x-\(name).png"))
    } }
    // Execute production outro cleanup with the hidden pet. Never orderFront.
    retiring = true; outroRest = rest; outroStart = 100
    disposeEffects()
    precondition(!updateOutro(100.18)); precondition(!pet.isVisible && effectPanel == nil)
    precondition(updateOutro(101)); precondition(outroRest == nil && !pet.isVisible)
    precondition(updateOutro(102)); precondition(!pet.isVisible)
    print("PASS presentation: drag-end save/size preservation/retry, 22 transparent own-view 1x/2x endpoints, production outro cleanup/no resurrection")
}
if args.contains("--presentation-diagnostics") {
    do { try MainActor.assumeIsolated { try presentationDiagnostics() } } catch { cleanup(); fail("presentation diagnostics: \(error)") }
    cleanup(); exit(0)
}
if args.contains("--intro-diagnostics") {
    MainActor.assumeIsolated { introDiagnostics() }; cleanup(); exit(0)
}

if guiSizeTest && !headless {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        guard let pet = panel else { fail("missing pet") }
        precondition(!pet.canBecomeKey && !pet.canBecomeMain)
        effectsDiagnostics(pet)
        let center = NSPoint(x: pet.frame.midX, y: pet.frame.midY)
        for size in FairySize.allCases {
            sizeMenu.toggle(at: center)
            precondition(sizeMenu.window != nil && !sizeMenu.window!.canBecomeKey)
            let row = FairySize.allCases.firstIndex(of: size)!
            let view = sizeMenu.window!.contentView as! SizeMenuView
            let point = view.convert(NSPoint(x: 80, y: 60 + CGFloat(row * 34)), to: nil)
            let click = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: 0,
                                          windowNumber: sizeMenu.window!.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
            view.mouseDown(with: click)
            precondition(sizeMenu.window == nil && sizeMenu.localMonitor == nil && sizeMenu.outsideMonitor == nil)
            precondition(effectsAligned(pet))
            precondition(preferences.load() == size)
            precondition(abs(pet.frame.width - min(size.points, pet.screen!.visibleFrame.width, pet.screen!.visibleFrame.height)) <= 1)
        }
        sizeMenu.toggle(at: center)
        sizeMenu.toggle(at: center)
        precondition(sizeMenu.window == nil)
        sizeMenu.toggle(at: center)
        do {
            try FileManager.default.removeItem(at: preferences.file)
            try FileManager.default.createDirectory(at: preferences.file, withIntermediateDirectories: false)
            sizeMenu.select(.standard)
            precondition((sizeMenu.window?.contentView as? SizeMenuView)?.warning == true)
            sizeMenu.toggle(at: center) // Dismiss/reopen must not claim an unsaved choice is saved.
            sizeMenu.toggle(at: center)
            precondition((sizeMenu.window?.contentView as? SizeMenuView)?.warning == true)
            try FileManager.default.removeItem(at: preferences.file)
        } catch { fail("GUI save-failure fixture: \(error)") }
        sizeMenu.select(.standard)
        precondition(sizeMenu.window == nil && preferences.load() == .standard)
        sizeMenu.toggle(at: center)
        precondition((sizeMenu.window?.contentView as? SizeMenuView)?.warning == false)
        if let output = ProcessInfo.processInfo.environment["FAIRY_MENU_PREVIEW"],
           let view = sizeMenu.window?.contentView,
           let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: bitmap)
            do { try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output)) }
            catch { fail("preview: \(error)") }
        }
        // Leave menu open while normal timer accepts leases/themes; close after one second.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            precondition(imageView?.image != nil)
            sizeMenu.dismiss()
            precondition(sizeMenu.localMonitor == nil && sizeMenu.outsideMonitor == nil)
            print("PASS GUI size lifecycle: five presets, persistence, nonkey panels, toggle, preview, monitor cleanup, animation while menu open")
        }
    }
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.add(timer, forMode: .eventTracking)
if headless { RunLoop.main.run() } else { app!.run() }
