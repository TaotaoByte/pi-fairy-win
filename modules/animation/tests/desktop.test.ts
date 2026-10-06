import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, lstat, symlink } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { DesktopClient, eligible, privateDirectory, connectLease } from "../src/desktop/client.ts";
import { fileURLToPath } from "node:url";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test("desktop eligibility excludes every non-TUI and explicit subagent, not root parent marker", () => {
	for (const mode of ["rpc", "json", "print"]) assert.equal(eligible(mode, {}), false);
	assert.equal(eligible("tui", { PI_SUBAGENT_CHILD: "1" }), false);
	assert.equal(eligible("tui", { PI_SUBAGENT_PARENT_SESSION: "root" }), true);
	assert.equal(eligible("tui", { PI_CODING_AGENT: "true" }), true);
});
test("desktop private directory refuses broad permissions and symlinks", { skip: process.platform !== "darwin" }, async () => {
	const dir = await mkdtemp("/tmp/fairy-desktop-security-");
	try {
		assert.equal(await privateDirectory(dir), dir);
		await chmod(dir, 0o755);
		await assert.rejects(privateDirectory(dir), /目录不安全/);
		await chmod(dir, 0o700);
		await symlink(dir, dir + "-link");
		await assert.rejects(privateDirectory(dir + "-link"), /目录不安全/);
	} finally { await rm(dir, { recursive: true, force: true }); await rm(dir + "-link", { force: true }); }
});

test("native desktop IPC: concurrent ownership, leases, crash, stale socket, reload grace, malformed peers", { skip: process.platform !== "darwin", timeout: 150_000 }, async () => {
	const dir = await mkdtemp("/tmp/fairy-desktop-ipc-");
	const source = fileURLToPath(new URL("../native/Fairy.swift", import.meta.url));
	const assets = fileURLToPath(new URL("../assets", import.meta.url));
	const children: ReturnType<typeof spawn>[] = [];
	const leases: Awaited<ReturnType<typeof connectLease>>[] = [];
	const launch = () => {
		const child = spawn(dir + "/Fairy", [dir, assets, "--headless"], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: dir + "/settings" } });
		child.stderr?.on("data", d => process.stderr.write(d));
		children.push(child); return child;
	};
	const connect = async () => {
		for (let i = 0; i < 200; i++) {
			try { const s = await connectLease(dir + "/sock"); leases.push(s); return s; } catch (e) { if (i === 199) console.error(e, children.map(p=>[p.pid,p.exitCode,p.signalCode])); await sleep(50); }
		}
		throw new Error("no native greeting");
	};
	try {
		await promisify(execFile)("/usr/bin/swiftc", [source, "-o", dir + "/Fairy"], { timeout: 120_000 });
		const diagnostics = await promisify(execFile)(dir + "/Fairy", ["--size-self-test"], {
            env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: dir + "/settings" },
        });
        assert.match(diagnostics.stdout, /PASS size preferences/);
        const restarted = await promisify(execFile)(dir + "/Fairy", ["--size-self-test", "--expect-large"], {
            env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: dir + "/settings" },
        });
        assert.match(restarted.stdout, /survives a new process/);
        for (let i = 0; i < 8; i++) launch();
		const a = await connect(), b = await connect();
		await sleep(400);
		assert.equal(children.filter(p => p.exitCode === null).length, 1);
		const owner = children.find(p => p.exitCode === null)!;
		const lockInode = (await lstat(dir + "/lock")).ino;
		const socketInode = (await lstat(dir + "/sock")).ino;
		a.destroy(); await sleep(3200);
		assert.equal(owner.exitCode, null, "second lease keeps original owner alive");
		b.destroy(); await sleep(500);
		const replacement = await connect();
		assert.equal((await lstat(dir + "/sock")).ino, socketInode, "reload retains socket/clock");
		const contender = launch(); await sleep(200);
		assert.equal(contender.exitCode, 0);
		assert.equal((await lstat(dir + "/sock")).ino, socketInode);
		const malformed = await connect();
		malformed.write("x".repeat(300)); await sleep(200);
		assert.equal(malformed.destroyed, true);
		owner.kill("SIGKILL"); await sleep(200);
		assert.equal(replacement.destroyed, true, "helper crash reaches leases");
		launch(); const recovered = await connect();
		assert.equal((await lstat(dir + "/lock")).ino, lockInode, "persistent lock inode");
		recovered.destroy(); await sleep(3500);
		assert.ok(children.every(p => p.exitCode !== null || p.signalCode !== null), "last client exits after grace");
		await assert.rejects(lstat(dir + "/sock"), { code: "ENOENT" });
		// Foreign active socket without Fairy's flock must NEVER be unlinked.
		const foreign = createServer(s => s.destroy());
		await new Promise<void>(r => foreign.listen(dir + "/sock", r));
		const foreignInode = (await lstat(dir + "/sock")).ino;
		const refused = launch(); await sleep(200);
		assert.equal(refused.exitCode, 1);
		assert.equal((await lstat(dir + "/sock")).ino, foreignInode);
		await new Promise<void>(r => foreign.close(() => r()));
		// SIGKILL of a separate client is detected through EOF, no PID polling.
		const last = launch(); await connect();
		leases.at(-1)!.destroy();
		const peer = spawn(process.execPath, ["-e", `require('net').createConnection(${JSON.stringify(dir + "/sock")}).on('connect',function(){this.write('lease FAIRY2\\n')}).on('data',()=>{});`], { stdio: "ignore" });
		children.push(peer); await sleep(300); peer.kill("SIGKILL");
		await sleep(3500); assert.equal(last.exitCode, 0);
	} finally {
		for (const lease of leases) lease.destroy();
		for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await sleep(100); await rm(dir, { recursive: true, force: true });
	}
});


