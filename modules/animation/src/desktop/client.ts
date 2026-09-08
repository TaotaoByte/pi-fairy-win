import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, rename, rm, access } from "node:fs/promises";
import { closeSync, fstatSync } from "node:fs";
import { createConnection, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);
export function eligible(mode: string, env = process.env): boolean {
	// pi-subagents child-runtime-config.ts documents CHILD; PARENT_SESSION is also set in roots.
	return mode === "tui" && !env.PI_SUBAGENT_CHILD;
}
export async function privateDirectory(path = `/tmp/pi-fairy-${process.getuid!()}`): Promise<string> {
	await mkdir(path, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) throw new Error(`Fairy 目录不安全（必须由当前用户拥有且权限为 0700）： ${path}`);
	return path;
}
const building = new Map<string, Promise<string>>();
export async function cachedNativePath(name: "Fairy" | "Startup", directory: string): Promise<string> {
	const hash = createHash("sha256").update(await readFile(root + `native/${name}.swift`)).update(process.arch).digest("hex").slice(0, 16);
	return `${directory}/${name}-${hash}`;
}
export function buildHelper(name: "Fairy" | "Startup" = "Fairy"): Promise<string> {
	if (building.has(name)) return building.get(name)!;
	const promise = (async () => {
		if (process.platform !== "darwin") throw new Error("桌面 Fairy 仅支持 macOS");
		const directory = await privateDirectory();
		const source = root + `native/${name}.swift`;
		const binary = await cachedNativePath(name, directory);
		try { await access(binary); return binary; } catch {}
		const temp = `${binary}-${randomUUID()}`;
		try {
			await run("/usr/bin/swiftc", ["-O", source, "-o", temp], { timeout: 120_000, maxBuffer: 128 * 1024 });
			await rename(temp, binary); // Concurrent builds publish only complete executables.
			return binary;
		} finally { await rm(temp, { force: true }); }
	})();
	building.set(name, promise); return promise;
}
export interface StartupLease { fd: number; token: string }
export function consumeStartupLease(env = process.env): StartupLease | undefined {
	const fd = Number(env.FAIRY_STARTUP_FD), token = env.FAIRY_STARTUP_TOKEN;
	delete env.FAIRY_STARTUP_FD; delete env.FAIRY_STARTUP_TOKEN;
	if (!Number.isInteger(fd) || fd < 3 || !token || !/^[0-9A-F-]{36}$/.test(token)) return;
	try { if (fstatSync(fd).isSocket()) return { fd, token }; } catch {}
}
export function claimStartupLease(socket: Socket, token: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		let input = "";
		const timer = setTimeout(() => socket.destroy(new Error("Fairy 启动连接认领超时")), 1000);
		const fail = () => { clearTimeout(timer); reject(new Error("Fairy 启动连接认领失败")); };
		const data = (chunk: Buffer) => {
			input += chunk.toString();
			if (input === `FAIRY2 claimed ${token}\n`) {
				clearTimeout(timer); socket.off("data", data); socket.off("close", fail); socket.unref(); resolve(socket);
			} else if (input.includes("\n") || input.length > 96) socket.destroy();
		};
		socket.once("close", fail); socket.on("error", fail); socket.on("data", data);
		socket.write(`claim ${token}\n`);
	});
}
export function connectLease(path: string, timeoutMs = 1000): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		let input = "";
		socket.once("connect", () => socket.write("lease FAIRY2\n"));
		const timeout = setTimeout(() => socket.destroy(new Error("Fairy 桌面连接握手超时")), timeoutMs);
		const error = (err: Error) => { clearTimeout(timeout); reject(err); };
		socket.on("error", error);
		socket.on("close", () => { clearTimeout(timeout); reject(new Error("Fairy 桌面在握手完成前断开连接")); });
		const data = (chunk: Buffer) => {
			input += chunk.toString();
			if (input.length > 64) { socket.destroy(Object.assign(new Error("Fairy 桌面协议不兼容；请退出所有 Pi 后重启升级"), { code: "FAIRY_INCOMPATIBLE" })); return; }
			if (!input.includes("\n")) return;
			if (input === "FAIRY2 retiring\n") { socket.destroy(Object.assign(new Error("Fairy 桌面正在退出"), { code: "FAIRY_RETIRING" })); return; }
			if (!/^FAIRY2 \d+\n$/.test(input)) { socket.destroy(Object.assign(new Error("Fairy 桌面协议不兼容；请退出所有 Pi 后重启升级"), { code: "FAIRY_INCOMPATIBLE" })); return; }
			clearTimeout(timeout); socket.off("data", data); socket.unref(); resolve(socket);
		};
		socket.on("data", data);
	});
}
export type WelcomeMode = "full" | "simple";
/** Separate non-lease peer: old owners may reject it without losing the main lease. */
export function requestWelcome(path: string, mode?: WelcomeMode): Promise<WelcomeMode> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		let input = "", settled = false;
		const finish = (error?: Error, value?: WelcomeMode) => {
			if (settled) return; settled = true;
			clearTimeout(timer); socket.destroy();
			if (error) reject(error); else resolve(value!);
		};
		const timer = setTimeout(() => finish(new Error("开场设置请求超时；请关闭所有 Pi 的桌面连接后重试。")), 1500);
		socket.on("error", (error) => finish(error));
		socket.on("close", () => finish(new Error("当前桌面进程不支持开场设置；请关闭所有 Pi 的桌面连接后重试。")));
		socket.on("connect", () => socket.write(`welcome FAIRY2${mode ? ` ${mode}` : ""}\n`));
		socket.on("data", (chunk) => {
			input += chunk.toString();
			if (!input.includes("\n") && input.length <= 64) return;
			const match = /^FAIRY2 welcome (full|simple)\n$/.exec(input);
			if (match && (!mode || mode === match[1])) finish(undefined, match[1] as WelcomeMode);
			else finish(new Error("开场设置未确认保存（不支持、正在退出或写入失败）；请关闭所有 Pi 的桌面连接后重试。"));
		});
	});
}
export async function welcomeSetting(mode?: WelcomeMode, runtime = {
	directory: privateDirectory,
	async offline(directory: string, choice?: WelcomeMode): Promise<string> {
		const binary = await buildHelper();
		const result = await run(binary, [directory, root + "assets", "--welcome-setting", ...(choice ? [choice] : [])], { timeout: 3000, maxBuffer: 4096 });
		return result.stdout.trim();
	},
}): Promise<WelcomeMode> {
	const directory = await runtime.directory();
	try { return await requestWelcome(directory + "/sock", mode); }
	catch (error) {
		if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
	}
	// The command owns the same nonblocking flock; a racing owner fails honestly.
	const result = await runtime.offline(directory, mode);
	if ((result !== "full" && result !== "simple") || (mode && result !== mode)) throw new Error("开场设置未确认保存");
	return result;
}
export interface DesktopRuntime {
	directory(): Promise<string>;
	launch(directory: string, stillWanted: () => boolean, lifecycleSoundsDirectory?: string): Promise<void>;
}
export function desktopLaunchArguments(directory: string, lifecycleSoundsDirectory?: string): string[] {
	return [directory, root + "assets", ...(lifecycleSoundsDirectory ? ["--intro-saved", "--rest-reminder", "--lifecycle-sounds", lifecycleSoundsDirectory, "--intro-sfx", root + "assets/intro/sfx-v4.wav"] : [])];
}
const desktopRuntime: DesktopRuntime = {
	directory: privateDirectory,
	async launch(directory, stillWanted, lifecycleSoundsDirectory) {
		const binary = await buildHelper();
		if (!stillWanted()) return;
		const child = spawn(binary, desktopLaunchArguments(directory, lifecycleSoundsDirectory), { detached: true, stdio: "ignore", env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin" } });
		await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
		child.unref();
	},
};
export class DesktopClient {
	private socket?: Socket;
	private closed = false;
	private pending = false;
	private launches = 0;
	private reconnects = 0;
	private theme?: "auto" | "light" | "dark";
	private notify: (message: string) => void;
	private runtime: DesktopRuntime;
	private lifecycleSoundsDirectory?: string;
	private startup?: StartupLease;
	private claiming?: Socket;
	constructor(notify: (message: string) => void, runtime = desktopRuntime, lifecycleSoundsDirectory?: string, startup?: StartupLease) {
		this.notify = notify; this.runtime = runtime; this.lifecycleSoundsDirectory = lifecycleSoundsDirectory; this.startup = startup;
	}
	start(): void { if (!this.pending && !this.closed && !this.socket) void this.connect(); }
	setAppearance(theme: "auto" | "light" | "dark"): void {
		this.theme = theme;
		this.socket?.write(`theme ${theme}\n`);
	}
	private discardStartupLease(): void {
		const startup = this.startup; this.startup = undefined;
		if (startup) { try { closeSync(startup.fd); } catch {} }
	}
	dispose(): void { this.closed = true; this.discardStartupLease(); this.claiming?.destroy(); this.socket?.destroy(); this.socket = undefined; }
	private async connect(): Promise<void> {
		this.pending = true;
		try {
			const directory = await this.runtime.directory();
			let deadline = performance.now() + 10_000;
			let lastLaunch = -Infinity;
			for (let attempt = 0; !this.closed && performance.now() < deadline; attempt++) {
				try {
					let socket: Socket;
					if (this.startup) {
						const startup = this.startup;
						this.claiming = new Socket({ fd: startup.fd, readable: true, writable: true });
						this.startup = undefined; // Socket owns the fd only after construction succeeds.
						try { socket = await claimStartupLease(this.claiming, startup.token); }
						catch { if (this.closed) return; continue; }
						finally { this.claiming = undefined; }
					} else socket = await connectLease(directory + "/sock", Math.max(1, Math.min(1000, deadline - performance.now())));
					if (this.closed) { socket.destroy(); return; }
					this.socket = socket;
					if (this.theme) socket.write(`theme ${this.theme}\n`);
					socket.once("close", () => {
						this.socket = undefined;
						if (!this.closed) {
							if (++this.reconnects <= 2) this.start();
							else this.notify("桌面 Fairy 多次停止；请先 /fairy-anim off 再 /fairy-anim on 重试。");
						}
					});
					return;
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "FAIRY_INCOMPATIBLE") throw error;
					if (code !== "FAIRY_RETIRING" && (attempt === 0 || ((code === "ECONNREFUSED" || code === "ENOENT") && performance.now() - lastLaunch >= 1000))) {
						if (this.launches >= 3) throw error;
						if (this.closed) return;
						this.launches++;
						const launchStarted = performance.now();
						lastLaunch = launchStarted;
						await this.runtime.launch(directory, () => !this.closed, this.lifecycleSoundsDirectory);
						// First-use compilation has its own bounded budget, not the IPC budget.
						deadline += performance.now() - launchStarted;
						// Try the newly launched listener immediately; failures still back off below.
						lastLaunch = performance.now();
						continue;
					}
					const remaining = deadline - performance.now();
					if (!this.closed && remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
				}
			}
			if (!this.closed) throw new Error("桌面辅助进程在 10 秒内未接受连接");
		} catch (error) {
			this.discardStartupLease();
			if (!this.closed) this.notify(`桌面 Fairy 不可用：${String(error)}。请先 /fairy-anim off 再 /fairy-anim on 重试；检查 Swift/Xcode SDK：xcrun --show-sdk-path。`);
		} finally { this.pending = false; }
	}
}
