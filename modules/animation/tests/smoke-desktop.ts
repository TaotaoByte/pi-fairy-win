/** Opt-in macOS GUI smoke. Displays ONLY Fairy; no screen capture or permissions. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildHelper, connectLease } from "../src/desktop/client.ts";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const directory = await mkdtemp("/tmp/fairy-desktop-gui-");
const helper = await buildHelper();
const child = spawn(helper, [directory, fileURLToPath(new URL("../assets", import.meta.url)), "--size-gui-test"], { stdio: ["ignore", "inherit", "pipe"], env: { ...process.env, FAIRY_SETTINGS_DIRECTORY: directory + "/settings" } });
child.stderr.on("data", d => process.stderr.write(d));
let lease;
try {
	for (let i = 0; i < 100; i++) {
		try { lease = await connectLease(directory + "/sock"); break; } catch { await sleep(100); }
	}
	assert.ok(lease, "GUI helper greeting within 10s");
	lease.write("theme light\n"); await sleep(1000);
	lease.write("theme dark\n"); await sleep(1000);
	lease.write("theme auto\n"); await sleep(1000);
	lease.destroy(); await sleep(4000);
	assert.equal(child.exitCode, 0, "GUI helper exits after final disconnect");
	console.log("PASS: native GUI startup, light/dark/auto commands, disconnect and 3s exit grace. Visual/Spaces acceptance NOT asserted.");
} finally {
	lease?.destroy();
	if (child.exitCode === null) child.kill("SIGKILL");
	await sleep(100); await rm(directory, { recursive: true, force: true });
}
