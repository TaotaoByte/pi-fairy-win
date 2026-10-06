import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import install, { classifyTerminalOutcome, isNetworkError } from "../fairy.ts";

function harness(options: Record<string, unknown> = {}) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => void>>();
	const bus = new Map<string, Set<(event: any) => void>>();
	const commands = new Map<string, any>();
	const plays: string[] = [];
	const aborted: string[] = [];
	let idle = false;
	let contextPercent = 0;
	const selectCalls: Array<{ title: string; options: readonly string[] }> = [];
	const uiSelect = options.uiSelect as
		| ((title: string, options: readonly string[], opts?: { signal?: AbortSignal }) => Promise<string | undefined>)
		| undefined;
	const ctx = {
		isIdle: () => idle,
		getContextUsage: () => ({ tokens: contextPercent, contextWindow: 100, percent: contextPercent }),
		hasUI: Boolean(options.hasUI),
		ui: {
			notify() {},
			async select(title: string, optionsList: string[], opts?: { signal?: AbortSignal }) {
				selectCalls.push({ title, options: optionsList });
				for (const handler of handlers.get("ui_prompt_start") ?? []) handler({ kind: "select" }, ctx);
				const result = uiSelect ? await uiSelect(title, optionsList, opts) : undefined;
				for (const handler of handlers.get("ui_prompt_end") ?? []) handler({ kind: "select" }, ctx);
				return result;
			},
		},
	};
	const pi = {
		on(name: string, handler: (event: any, context: any) => void) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		events: {
			on(name: string, handler: (event: any) => void) {
				const set = bus.get(name) ?? new Set();
				set.add(handler);
				bus.set(name, set);
				return () => set.delete(handler);
			},
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		async exec(command: string, args: string[], execOptions: { signal?: AbortSignal } = {}) {
			// macOS/iOS player is afplay; the Windows port plays through PowerShell's
			// SoundPlayer, with the wav path embedded in the -Command argument.
			const isPlayer = command === "afplay" || command === "powershell" || command === "paplay" || command === "aplay";
			if (isPlayer) {
				const raw = command === "powershell"
					? (args.find((a) => a.includes(".wav")) ?? "")
					: (args[0] ?? "");
				const cleaned = raw.replace(/['"]/g, "");
				const cut = cleaned.lastIndexOf(".wav");
				const tail = cut >= 0 ? cleaned.slice(0, cut) : cleaned;
				const name = tail.slice(Math.max(tail.lastIndexOf("/"), tail.lastIndexOf("\\")) + 1) + ".wav";
				const delay = options.execDelayMs;
				if (typeof delay === "number" && delay > 0) {
					await new Promise<void>((resolve, reject) => {
						const signal = execOptions.signal;
						const onDone = () => {
							signal?.removeEventListener("abort", onAbort);
							resolve();
						};
						const timer = setTimeout(onDone, delay);
						const onAbort = () => {
							clearTimeout(timer);
							aborted.push(name);
							reject(new Error("aborted"));
						};
						signal?.addEventListener("abort", onAbort, { once: true });
					});
				}
				plays.push(name);
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	install(pi as any, { fileExists: () => true, taskStartDelayMs: 0, random: () => 0, ...options });
	const emit = (name: string, event: any = {}) => {
		for (const handler of handlers.get(name) ?? []) handler(event, ctx);
	};
	const broadcast = (name: string, event: any) => {
		for (const handler of bus.get(name) ?? []) handler(event);
	};
	return {
		aborted,
		broadcast,
		commands,
		ctx,
		emit,
		plays,
		selectCalls,
		async flush() {
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		setContextPercent(value: number) {
			contextPercent = value;
		},
		setIdle(value: boolean) {
			idle = value;
		},
	};
}

test("classifies terminal outcomes with network errors taking precedence", () => {
	assert.equal(isNetworkError("fetch failed"), true);
	assert.equal(isNetworkError("ECONNRESET while connecting"), true);
	assert.equal(isNetworkError("invalid tool input"), false);
	assert.equal(classifyTerminalOutcome([{ role: "assistant", stopReason: "stop" }]), "success");
	assert.equal(
		classifyTerminalOutcome([{ role: "assistant", stopReason: "aborted", errorMessage: "fetch failed" }]),
		"network_error",
	);
	assert.equal(classifyTerminalOutcome([{ role: "assistant", stopReason: "error" }]), "error");
	assert.equal(classifyTerminalOutcome([{ role: "assistant", stopReason: "aborted" }]), "aborted");
});

test("plays exactly one final sound for each settled task", async () => {
	const h = harness();
	h.emit("session_start");
	h.emit("before_agent_start");
	h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
	h.emit("agent_settled");
	await h.flush();
	assert.deepEqual(h.plays, ["task-start-1.wav", "success-1.wav"]);

	h.emit("before_agent_start");
	h.emit("agent_end", {
		messages: [{ role: "assistant", stopReason: "aborted", errorMessage: "fetch failed" }],
	});
	h.emit("agent_settled");
	await h.flush();
	assert.deepEqual(h.plays, [
		"task-start-1.wav",
		"success-1.wav",
		"task-start-2.wav",
		"network-error.wav",
	]);
});

test("does not report a recovered intermediate network failure as final failure", async () => {
	const h = harness({ retryNoticeDelayMs: 50 });
	h.emit("session_start");
	h.emit("before_agent_start");
	h.emit("agent_end", {
		messages: [{ role: "assistant", stopReason: "error", errorMessage: "fetch failed" }],
	});
	h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
	h.emit("agent_settled");
	await h.flush();
	assert.deepEqual(h.plays, ["task-start-1.wav", "success-1.wav"]);
});

test("announces each accepted prompt when its agent task starts", async () => {
	const h = harness();
	h.emit("session_start");
	h.emit("before_agent_start");
	h.emit("before_agent_start");
	await h.flush();
		// default random()=0 picks the first variant, but the no-repeat logic
		// advances to the next pool entry for a consecutive play
		assert.deepEqual(h.plays, ["task-start-1.wav", "task-start-2.wav"]);
});

test("announces manual model changes but not restored startup models", async () => {
	const h = harness({ random: () => 0 });
	h.emit("session_start", { reason: "startup" });
	h.emit("model_select", { source: "restore" });
	await h.flush(); // let the startup welcome finish
	h.emit("model_select", { source: "set" });
	h.emit("model_select", { source: "cycle" });
	await h.flush();
	assert.deepEqual(h.plays, ["welcome-1.wav", "model-switch.wav", "model-switch.wav"]);
});

test("welcomes process startup and announces session changes otherwise", async () => {
	for (const [reason, expected] of [
		["startup", ["welcome-1.wav"]],
		["reload", []],
		["fork", []],
		["resume", ["session-switch.wav"]],
		["new", ["new-session.wav"]],
	] as const) {
		const h = harness({ random: () => 0 });
		h.emit("session_start", { reason });
		await h.flush();
		assert.deepEqual(h.plays, expected, reason);
	}
});

test("says goodbye only when the process quits", async () => {
	for (const reason of ["reload", "new", "resume", "fork"]) {
		const h = harness();
		h.emit("session_start");
		h.emit("session_shutdown", { reason });
		await h.flush();
		assert.deepEqual(h.plays, [], reason);
	}
	const h = harness({ random: () => 0 });
	h.emit("session_start", { reason: "startup" });
	h.emit("session_shutdown", { reason: "quit" });
	assert.deepEqual(h.plays, ["welcome-1.wav", "goodbye-1.wav"]);
});

test("picks a goodbye variant at random without repeating the previous one", async () => {
	const h = harness({ random: () => 0.9 });
	h.emit("session_start");
	h.emit("session_shutdown", { reason: "quit" });
	h.emit("session_shutdown", { reason: "quit" });
	await h.flush();
	assert.deepEqual(h.plays, ["goodbye-6.wav", "goodbye-1.wav"]);
});

test("falls back to the remaining goodbye variants when files are missing", async () => {
	const h = harness({
		random: () => 0,
		fileExists: (path: string) => !path.endsWith("goodbye-1.wav"),
	});
	h.emit("session_start");
	h.emit("session_shutdown", { reason: "quit" });
	await h.flush();
	assert.deepEqual(h.plays, ["goodbye-2.wav"]);
});

test("plays a random stretch reminder each interval without repeating", async () => {
	const h = harness({ activityIntervalMs: 15, random: () => 0.9 });
	h.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 90));
	assert.deepEqual(h.plays.slice(0, 2), ["activity-3.wav", "activity-1.wav"]);
});

test("cancels the stretch timer on session shutdown", async () => {
	const h = harness({ activityIntervalMs: 15 });
	h.emit("session_start");
	h.emit("session_shutdown", { reason: "new" });
	await new Promise((resolve) => setTimeout(resolve, 45));
	assert.deepEqual(h.plays, []);
});

test("asks in a dialog on each fire and closes the round on yes", async () => {
	const h = harness({
		hasUI: true,
		activityIntervalMs: 20,
		random: () => 0,
		uiSelect: async () => "好，去活动一下。",
	});
	h.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 55));
	assert.equal(h.selectCalls.length >= 2, true);
	assert.equal(h.selectCalls[0]?.title, "主人，该起来活动一下了。");
	assert.deepEqual(h.selectCalls[0]?.options, ["好，去活动一下。", "再工作一会儿。"]);
	assert.deepEqual(h.plays.slice(0, 2), ["activity-1.wav", "activity-2.wav"]);
});

test("re-arms five minutes later after the work-again choice", async () => {
	const answers = ["再工作一会儿。", "好，去活动一下。"];
	const h = harness({
		hasUI: true,
		activityIntervalMs: 40,
		activityNudgeMs: 8,
		random: () => 0,
		uiSelect: async () => answers.shift(),
	});
	h.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(h.selectCalls.length, 2); // nudge fired well before the next hour
	assert.equal(h.plays.length, 2); // one clip per round
});

test("esc or an unanswered timeout skips the round until the next interval", async () => {
	const h = harness({
		hasUI: true,
		activityIntervalMs: 20,
		random: () => 0,
		uiSelect: async () => undefined,
	});
	h.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 55));
	assert.equal(h.selectCalls.length >= 2, true); // each fire still asks
	assert.deepEqual(h.plays.slice(0, 2), ["activity-1.wav", "activity-2.wav"]);
});

