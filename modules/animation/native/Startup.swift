// Opt-in, cache-only prelude launcher. Pi itself is always exec'd, never proxied.
import Foundation
import Darwin

let arguments = CommandLine.arguments
// Called only by the package shell function: executable, package root, cached helper.
guard arguments.count == 4 else { exit(64) }
let executable = arguments[1], package = arguments[2], helper = arguments[3]
let environment = ProcessInfo.processInfo.environment
let home = FileManager.default.homeDirectoryForCurrentUser.path
let directory = "/tmp/pi-fairy-\(getuid())"
var lease: Int32 = -1
func delegate() -> Never {
    // A prelude socket must not leak if exec fails.
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup(executable), nil]
    argv.withUnsafeBufferPointer { _ = execv(executable, $0.baseAddress!) }
    let failure = errno
    if lease >= 0 { close(lease) }
    fputs("pi: unable to execute \(executable): \(String(cString: strerror(failure)))\n", stderr)
    exit(failure == ENOENT ? 127 : 126)
}
func canonical(_ path: String, base: String) -> String {
    let expanded = (path as NSString).expandingTildeInPath
    return URL(fileURLWithPath: expanded.hasPrefix("/") ? expanded : base + "/" + expanded).standardizedFileURL.resolvingSymlinksInPath().path
}
func settings(_ path: String) -> [String: Any]? {
    guard FileManager.default.fileExists(atPath: path) else { return [:] }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count <= 1_048_576,
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return value
}
func emptyList(_ value: Any?) -> Bool { value == nil || (value as? [Any])?.isEmpty == true }
func eligible() -> Bool {
    guard isatty(0) == 1, isatty(1) == 1, isatty(2) == 1, tcgetpgrp(0) == getpgrp(),
          environment["PI_SUBAGENT_CHILD"] == nil, environment["PI_CODING_AGENT_DIR"] == nil,
          environment["FAIRY_STARTUP_FD"] == nil, environment["NODE_OPTIONS"] == nil,
          environment["PI_PACKAGE_DIR"] == nil else { return false }
    // Recognize the current external package's declared bin, not an install/version path.
    let realExecutable = canonical(executable, base: FileManager.default.currentDirectoryPath)
    var parent = URL(fileURLWithPath: realExecutable).deletingLastPathComponent()
    var recognized = false
    for _ in 0..<4 {
        if let manifest = settings(parent.appendingPathComponent("package.json").path),
           manifest["name"] as? String == "@earendil-works/pi-coding-agent",
           let bin = manifest["bin"] as? [String: String], let entry = bin["pi"],
           canonical(entry, base: parent.path) == realExecutable { recognized = true; break }
        parent = parent.deletingLastPathComponent().standardizedFileURL
    }
    guard recognized else { return false }
    let cwd = FileManager.default.currentDirectoryPath, agent = home + "/.pi/agent"
    guard let global = settings(agent + "/settings.json"), let project = settings(cwd + "/.pi/settings.json"),
          emptyList(global["extensions"]), let packages = global["packages"] as? [Any] else { return false }
    // Only known neutral project activation settings; model/theme/etc are irrelevant.
    for key in ["packages", "extensions", "skills", "prompts", "themes"] {
        if !emptyList(project[key]) { return false }
    }
    for name in ["extensions", "skills", "prompts", "themes"] {
        if FileManager.default.fileExists(atPath: cwd + "/.pi/" + name) { return false }
    }
    var ancestor = URL(fileURLWithPath: cwd)
    while true {
        let skills = ancestor.appendingPathComponent(".agents/skills").path
        if skills != home + "/.agents/skills" && FileManager.default.fileExists(atPath: skills) { return false }
        let parent = ancestor.deletingLastPathComponent().standardizedFileURL
        if parent.path == ancestor.path { break }; ancestor = parent
    }
    // Local Fairy root must be positively selected exactly once without filters.
    // Unknown package objects are conservative fallback, not a partial resolver.
    var matches = 0
    for item in packages {
        guard let source = item as? String else { return false }
        if source.hasPrefix("-") || source.hasPrefix("!") || source.hasPrefix("+") { return false }
        if source.hasPrefix("npm:") || source.hasPrefix("git:") || source.contains("://") { continue }
        if canonical(source, base: agent) == canonical(package, base: cwd) { matches += 1 }
    }
    guard matches == 1,
          let manifest = settings(package + "/package.json"),
          let pi = manifest["pi"] as? [String: Any],
          pi["extensions"] as? [String] == ["./index.ts"] else { return false }
    return true
}
func safeDirectory() -> Bool {
    // No creation on the launch path: explicit preparation owns the cache.
    var info = stat()
    return lstat(directory, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR && info.st_uid == getuid() && (info.st_mode & 0o077) == 0
}
func connectSocket() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    _ = fcntl(fd, F_SETFL, O_NONBLOCK)
    var noSignal: Int32 = 1
    _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
    var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array((directory + "/sock").utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { close(fd); return -1 }
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    if result != 0 { close(fd); return -1 }
    _ = fcntl(fd, F_SETFL, O_NONBLOCK)
    return fd
}
func spawnProgram(_ program: String, values: [String], detached: Bool) -> pid_t? {
    let storage = values.map { strdup($0) }; defer { storage.forEach { free($0) } }
    let argv = storage + [nil]
    var attributes: posix_spawnattr_t?, actions: posix_spawn_file_actions_t?
    guard posix_spawnattr_init(&attributes) == 0 else { return nil }
    defer { posix_spawnattr_destroy(&attributes) }
    guard posix_spawn_file_actions_init(&actions) == 0 else { return nil }
    defer { posix_spawn_file_actions_destroy(&actions) }
    let flags = POSIX_SPAWN_CLOEXEC_DEFAULT | (detached ? POSIX_SPAWN_SETSID : 0)
    guard posix_spawnattr_setflags(&attributes, Int16(flags)) == 0 else { return nil }
    for fd: Int32 in 0...2 {
        guard posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", O_RDWR, 0) == 0 else { return nil }
    }
    var pid: pid_t = 0
    let environmentStrings: [String] = ["HOME=\(home)", "PATH=/usr/bin:/bin"]
    let variables = environmentStrings.map { strdup($0) }; defer { variables.forEach { free($0) } }
    let envp = variables + [nil]
    let result = argv.withUnsafeBufferPointer { args in
        envp.withUnsafeBufferPointer { env in
            posix_spawn(&pid, program, &actions, &attributes, args.baseAddress!, env.baseAddress!)
        }
    }
    return result == 0 ? pid : nil
}
func launchHelper(deadline: Double) -> Bool {
    // Reap this short-lived direct child BEFORE exec. Otherwise a retired helper
    // can become an unowned zombie child of the long-lived Node Pi process.
    let launcher = arguments[0]
    guard let pid = spawnProgram(launcher, values: [launcher, "--spawn-helper", package, helper], detached: false) else { return false }
    var status: Int32 = 0
    while ProcessInfo.processInfo.systemUptime < deadline {
        let result = waitpid(pid, &status, WNOHANG)
        if result == pid { return status == 0 }
        if result < 0 && errno != EINTR { return false }
        usleep(1_000)
    }
    // Only this unleased trampoline PID is owned here; never kill a helper.
    _ = kill(pid, SIGKILL)
    while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
    return false
}
if executable == "--spawn-helper" {
    guard safeDirectory(), access(helper, X_OK) == 0 else { exit(1) }
    let values = [helper, directory, package + "/modules/animation/assets", "--intro-saved", "--rest-reminder", "--lifecycle-sounds", package + "/modules/voice/sounds", "--intro-sfx", package + "/modules/animation/assets/intro/sfx-v4.wav"]
    exit(spawnProgram(helper, values: values, detached: true) == nil ? 1 : 0)
}

guard eligible(), safeDirectory(), access(helper, X_OK) == 0 else { delegate() }
let start = ProcessInfo.processInfo.systemUptime
let deadline = start + 1.5
lease = connectSocket()
if lease < 0 {
    // Do not launch against an existing or inaccessible socket, including retirement.
    var info = stat()
    if lstat(directory + "/sock", &info) == 0 || errno != ENOENT { delegate() }
    guard launchHelper(deadline: deadline) else { delegate() }
    while lease < 0 && ProcessInfo.processInfo.systemUptime < deadline {
        usleep(10_000); lease = connectSocket()
    }
}
guard lease >= 0 else { delegate() }
let token = UUID().uuidString
let hello = "prelude FAIRY2 \(token)\n"
let sent = hello.withCString { write(lease, $0, strlen($0)) }
var input = Data()
while sent == hello.utf8.count && ProcessInfo.processInfo.systemUptime < deadline && input.count <= 96 {
    var descriptor = pollfd(fd: lease, events: Int16(POLLIN), revents: 0)
    let remaining = max(1, Int32((deadline - ProcessInfo.processInfo.systemUptime) * 1000))
    if poll(&descriptor, 1, remaining) <= 0 { break }
    var bytes = [UInt8](repeating: 0, count: 128)
    let count = read(lease, &bytes, bytes.count)
    if count <= 0 { break }
    input.append(contentsOf: bytes.prefix(count))
    if input.contains(10) { break }
}
if String(data: input, encoding: .utf8) == "FAIRY2 ready \(token)\n" {
    // exec preserves this one fd until the eligible integrated plugin claims it.
    _ = fcntl(lease, F_SETFD, 0)
    setenv("FAIRY_STARTUP_FD", String(lease), 1)
    setenv("FAIRY_STARTUP_TOKEN", token, 1)
} else { close(lease); lease = -1 }
delegate()
