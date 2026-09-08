import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import install from "../fairy.ts";

// Explicit opt-in: inspect installed code without importing the host entrypoint,
// loading user settings/plugins, making a request, or starting any real player.
const host = process.env.PI_VOICE_TEST_HOST;
function fixture(voiceFirst: boolean, cancel = false) {
	const source = readFileSync(join(host!, "dist/core/extensions/runner.js"), "utf8");
	const start = source.indexOf("    async emit(event) {");
	const end = source.indexOf("    async emitMessageEnd(event) {", start);
	assert.ok(start >= 0 && end > start, "review fixture against changed installed runner");
	const Runner = new Function(`return class { ${source.slice(start, end)} }`)();
	const runner = new Runner();
	const handlers = new Map<string, Function[]>();
	const started: string[] = [], aborted: string[] = [];
	const finishers: Array<() => void> = [];
	const ctx = { isIdle: () => true, getContextUsage: () => ({ percent: 0 }) };
	install({
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		events: { on: () => () => {} },
		registerCommand() {},
		exec(_command: string, args: string[], options: { signal: AbortSignal }) {
			const name = args[0].split("/").at(-1)!;
			started.push(name);
			return new Promise(resolve => {
				const finish = () => { options.signal.removeEventListener("abort", abort); resolve({ code: 0 }); };
				const abort = () => { aborted.push(name); finish(); };
				options.signal.addEventListener("abort", abort, { once: true });
				finishers.push(finish);
			});
		},
	} as any, { automaticLifecycleCues: false, fileExists: () => true });
	let release!: () => void, entered!: () => void;
	const remote = new Promise<void>(resolve => { release = resolve; });
	const inRemote = new Promise<void>(resolve => { entered = resolve; });
	// Installed codex-compaction index.ts session_before_compact awaits its
	// remote operation, then returns a custom result or cancel:true.
	const codex = { path: "codex-fixture", handlers: new Map([["session_before_compact", [async () => {
		entered(); await remote;
		return cancel ? { cancel: true } : { compaction: { summary: "fixture" } };
	}] ]]) };
	const fairy = { path: "fairy", handlers };
	runner.extensions = voiceFirst ? [fairy, codex] : [codex, fairy];
	runner.createContext = () => ctx;
	runner.isSessionBeforeEvent = (event: any) => event.type === "session_before_compact";
	runner.emitError = (error: unknown) => { throw error; };
	return { runner, started, aborted, release, inRemote,
		finishPlayers() { for (const finish of finishers) finish(); },
	};
}

for (const reason of ["manual", "threshold", "overflow"]) {
	test(`installed runner: ${reason} start is delivered before remote work only with Fairy first`, { skip: !host }, async () => {
		// A diagnostic red run uses the current broken settings order, without
		// editing settings. Normal regression exercises the required order.
		const h = fixture(process.env.PI_VOICE_TEST_ORDER !== "codex-first");
		const pending = h.runner.emit({ type: "session_before_compact", reason });
		await h.inRemote;
		try {
			assert.deepEqual(h.started, [reason === "manual" ? "compact-manual.wav" : "compact-auto.wav"]);
		} finally { h.release(); }
		assert.deepEqual(await pending, { compaction: { summary: "fixture" } }, "voice never overrides the result");
		h.finishPlayers(); await setImmediate();
		await h.runner.emit({ type: "session_compact", reason });
		assert.equal(h.started.at(-1), "compact-success.wav");
		h.finishPlayers(); await h.runner.emit({ type: "session_shutdown", reason: "reload" });
	});
}

test("installed runner: preceding remote handler delays start until success immediately preempts it", { skip: !host }, async () => {
	const h = fixture(false);
	const pending = h.runner.emit({ type: "session_before_compact", reason: "manual" });
	await h.inRemote;
	assert.deepEqual(h.started, []);
	h.release(); await pending;
	await h.runner.emit({ type: "session_compact", reason: "manual" });
	await setImmediate();
	assert.deepEqual(h.aborted, ["compact-manual.wav"]);
	assert.deepEqual(h.started, ["compact-manual.wav", "compact-success.wav"]);
	h.finishPlayers(); await h.runner.emit({ type: "session_shutdown", reason: "reload" });
});

for (const voiceFirst of [false, true]) {
	test(`installed runner: cancellation ${voiceFirst ? "after" : "before"} Fairy short-circuits; public failure event terminates cue`, { skip: !host }, async () => {
		const h = fixture(voiceFirst, true);
		const pending = h.runner.emit({ type: "session_before_compact", reason: "manual" });
		await h.inRemote;
		assert.deepEqual(h.started, voiceFirst ? ["compact-manual.wav"] : []);
		h.release(); assert.deepEqual(await pending, { cancel: true });
		// Manual host catch clears compaction state before this public event.
		await h.runner.emit({ type: "session_compact_failed", reason: "manual", aborted: true, willRetry: false });
		await setImmediate();
		assert.equal(h.started.at(-1), "compaction-failed.wav");
		assert.deepEqual(h.aborted, voiceFirst ? ["compact-manual.wav"] : []);
		h.finishPlayers(); await h.runner.emit({ type: "session_shutdown", reason: "reload" });
	});
}