test("a permission prompt displacing the dialog defers and retries it", async () => {
	let calls = 0;
	const h = harness({
		hasUI: true,
		activityIntervalMs: 15,
		activityRetryBufferMs: 5,
		activityDialogTimeoutMs: 500,
		random: () => 0,
		uiSelect: (_title, _options, opts) =>
			new Promise((resolve) => {
				calls += 1;
				if (calls === 1) {
					opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
					return;
				}
				// second attempt stays open so no third fire happens during the test
			}),
	});
	h.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 30)); // first fire opened the dialog
	h.broadcast("permissions:ui_prompt", { requestId: "p1" }); // displaces it
	h.broadcast("permissions:decision", { requestId: "p1", resolution: "user_approved" });
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(calls, 2); // first attempt was displaced, second one succeeded
	const activityPlays = h.plays.filter((name) => name.startsWith("activity-"));
	assert.equal(activityPlays.length, 1); // deferred retry does not re-play the voice
});

test("waits for an open permission prompt before showing its dialog", async () => {
	let calls = 0;
	const h = harness({
		hasUI: true,
		activityIntervalMs: 15,
		activityRetryBufferMs: 5,
		activityDialogTimeoutMs: 300,
		uiSelect: () =>
			new Promise((resolve) => {
				calls += 1;
				// stays open once it finally shows
			}),
	});
	h.emit("session_start");
	h.broadcast("permissions:ui_prompt", { requestId: "p2" }); // busy before the fire
	await new Promise((resolve) => setTimeout(resolve, 25)); // fire passes while busy
	assert.equal(calls, 0); // not asked while a permission prompt is open
	h.broadcast("permissions:decision", { requestId: "p2", resolution: "user_approved" });
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(calls, 1); // asked only after the permission closed
});

