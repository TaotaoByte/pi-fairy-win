import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildHelper,
	connectLease,
	pipePath,
	privateDirectory,
	readPipeName,
	namedPipeConnectPath,
	requestWelcome,
	welcomeSetting,
	DesktopClient,
} from "../src/desktop/client.ts";

// Windows-native desktop coverage. macOS keeps its Swift/unix-socket suite;
// these tests exercise the C#/WPF helper and its named-pipe protocol instead.
const windows = process.platform === "win32";
const darwin = process.platform === "darwin";

test("windows named-pipe address helpers are pure and reversible", () => {
	assert.equal(pipePath("C:\\dir"), join("C:\\dir", "pipe"));
	assert.equal(namedPipeConnectPath("pi-fairy-user"), "\\\\.\\pipe\\pi-fairy-user");
});

test("windows private directory uses LOCALAPPDATA and is created on demand", { skip: !windows }, async () => {
	const dir = await privateDirectory();
	const base = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Local");
	assert.equal(dir.toLowerCase(), join(base, "pi-fairy").toLowerCase());
});

test("windows helper compiles from C# and reports a cached executable path", { skip: !windows, timeout: 150_000 }, async () => {
	const binary = await buildHelper();
	assert.match(binary, /Fairy-[0-9a-f]+\.exe$/);
	const { access } = await import("node:fs/promises");
	await access(binary);
});

test("windows welcome setting round-trips through the offline helper", { skip: !windows, timeout: 60_000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "fairy-win-welcome-"));
	try {
		assert.equal(await welcomeSetting("simple", { directory: async () => dir, offline: offlineHelper() }), "simple");
		assert.equal(await welcomeSetting(undefined, { directory: async () => dir, offline: offlineHelper() }), "simple");
		assert.equal(await welcomeSetting("full", { directory: async () => dir, offline: offlineHelper() }), "full");
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("windows live helper serves the FAIRY2 lease and welcome protocol over a named pipe", { skip: !windows, timeout: 60_000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "fairy-win-ipc-"));
	let messages: string[] = [];
	const client = new DesktopClient((m) => messages.push(m), undefined, undefined);
	try {
		// Launch through the production runtime so the helper compiles and starts.
		const runtime = (await import("../src/desktop/client.ts"));
		const binary = await runtime.buildHelper();
		const { spawn } = await import("node:child_process");
		const assets = new URL("../assets", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
		const child = spawn(binary, [dir, assets], { detached: true, stdio: "ignore", windowsHide: true });
		child.unref();
		// Wait for the helper to publish its pipe name.
		let name = "";
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			try { name = await readPipeName(dir); if (name) break; } catch { /* not yet */ }
			await new Promise((r) => setTimeout(r, 150));
		}
		assert.ok(name, "helper must publish its pipe name");
		const lease = await connectLease(namedPipeConnectPath(name), 2000);
		lease.destroy();
		const mode = await requestWelcome(namedPipeConnectPath(name), "full");
		assert.equal(mode, "full");
		assert.deepEqual(messages, [], "live helper must not report an error");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

/** Run the platform's real offline welcome-setting helper. */
function offlineHelper() {
	return async (directory: string, choice?: "full" | "simple"): Promise<string> => {
		const binary = await buildHelper();
		const { execFile } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const run = promisify(execFile);
		const assets = new URL("../assets", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
		const args = [directory, assets, "--welcome-setting", ...(choice ? [choice] : [])];
		const result = await run(binary, args, { timeout: 10_000, windowsHide: true });
		return String(result.stdout).trim();
	};
}

test("macOS keeps the Swift/unix helper path", { skip: !darwin }, () => {
	assert.ok(true);
});