test("DesktopClient never launches on construction, preserves explicit theme, bounds crash reconnects", { skip: process.platform !== "darwin", timeout: 10_000 }, async () => {
 const dir = await mkdtemp("/tmp/fairy-desktop-client-");
 let launches = 0;
 const messages: string[] = [], received: string[] = [];
 const peers: import("node:net").Socket[] = [];
 const server = createServer(socket => {
  peers.push(socket); socket.write("FAIRY2 123\n");
  socket.on("data", data => received.push(data.toString()));
 });
 await new Promise<void>(r => server.listen(dir + "/sock", r));
 const client = new DesktopClient(message => messages.push(message), {
  directory: async () => dir, launch: async () => { launches++; },
 });
 try {
  await sleep(100); assert.equal(peers.length, 0); assert.equal(launches, 0);
  client.setAppearance("light"); client.start(); client.start();
  await sleep(200); assert.equal(peers.length, 1); assert.equal(received.join(""), "lease FAIRY2\ntheme light\n");
  for (let i = 0; i < 3; i++) { peers.at(-1)!.destroy(); await sleep(200); }
  assert.equal(peers.length, 3, "only two crash reconnects, even if another helper stays available");
  assert.equal(messages.length, 1); assert.equal(messages[0], "桌面 Fairy 多次停止；请先 /fairy-anim off 再 /fairy-anim on 重试。");
  assert.equal(launches, 0, "existing helper needs no spawn");
 } finally {
  client.dispose(); for (const peer of peers) peer.destroy();
  await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true });
 }
});

test("DesktopClient enforces elapsed deadline against a silent peer and closes connections", { skip: process.platform !== "darwin", timeout: 16_000 }, async () => {
 const dir = await mkdtemp("/tmp/fairy-desktop-deadline-");
 const peers = new Set<import("node:net").Socket>();
 const messages: string[] = []; let launches = 0;
 const server = createServer(socket => {
  peers.add(socket); socket.resume(); socket.on("error", () => {});
  socket.on("close", () => peers.delete(socket));
 });
 await new Promise<void>(r => server.listen(dir + "/sock", r));
 const client = new DesktopClient(m => messages.push(m), {
  directory: async () => dir, launch: async () => { launches++; },
 });
 try {
  client.start(); await sleep(12_000);
  assert.equal(messages.length, 1, "silent peer must fail within the 10s budget plus scheduling margin");
  assert.equal(messages[0], "桌面 Fairy 不可用：Error: 桌面辅助进程在 10 秒内未接受连接。请先 /fairy-anim off 再 /fairy-anim on 重试；检查 Swift/Xcode SDK：xcrun --show-sdk-path。");
  assert.equal(launches, 1);
  assert.equal(peers.size, 0, "timed-out handshake must leave no lease");
 } finally {
  client.dispose(); for (const peer of peers) peer.destroy();
  await new Promise<void>(r => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
 }
});

test("DesktopClient reports build failure once, and dispose cancels pending first-use launch", { skip: process.platform !== "darwin" }, async () => {
 const dir = await mkdtemp("/tmp/fairy-desktop-cancel-");
 const messages: string[] = []; let launches = 0;
 const failed = new DesktopClient(m => messages.push(m), {
  directory: async () => dir, launch: async () => { launches++; throw new Error("SDK unavailable"); },
 });
 failed.start(); failed.start(); await sleep(100);
 assert.equal(launches, 1); assert.equal(messages.length, 1); assert.match(messages[0], /SDK unavailable/);
 failed.dispose();
 let finish: (() => void) | undefined; let spawned = false;
 const cancelled = new DesktopClient(m => messages.push(m), {
  directory: async () => dir,
  launch: async (_directory, wanted) => { await new Promise<void>(r => { finish = r; }); if (wanted()) spawned = true; },
 });
 cancelled.start(); await sleep(100); cancelled.dispose(); finish!(); await sleep(150);
 assert.equal(spawned, false); assert.equal(messages.length, 1);
 await rm(dir, { recursive: true, force: true });
});


test("DesktopClient refuses an incompatible live FAIRY1 owner without launching or unlinking", { skip: process.platform !== "darwin" }, async () => {
 const dir = await mkdtemp("/tmp/fairy-desktop-version-");
 const peers: import("node:net").Socket[] = []; const messages: string[] = []; let launches = 0;
 const server = createServer(socket => { peers.push(socket); socket.on("error", () => {}); socket.resume(); socket.write("FAIRY1 123\n"); });
 await new Promise<void>(r => server.listen(dir + "/sock", r));
 const inode = (await lstat(dir + "/sock")).ino;
 const client = new DesktopClient(m => messages.push(m), { directory: async () => dir, launch: async () => { launches++; } });
 try {
  client.start(); await sleep(200);
  assert.equal(launches, 0); assert.equal(messages.length, 1); assert.equal(messages[0], "桌面 Fairy 不可用：Error: Fairy 桌面协议不兼容；请退出所有 Pi 后重启升级。请先 /fairy-anim off 再 /fairy-anim on 重试；检查 Swift/Xcode SDK：xcrun --show-sdk-path。");
  assert.equal((await lstat(dir + "/sock")).ino, inode);
 } finally {
  client.dispose(); for (const peer of peers) peer.destroy();
  await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true });
 }
});