test("/fairy-voice test activity runs one round without touching the live schedule", async () => {
	const answers = ["好，去活动一下。"];
	const h = harness({
		hasUI: true,
		activityIntervalMs: 25,
		random: () => 0,
		uiSelect: async () => answers.shift(),
	});
	h.emit("session_start"); // arms the real hourly timer at 25ms
	const cmd = h.commands.get("fairy-voice") as { handler: (args: string, ctx: any) => Promise<void> };
	await cmd.handler("test activity", h.ctx);
	assert.equal(h.plays.length, 1); // manual voice played immediately
	assert.equal(h.selectCalls.length, 1); // manual dialog asked once
	assert.equal(h.selectCalls[0]?.options.length, 2);
	assert.equal(h.plays.some((name) => name === "input.wav"), false); // own dialog must not self-trigger the input clip
	await new Promise((resolve) => setTimeout(resolve, 45)); // real fire still on schedule
	assert.equal(h.plays.length, 2); // the live hourly reminder was not rescheduled away
});

test("picks a welcome variant at random without repeating the previous one", async () => {
	const h = harness({ random: () => 0.9 });
	h.emit("session_start", { reason: "startup" });
	h.emit("session_start", { reason: "startup" });
	await h.flush();
	assert.deepEqual(h.plays, ["welcome-7.wav", "welcome-1.wav"]);
});

test("falls back to the remaining welcome variants when files are missing", async () => {
	const h = harness({
		random: () => 0,
		fileExists: (path: string) => !path.endsWith("welcome-1.wav"),
	});
	h.emit("session_start", { reason: "startup" });
	await h.flush();
	assert.deepEqual(h.plays, ["welcome-2.wav"]);
});

test("a fast completion replaces a delayed task-start notice", async () => {
	const h = harness({ taskStartDelayMs: 10 });
	h.emit("session_start");
	h.emit("before_agent_start");
	h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
	h.emit("agent_settled");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(h.plays, ["success-1.wav"]);
});

test("announces a long unsettled network retry only once", async () => {
	const h = harness({ retryNoticeDelayMs: 1 });
	h.emit("session_start");
	h.emit("before_agent_start");
	h.emit("agent_end", {
		messages: [{ role: "assistant", stopReason: "error", errorMessage: "fetch failed" }],
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	h.emit("agent_end", {
		messages: [{ role: "assistant", stopReason: "error", errorMessage: "fetch failed" }],
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(h.plays, ["task-start-1.wav", "retry.wav"]);
});

test("coalesces concurrent permission asks and suppresses the matching generic prompt", async () => {
	const h = harness({ permissionGroupGapMs: 0 });
	h.emit("session_start");
	h.broadcast("permissions:ui_prompt", { requestId: "one" });
	h.broadcast("permissions:ui_prompt", { requestId: "two" });
	h.emit("ui_prompt_start");
	assert.deepEqual(h.plays, ["permission-1.wav"]);

	h.broadcast("permissions:decision", { requestId: "one" });
	h.broadcast("permissions:decision", { requestId: "two" });
	h.emit("ui_prompt_start");
	await h.flush();
	assert.deepEqual(h.plays, ["permission-1.wav", "input.wav"]);
});

test("human permission decisions interrupt the prompt with distinct feedback", async () => {
	for (const [resolution, expected] of [
		["user_approved", "permission-approved.wav"],
		["user_approved_for_session", "permission-approved.wav"],
		["user_denied", "permission-denied.wav"],
	] as const) {
		const h = harness({ execDelayMs: 40 });
		h.emit("session_start");
		h.broadcast("permissions:ui_prompt", { requestId: "one" });
		h.broadcast("permissions:decision", { requestId: "one", resolution });
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.deepEqual(h.aborted, ["permission-1.wav"], resolution);
		assert.deepEqual(h.plays, [expected], resolution);
	}
});

test("non-human prompt termination stops speech without decision feedback", async () => {
	const h = harness({ execDelayMs: 40 });
	h.emit("session_start");
	h.broadcast("permissions:ui_prompt", { requestId: "one" });
	h.broadcast("permissions:decision", { requestId: "one", resolution: "gate_error" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(h.aborted, ["permission-1.wav"]);
	assert.deepEqual(h.plays, []);
});

test("warns once per context threshold crossing", async () => {
	const h = harness();
	h.emit("session_start");
	h.setContextPercent(79);
	h.emit("turn_end");
	h.setContextPercent(80);
	h.emit("turn_end");
	h.setContextPercent(90);
	h.emit("turn_end");
	h.setContextPercent(20);
	h.emit("session_compact");
	await h.flush();
	h.setContextPercent(81);
	h.emit("turn_end");
	await h.flush();
	assert.deepEqual(h.plays, [
		"context-warning.wav",
		"compact-success.wav",
		"context-warning.wav",
	]);
});

test("warns once when one or more percentage quotas cross the low threshold", () => {
	const h = harness();
	h.emit("session_start");
	const report = {
		providerId: "openai-codex",
		buckets: [
			{ label: "5h", unit: "percent", remaining: 9, resetsAt: 100 },
			{ label: "week", unit: "percent", remaining: 8, resetsAt: 200 },
		],
	};
	h.broadcast("usage:report", report);
	h.broadcast("usage:report", report);
	assert.deepEqual(h.plays, ["quota-warning.wav"]);
});

test("plays standalone compaction failures but not failures that will retry", () => {
	const h = harness();
	h.emit("session_start");
	h.setIdle(true);
	h.emit("session_compact_failed", { willRetry: false });
	h.emit("session_compact_failed", { willRetry: true });
	assert.deepEqual(h.plays, ["compaction-failed.wav"]);
});

test("keeps only the newest equal-priority compaction notice", async () => {
	const h = harness();
	h.emit("session_start");
	h.emit("session_before_compact", { reason: "manual" });
	assert.deepEqual(h.plays, ["compact-manual.wav"]);
	h.emit("session_before_compact", { reason: "threshold" });
	h.emit("session_before_compact", { reason: "overflow" });
	await h.flush();
	assert.deepEqual(h.plays, ["compact-manual.wav", "compact-auto.wav"]);
});

test("announces successful compaction right away", () => {
	const h = harness();
	h.emit("session_start");
	h.emit("session_compact", {});
	assert.deepEqual(h.plays, ["compact-success.wav"]);
});

test("plays in-progress then success clips for a compaction", async () => {
	const h = harness();
	h.emit("session_start");
	h.emit("session_before_compact", { reason: "manual" });
	h.emit("session_compact", {});
	await h.flush();
	assert.deepEqual(h.plays, ["compact-manual.wav", "compact-success.wav"]);
});

test("higher-priority clips interrupt active lower-priority playback", async () => {
	const h = harness({ execDelayMs: 40 });
	h.emit("session_start");
	h.setContextPercent(79);
	h.emit("turn_end");
	h.setContextPercent(80);
	h.emit("turn_end");
	h.broadcast("permissions:ui_prompt", { requestId: "one" });
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.deepEqual(h.aborted, ["context-warning.wav"]);
	assert.deepEqual(h.plays, ["permission-1.wav"]);
});

test("lower-priority clips are dropped while a higher-priority clip is active", async () => {
	const h = harness({ execDelayMs: 40 });
	h.emit("session_start");
	h.broadcast("permissions:ui_prompt", { requestId: "one" });
	h.broadcast("usage:report", {
		providerId: "openai-codex",
		buckets: [{ label: "5h", unit: "percent", remaining: 9, resetsAt: 100 }],
	});
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(h.aborted, []);
	assert.deepEqual(h.plays, ["permission-1.wav"]);
});

test("/fairy-voice off mutes every clip; on restores; a fresh process starts unmuted", async () => {
	const h = harness();
	h.emit("session_start");
	h.emit("before_agent_start");
	await h.flush();
	assert.deepEqual(h.plays, ["task-start-1.wav"]); // default: unmuted

	const cmd = h.commands.get("fairy-voice") as { handler: (args: string, ctx: any) => Promise<void> };
	await cmd.handler("off", h.ctx);
	// the off confirmation itself always plays (bypasses mute)
	assert.deepEqual(h.plays, ["task-start-1.wav", "voice-off.wav"]);
	h.emit("before_agent_start"); // accepted prompt: no task-start clip
	h.emit("session_start", { reason: "startup" }); // no welcome
	await h.flush();
	assert.deepEqual(h.plays, ["task-start-1.wav", "voice-off.wav"]);

	await cmd.handler("on", h.ctx);
	await h.flush(); // let the confirmation clip's teardown settle
	assert.deepEqual(h.plays, ["task-start-1.wav", "voice-off.wav", "voice-on.wav"]);
	h.emit("before_agent_start");
	await h.flush();
	// no-repeat logic advances to the next pool entry
	assert.deepEqual(h.plays, ["task-start-1.wav", "voice-off.wav", "voice-on.wav", "task-start-2.wav"]);
});

test("/fairy-voice off aborts the clip currently playing, then plays its confirmation", async () => {
	const h = harness({ execDelayMs: 40 });
	h.emit("session_start");
	h.emit("before_agent_start");
	await new Promise((resolve) => setTimeout(resolve, 5)); // playback in flight
	const cmd = h.commands.get("fairy-voice") as { handler: (args: string, ctx: any) => Promise<void> };
	await cmd.handler("off", h.ctx);
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.deepEqual(h.aborted, ["task-start-1.wav"]);
	assert.deepEqual(h.plays, ["voice-off.wav"]); // interrupted clip never completes; confirmation follows
});

test("muted /fairy-voice test activity plays nothing and opens no dialog", async () => {
	const h = harness({ hasUI: true });
	const cmd = h.commands.get("fairy-voice") as { handler: (args: string, ctx: any) => Promise<void> };
	await cmd.handler("off", h.ctx);
	await cmd.handler("test activity", h.ctx);
	assert.deepEqual(h.selectCalls, []);
	assert.deepEqual(h.plays, ["voice-off.wav"]); // only the off confirmation played
	await cmd.handler("on", h.ctx);
	await h.flush(); // let the confirmation clip's teardown settle
	await cmd.handler("test activity", h.ctx);
	await h.flush();
	assert.equal(h.selectCalls.length, 1);
	assert.deepEqual(h.plays, ["voice-off.wav", "voice-on.wav", "activity-1.wav"]);
});


test("automaticLifecycleCues false keeps session sounds, explicit tests and shutdown cleanup", async () => {
 const h = harness({ automaticLifecycleCues: false, activityIntervalMs: 30_000, taskStartDelayMs: 20 });
 h.emit("session_start", { reason: "startup" });
 await h.flush(); assert.deepEqual(h.plays, []);
 for (const [reason, sound] of [["resume", "session-switch.wav"], ["new", "new-session.wav"]]) {
  h.emit("session_start", { reason }); await h.flush(); assert.equal(h.plays.at(-1), sound);
 }
 for (const sound of ["welcome", "goodbye"]) {
  await h.commands.get("fairy-voice").handler(`test ${sound}`, h.ctx);
  await h.flush(); assert.match(h.plays.at(-1)!, new RegExp(`^${sound}-`));
 }
 h.emit("before_agent_start"); // pending playback must be cancelled on quit too
 const before = h.plays.length;
 h.emit("session_shutdown", { reason: "quit" });
 h.broadcast("permissions:ui_prompt", { requestId: "after-shutdown" });
 h.broadcast("usage:report", { buckets: [{ unit: "percent", remaining: 0 }] });
 await new Promise(r => setTimeout(r, 60));
 assert.equal(h.plays.length, before, "no farewell, delayed playback, reminder or bus callback after cleanup");
});

test("delegated lifecycle still aborts active playback and preserves per-Pi mute", async () => {
 const h = harness({ automaticLifecycleCues: false, execDelayMs: 40 });
 h.emit("session_start", { reason: "startup" });
 h.emit("before_agent_start");
 h.emit("session_shutdown", { reason: "quit" });
 await new Promise(r => setTimeout(r, 60));
 assert.deepEqual(h.aborted, ["task-start-1.wav"]); assert.deepEqual(h.plays, []);
 const muted = harness({ automaticLifecycleCues: false });
 await muted.commands.get("fairy-voice").handler("off", muted.ctx); await muted.flush();
 muted.emit("before_agent_start");
 await muted.commands.get("fairy-voice").handler("test welcome", muted.ctx);
 assert.deepEqual(muted.plays, ["voice-off.wav"]);
 muted.emit("session_shutdown", { reason: "quit" });
});

test("variant non-repeat is per category even across intervening notices", async () => {
 const h = harness();
 for (const sound of ["success", "task_start", "success", "permission", "task_start", "permission"]) {
  await h.commands.get("fairy-voice").handler(`test ${sound}`, h.ctx);
  await h.flush();
 }
 assert.deepEqual(h.plays, ["success-1.wav", "task-start-1.wav", "success-2.wav", "permission-1.wav", "task-start-2.wav", "permission-2.wav"]);
});

test("recovered agent_end clears retry notice while queued continuation is still busy", async () => {
 const h = harness({ retryNoticeDelayMs: 10 });
 h.emit("before_agent_start");
 h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error", errorMessage: "fetch failed" }] });
 h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
 await new Promise(r => setTimeout(r, 25));
 assert.equal(h.plays.includes("retry.wav"), false);
 h.emit("session_shutdown", { reason: "reload" });
});

test("muting an open activity dialog rearms the next hourly round", async (t) => {
 t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
 const h = harness({ hasUI: true, activityIntervalMs: 100, uiSelect: (_title, _options, opts) => new Promise(resolve => {
  opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
 }) });
 h.emit("session_start");
 t.mock.timers.tick(100);
 assert.equal(h.selectCalls.length, 1);
 await h.commands.get("fairy-voice").handler("off", h.ctx);
 await Promise.resolve(); await Promise.resolve();
 await h.commands.get("fairy-voice").handler("on", h.ctx);
 t.mock.timers.tick(99);
 assert.equal(h.selectCalls.length, 1);
 t.mock.timers.tick(1);
 assert.equal(h.selectCalls.length, 2);
 h.emit("session_shutdown", { reason: "reload" });
});

test("integrated process mute survives factory recreation, but defaults and fresh process state do not inherit it", async () => {
 const key = Symbol.for("pi-fairy.voice.process-mute");
 const globals = globalThis as any;
 const previous = globals[key];
 delete globals[key];
 try {
  const old = harness({ processMute: true, automaticLifecycleCues: false });
  await old.commands.get("fairy-voice").handler("off", old.ctx);
  old.emit("session_shutdown", { reason: "reload" });
  const next = harness({ processMute: true, automaticLifecycleCues: false });
  next.emit("session_start", { reason: "reload" });
  next.emit("before_agent_start");
  await next.flush();
  assert.deepEqual(next.plays, []);
  // A stale old command cannot change the replacement instance's state.
  await old.commands.get("fairy-voice").handler("on", old.ctx);
  next.emit("before_agent_start"); await next.flush();
  assert.deepEqual(next.plays, []);
  const standaloneMode = harness();
  standaloneMode.emit("before_agent_start"); await standaloneMode.flush();
  assert.deepEqual(standaloneMode.plays, ["task-start-1.wav"]);
  await next.commands.get("fairy-voice").handler("on", next.ctx); await next.flush();
  next.emit("before_agent_start"); await next.flush();
  assert.deepEqual(next.plays, ["voice-on.wav", "task-start-1.wav"]);
  next.emit("session_shutdown", { reason: "reload" });
  delete globals[key]; // isolated fresh-process global state
  const fresh = harness({ processMute: true, automaticLifecycleCues: false });
  fresh.emit("before_agent_start"); await fresh.flush();
  assert.deepEqual(fresh.plays, ["task-start-1.wav"]);
  fresh.emit("session_shutdown", { reason: "reload" });
 } finally {
  if (previous === undefined) delete globals[key]; else globals[key] = previous;
 }
});

test("integrated mute gates all public voice event categories while bookkeeping stays active", async () => {
 const h = harness({ processMute: false, automaticLifecycleCues: false });
 h.emit("session_start", { reason: "startup" });
 await h.commands.get("fairy-voice").handler("off", h.ctx); await h.flush();
 for (const reason of ["resume", "new", "reload", "fork"]) h.emit("session_start", { reason });
 h.emit("model_select", { source: "set" });
 h.emit("before_agent_start");
 for (const stopReason of ["stop", "error", "aborted"]) {
  h.emit("agent_end", { messages: [{ role: "assistant", stopReason }] }); h.emit("agent_settled");
 }
 h.emit("ui_prompt_start"); h.emit("ui_prompt_end");
 h.broadcast("permissions:ui_prompt", { requestId: "muted" });
 h.broadcast("permissions:decision", { requestId: "muted", resolution: "user_denied" });
 h.setContextPercent(81); h.emit("turn_end");
 h.broadcast("usage:report", { buckets: [{ unit: "percent", remaining: 1 }] });
 for (const reason of ["manual", "threshold", "overflow"]) h.emit("session_before_compact", { reason });
 h.emit("session_compact"); h.setIdle(true); h.emit("session_compact_failed", { willRetry: false });
 await h.flush(); assert.deepEqual(h.plays, ["voice-off.wav"]);
 await h.commands.get("fairy-voice").handler("on", h.ctx); await h.flush();
 h.emit("ui_prompt_start"); await h.flush();
 assert.equal(h.plays.at(-1), "input.wav", "muted permission was still resolved");
 h.emit("session_shutdown", { reason: "quit" });
});

test("a genuinely fresh Node process starts integrated voice unmuted with only a mock player", () => {
 const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
  import assert from 'node:assert/strict';
  import install from ${JSON.stringify(new URL("../fairy.ts", import.meta.url).href)};
  assert.equal(globalThis[Symbol.for('pi-fairy.voice.process-mute')], undefined);
  const handlers = new Map(); let plays = 0;
  install({ on: (name, handler) => handlers.set(name, handler),
   events: { on: () => () => {} }, registerCommand() {},
   exec: async () => { plays++; return { code: 0 }; }
  }, { processMute: true, automaticLifecycleCues: false, fileExists: () => true, taskStartDelayMs: 0 });
  handlers.get('before_agent_start')();
  assert.equal(plays, process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32' ? 1 : 0);
  handlers.get('session_shutdown')({ reason: 'reload' });
 `], { encoding: "utf8", timeout: 5000 });
 assert.equal(child.status, 0, child.stderr);
});

test("activityReminders false suppresses automatic and manual legacy rounds only", async (t) => {
 t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
 const h = harness({ activityReminders: false, hasUI: true });
 const notes: string[] = []; h.ctx.ui.notify = (text?: string) => { notes.push(text ?? ""); };
 h.emit("session_start", { reason: "reload" });
 t.mock.timers.tick(8 * 3600_000);
 assert.deepEqual(h.plays, []); assert.deepEqual(h.selectCalls, []);
 for (const arg of ["activity", "activity_reminder"]) await h.commands.get("fairy-voice").handler("test " + arg, h.ctx);
 assert.deepEqual(h.plays, []); assert.deepEqual(h.selectCalls, []);
 assert.ok(notes.every(note => note.includes("共享桌面")));
 h.emit("session_before_compact", { reason: "manual" });
 assert.deepEqual(h.plays, ["compact-manual.wav"]);
 h.emit("session_shutdown", { reason: "reload" });
});

test("fairy-voice help covers commands and sounds without playback, mute or reminder side effects", async () => {
	let fileChecks = 0;
	const h = harness({ hasUI: true, automaticLifecycleCues: false, activityReminders: false,
		fileExists: () => { fileChecks++; return true; } });
	const messages: string[] = [];
	h.ctx.ui.notify = (text?: string) => { messages.push(text!); };
	const command = h.commands.get("fairy-voice");
	assert.deepEqual(command.getArgumentCompletions("help"), [{ label: "help", value: "help", description: "显示帮助" }]);
	for (const muted of [false, true]) {
		if (muted) { await command.handler("off", h.ctx); await h.flush(); }
		await command.handler("status", h.ctx);
		const status = messages.at(-1);
		const before = { plays: [...h.plays], aborted: [...h.aborted], fileChecks, dialogs: [...h.selectCalls] };
		await command.handler(" help ", h.ctx);
		const help = messages.at(-1)!;
		for (const name of ["help", "list", "status", "off", "on", "test <sound>", "test activity", "test activity_reminder"]) {
			assert.ok(help.includes(`/fairy-voice ${name}`), name);
		}
		await command.handler("", h.ctx);
		const bare = messages.at(-1)!;
		await command.handler("list", h.ctx);
		assert.equal(messages.at(-1), bare, "bare command remains list");
		for (const sound of bare.replace("可试听的声音：", "").split("、")) assert.ok(help.includes(sound), sound);
		for (const meaning of ["共享桌面", "不重播", "不改计时", "不受本 Pi 静音控制", "静音不写入磁盘", "退出进程后恢复", "大小写敏感"]) assert.ok(help.includes(meaning), meaning);
		await command.handler("status", h.ctx);
		assert.equal(messages.at(-1), status);
		await h.flush();
		assert.deepEqual({ plays: h.plays, aborted: h.aborted, fileChecks, dialogs: h.selectCalls }, before);
	}
	h.emit("session_shutdown");
});


test("fairy-voice command descriptions, completions and exact final feedback are Chinese", async () => {
 const h = harness({ hasUI: true, automaticLifecycleCues: false, activityReminders: false });
 const command = h.commands.get("fairy-voice"), notes: [string, string][] = [];
 h.ctx.ui.notify = ((text: string, kind: string) => { notes.push([text, kind]); }) as any;
 assert.equal(command.description, "列出或试听 Fairy 语音；本 Pi 静音不影响共享桌面欢迎、告别与休息提醒");
 for (const item of command.getArgumentCompletions("")) assert.match(item.description, /[\u4e00-\u9fff]/);
 await command.handler("unknown", h.ctx);
 assert.deepEqual(notes.at(-1), ["用法：/fairy-voice list 列出声音；/fairy-voice test <sound> 试听；/fairy-voice test activity 查看活动提醒", "warning"]);
 await command.handler("test activity", h.ctx);
 assert.deepEqual(notes.at(-1), ["休息提醒由共享桌面 Fairy 统一管理；此命令不重播、不弹出 Pi 对话框。桌面未连接时不提醒。", "info"]);
 await command.handler("off", h.ctx); await h.flush();
 await command.handler("test welcome", h.ctx);
 assert.deepEqual(notes.at(-1), ["已静音：welcome 未播放。", "warning"]);
 await command.handler("on", h.ctx); await h.flush();
 assert.deepEqual(notes.at(-1), ["Fairy语音已恢复。", "info"]);
 h.emit("session_shutdown");
});
