import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FairySound =
	| "welcome"
	| "goodbye"
	| "activity_reminder"
	| "task_start"
	| "model_switch"
	| "session_switch"
	| "new_session"
	| "permission"
	| "permission_approved"
	| "permission_denied"
	| "input"
	| "success"
	| "network_error"
	| "error"
	| "aborted"
	| "retry"
	| "context_warning"
	| "compaction_failed"
	| "quota_warning"
	| "compact_auto"
	| "compact_manual"
	| "compact_success"
	| "voice_off"
	| "voice_on";

type TerminalOutcome = "success" | "network_error" | "error" | "aborted";
type PlaybackPriority = 1 | 2 | 3;

type PlaybackJob = {
	sound: FairySound;
	path: string;
	priority: PlaybackPriority;
};

type AssistantLike = {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
};

type FairyOptions = {
	/** Integrated composition delegates automatic and manual activity rounds to desktop. */
	activityReminders?: boolean;
	/** Root composition delegates only automatic welcome/quit cues to the desktop owner. */
	automaticLifecycleCues?: boolean;
	/** Integrated-only in-memory mute survives Pi's extension factory replacement. */
	processMute?: boolean;
	taskStartDelayMs?: number;
	retryNoticeDelayMs?: number;
	permissionGroupGapMs?: number;
	activityIntervalMs?: number;
	activityNudgeMs?: number;
	activityDialogTimeoutMs?: number;
	activityRetryBufferMs?: number;
	fileExists?: (path: string) => boolean;
	random?: () => number;
};

const SOUND_FILES: Record<FairySound, string> = {
	welcome: "welcome-1.wav",
	goodbye: "goodbye-1.wav",
	task_start: "task-start-1.wav",
	model_switch: "model-switch.wav",
	session_switch: "session-switch.wav",
	new_session: "new-session.wav",
	permission: "permission-1.wav",
	permission_approved: "permission-approved.wav",
	permission_denied: "permission-denied.wav",
	input: "input.wav",
	success: "success-1.wav",
	network_error: "network-error.wav",
	error: "error.wav",
	aborted: "aborted.wav",
	retry: "retry.wav",
	context_warning: "context-warning.wav",
	compaction_failed: "compaction-failed.wav",
	quota_warning: "quota-warning.wav",
	compact_auto: "compact-auto.wav",
	compact_manual: "compact-manual.wav",
	compact_success: "compact-success.wav",
	voice_off: "voice-off.wav",
	voice_on: "voice-on.wav",
	activity_reminder: "activity-1.wav",
};

// Interchangeable recordings: avoid the previous choice in this category
// within the current factory lifetime (no cross-process random state).
const SOUND_VARIANTS: Partial<Record<FairySound, readonly string[]>> = {
	success: ["success-1.wav", "success-2.wav", "success-3.wav"],
	task_start: ["task-start-1.wav", "task-start-2.wav", "task-start-3.wav", "task-start-4.wav"],
	permission: ["permission-1.wav", "permission-2.wav", "permission-3.wav"],
	activity_reminder: ["activity-1.wav", "activity-2.wav", "activity-3.wav"],
	goodbye: [
		"goodbye-1.wav",
		"goodbye-2.wav",
		"goodbye-3.wav",
		"goodbye-4.wav",
		"goodbye-5.wav",
		"goodbye-6.wav",
	],
	welcome: [
		"welcome-1.wav",
		"welcome-2.wav",
		"welcome-3.wav",
		"welcome-4.wav",
		"welcome-5.wav",
		"welcome-6.wav",
		"welcome-7.wav",
	],
};

const SOUND_PRIORITIES: Record<FairySound, PlaybackPriority> = {
	welcome: 2,
	goodbye: 2,
	task_start: 2,
	model_switch: 1,
	session_switch: 1,
	new_session: 1,
	permission: 3,
	permission_approved: 3,
	permission_denied: 3,
	input: 3,
	success: 2,
	network_error: 3,
	error: 3,
	aborted: 3,
	retry: 2,
	context_warning: 1,
	compaction_failed: 3,
	quota_warning: 1,
	compact_auto: 2,
	compact_manual: 2,
	compact_success: 2,
	voice_off: 3,
	voice_on: 3,
	activity_reminder: 1,
};

const NETWORK_ERROR_PATTERN =
	/\b(?:fetch failed|timed?\s*out|timeout|network|connection|socket|econn\w*|enotfound|eai_again|rate[ -]?limit|http\s*5\d\d)\b/i;
const CONTEXT_WARNING_PERCENT = 80;
const QUOTA_WARNING_PERCENT = 10;
const DEFAULT_TASK_START_DELAY_MS = 500;
const DEFAULT_ACTIVITY_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ACTIVITY_NUDGE_MS = 5 * 60 * 1000;
const DEFAULT_ACTIVITY_DIALOG_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ACTIVITY_RETRY_BUFFER_MS = 5_000;
const ACTIVITY_DIALOG_TITLE = "主人，该起来活动一下了。";
const ACTIVITY_OPTION_GO = "好，去活动一下。";
const ACTIVITY_OPTION_WORK = "再工作一会儿。";
const DEFAULT_RETRY_NOTICE_DELAY_MS = 5_000;
const DEFAULT_PERMISSION_GROUP_GAP_MS = 1_500;
const PROCESS_MUTE_KEY = Symbol.for("pi-fairy.voice.process-mute");
type MuteState = { muted: boolean };

export function isNetworkError(message: string | undefined): boolean {
	return Boolean(message && NETWORK_ERROR_PATTERN.test(message));
}

export function classifyTerminalOutcome(messages: readonly AssistantLike[]): TerminalOutcome {
	const assistant = [...messages].reverse().find((message) => message.role === "assistant");
	if (!assistant) return "success";
	if (isNetworkError(assistant.errorMessage)) return "network_error";
	if (assistant.stopReason === "error") return "error";
	if (assistant.stopReason === "aborted") return "aborted";
	return "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === "string" ? field : undefined;
}

function soundPath(sound: FairySound, fileName?: string): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "sounds", fileName ?? SOUND_FILES[sound]);
}

export default function fairyExtension(pi: ExtensionAPI, options: FairyOptions = {}) {
	const lifecycleMuteNote = options.automaticLifecycleCues === false ? " 共享桌面欢迎/告别不受本进程静音控制。" + (options.activityReminders === false ? " 共享桌面休息提醒也不受控制。" : "") : "";
	const taskStartDelayMs = options.taskStartDelayMs ?? DEFAULT_TASK_START_DELAY_MS;
	const activityIntervalMs = options.activityIntervalMs ?? DEFAULT_ACTIVITY_INTERVAL_MS;
	const activityNudgeMs = options.activityNudgeMs ?? DEFAULT_ACTIVITY_NUDGE_MS;
	const activityDialogTimeoutMs = options.activityDialogTimeoutMs ?? DEFAULT_ACTIVITY_DIALOG_TIMEOUT_MS;
	const activityRetryBufferMs = options.activityRetryBufferMs ?? DEFAULT_ACTIVITY_RETRY_BUFFER_MS;
	const random = options.random ?? Math.random;
	const retryNoticeDelayMs = options.retryNoticeDelayMs ?? DEFAULT_RETRY_NOTICE_DELAY_MS;
	const permissionGroupGapMs = options.permissionGroupGapMs ?? DEFAULT_PERMISSION_GROUP_GAP_MS;
	const fileExists = options.fileExists ?? existsSync;
	const activePermissionRequests = new Set<string>();
	const warnedQuotaPeriods = new Set<string>();
	let lastPermissionPhaseEndAt = Number.NEGATIVE_INFINITY;
	let terminalOutcome: TerminalOutcome = "success";
	let taskGeneration = 0;
	let retryNoticePlayed = false;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let contextWarningPlayed = false;
	let lastContextPercent: number | undefined;
	// At most one clip is active or pending. A notification of equal or higher
	// priority replaces it; a lower-priority notification is discarded.
	let currentPlayback: PlaybackJob | undefined;
	let activePlayer: AbortController | undefined;
	let activePlayerPromise: Promise<void> | undefined;
	let audioWakeTimer: ReturnType<typeof setTimeout> | undefined;
	let activityTimer: ReturnType<typeof setTimeout> | undefined;
	let activityRetryTimer: ReturnType<typeof setTimeout> | undefined;
	let activityWatchdog: ReturnType<typeof setTimeout> | undefined;
	let activityAbort: AbortController | undefined;
	let activityCtx: ExtensionContext | undefined;
	let activityPhase: "idle" | "deferred" | "dialog" = "idle";
	let activityDeadline = 0;
	let activityPreempted = false;
	// Any non-Fairy dialog open right now (ui_prompt events skip our own dialog).
	let externalPromptOpen = false;
	let ourPromptActive = false;
	const lastPlayedVariants = new Map<FairySound, string>();
	// Only integrated registration shares mute across factory replacement;
	// no disk state and no coupling to the desktop owner's lifecycle audio.
	const processState = globalThis as typeof globalThis & { [PROCESS_MUTE_KEY]?: MuteState };
	const muteState = options.processMute
		? (processState[PROCESS_MUTE_KEY] ??= { muted: false })
		: { muted: false };
	let disposed = false;

	const runPlayer = async (path: string, signal: AbortSignal) => {
		const commands =
			process.platform === "darwin"
				? [{ command: "afplay", args: [path] }]
				: process.platform === "win32"
					? [
							{
								command: "powershell",
								args: [
									"-NoProfile",
									"-NonInteractive",
									"-Command",
									`(New-Object System.Media.SoundPlayer '${path.replace(/'/g, "''")}').PlaySync()`,
								],
							},
						]
					: process.platform === "linux"
						? [
								{ command: "paplay", args: [path] },
								{ command: "aplay", args: [path] },
							]
						: [];
		for (const { command, args } of commands) {
			if (signal.aborted) return;
			try {
				const result = await pi.exec(command, args, { timeout: 10_000, signal });
				if (result?.code === 0) return;
			} catch {
				if (signal.aborted) return;
				// Try the next platform player, or silently give up.
			}
		}
	};

	const resolveCandidate = (sound: FairySound): string | undefined => {
		const names = SOUND_VARIANTS[sound] ?? [SOUND_FILES[sound]];
		const available = names.filter((name) => fileExists(soundPath(sound, name)));
		if (available.length === 0) return undefined;
		if (available.length === 1) return soundPath(sound, available[0]);
		const picked = available[Math.min(Math.floor(random() * available.length), available.length - 1)];
		const chosen =
			picked === lastPlayedVariants.get(sound)
				? available[(available.indexOf(picked) + 1) % available.length]
				: picked;
		lastPlayedVariants.set(sound, chosen);
		return soundPath(sound, chosen);
	};

	const startPlayback = (job: PlaybackJob) => {
		if (currentPlayback !== job) return;
		const controller = new AbortController();
		activePlayer = controller;
		const promise = runPlayer(job.path, controller.signal).finally(() => {
			if (activePlayer === controller) activePlayer = undefined;
			if (activePlayerPromise === promise) activePlayerPromise = undefined;
			if (currentPlayback === job) currentPlayback = undefined;
		});
		activePlayerPromise = promise;
	};

	const launchWhenStopped = (job: PlaybackJob) => {
		const previous = activePlayerPromise;
		if (!previous) {
			startPlayback(job);
			return;
		}
		void previous.finally(() => startPlayback(job));
	};

	const play = (sound: FairySound, delayMs = 0, bypassMute = false) => {
		// The off/on confirmation clips always play: they are the user's only
		// feedback that the switch took effect, so mute does not gate them.
		if (disposed || (muteState.muted && !bypassMute)) return;
		const path = resolveCandidate(sound);
		if (!path) return;
		const job = { sound, path, priority: SOUND_PRIORITIES[sound] };
		if (currentPlayback && job.priority < currentPlayback.priority) return;

		currentPlayback = job;
		if (audioWakeTimer) clearTimeout(audioWakeTimer);
		audioWakeTimer = undefined;
		activePlayer?.abort();

		if (delayMs > 0) {
			audioWakeTimer = setTimeout(() => {
				audioWakeTimer = undefined;
				launchWhenStopped(job);
			}, delayMs);
			audioWakeTimer.unref?.();
			return;
		}
		launchWhenStopped(job);
	};

	const stop = (sound: FairySound) => {
		if (currentPlayback?.sound !== sound) return;
		currentPlayback = undefined;
		if (audioWakeTimer) clearTimeout(audioWakeTimer);
		audioWakeTimer = undefined;
		activePlayer?.abort();
	};

	const setMuted = (next: boolean) => {
		if (disposed || muteState.muted === next) return;
		muteState.muted = next;
		if (next) {
			// Silence now: drop any delayed or active clip, and close an open
			// reminder round without a dialog (it re-arms for the next hour).
			currentPlayback = undefined;
			if (audioWakeTimer) clearTimeout(audioWakeTimer);
			audioWakeTimer = undefined;
			activePlayer?.abort();
			if (activityRetryTimer) clearTimeout(activityRetryTimer);
			activityRetryTimer = undefined;
			if (activityPhase === "dialog") {
				activityPhase = "idle";
				activityAbort?.abort();
				activityAbort = undefined;
				if (activityWatchdog) clearTimeout(activityWatchdog);
				activityWatchdog = undefined;
				scheduleActivityReminder();
			} else if (activityPhase === "deferred") {
				// No voice, no dialog for this round: wait for the next hour.
				activityPhase = "idle";
				scheduleActivityReminder();
			}
		}
	};

	const clearRetryTimer = () => {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = undefined;
	};

	// Hourly stretch-reminder loop, restarted from zero on every session start
	// so a fresh session does not inherit an about-to-fire timer. Each fire
	// plays one activity recording, then asks in a native pi dialog. Choosing
	// "再工作一会儿。" re-arms in five minutes; Esc, timeout, or a ten-minute
	// window without an answer skips the round until the next hour. If another
	// dialog or a permission prompt displaces ours, the round is deferred and
	// retried (five-second polling) inside the same ten-minute window instead
	// of being dropped.
	const scheduleActivityReminder = (delayMs = activityIntervalMs) => {
		if (options.activityReminders === false || disposed) return;
		if (activityTimer) clearTimeout(activityTimer);
		activityTimer = setTimeout(() => {
			activityTimer = undefined;
			fireActivityReminder();
		}, delayMs);
		activityTimer.unref?.();
	};

	const finishActivityRound = (delayMs = activityIntervalMs) => {
		activityPhase = "idle";
		scheduleActivityReminder(delayMs);
	};

	const uiBusy = () => externalPromptOpen || activePermissionRequests.size > 0;

	const scheduleActivityRetry = () => {
		if (activityRetryTimer) clearTimeout(activityRetryTimer);
		activityRetryTimer = setTimeout(() => {
			activityRetryTimer = undefined;
			attemptActivityDialog();
		}, activityRetryBufferMs);
		activityRetryTimer.unref?.();
	};

	const attemptActivityDialog = () => {
		if (activityPhase !== "deferred") return;
		if (Date.now() > activityDeadline) {
			finishActivityRound(); // window over: skip until the next hour
			return;
		}
		if (uiBusy()) {
			scheduleActivityRetry(); // still occupied: keep waiting
			return;
		}
		void openActivityDialog();
	};

	const openActivityDialog = async () => {
		if (activityPhase !== "deferred") return;
		const ctx = activityCtx;
		if (!ctx || !ctx.hasUI) {
			// Headless mode: the spoken reminder is the whole reminder.
			finishActivityRound();
			return;
		}
		activityPhase = "dialog";
		activityPreempted = false;
		const controller = new AbortController();
		activityAbort = controller;
		const remaining = Math.max(1, activityDeadline - Date.now());
		// Watchdog: a displaced dialog (system selectors emit no ui_prompt
		// events) would otherwise hang forever; the watchdog force-aborts it.
		activityWatchdog = setTimeout(() => controller.abort(), remaining);
		activityWatchdog.unref?.();
		let answer: string | undefined;
		try {
			ourPromptActive = true;
			answer = await ctx.ui.select(
				ACTIVITY_DIALOG_TITLE,
				[ACTIVITY_OPTION_GO, ACTIVITY_OPTION_WORK],
				{ timeout: remaining, signal: controller.signal },
			);
		} catch {
			answer = undefined;
		} finally {
			ourPromptActive = false;
		}
		if (activityWatchdog) clearTimeout(activityWatchdog);
		activityWatchdog = undefined;
		activityAbort = undefined;
		if (activityPhase !== "dialog") return; // session ended while asking
		if (activityPreempted) {
			activityPhase = "deferred";
			scheduleActivityRetry();
			return;
		}
		if (answer === ACTIVITY_OPTION_GO) {
			finishActivityRound();
			return;
		}
		if (answer === ACTIVITY_OPTION_WORK) {
			finishActivityRound(activityNudgeMs);
			return;
		}
		// Esc or unanswered timeout: skip this round until the next hour.
		finishActivityRound();
	};

	const fireActivityReminder = () => {
		if (muteState.muted) {
			// Muted: skip voice and dialog for this round, next hour only.
			finishActivityRound();
			return;
		}
		play("activity_reminder");
		activityPhase = "deferred";
		activityDeadline = Date.now() + activityDialogTimeoutMs;
		if (activityCtx?.hasUI) attemptActivityDialog();
		else finishActivityRound(); // headless: voice only, next hour
	};

	const checkContextUsage = (ctx: ExtensionContext) => {
		const percent = ctx.getContextUsage()?.percent;
		if (percent === null || percent === undefined) return;
		if (percent < CONTEXT_WARNING_PERCENT) contextWarningPlayed = false;
		if (
			percent >= CONTEXT_WARNING_PERCENT &&
			lastContextPercent !== undefined &&
			lastContextPercent < CONTEXT_WARNING_PERCENT &&
			!contextWarningPlayed
		) {
			contextWarningPlayed = true;
			play("context_warning");
		}
		lastContextPercent = percent;
	};

	pi.on("session_start", (event, ctx) => {
		activityCtx = ctx;
		externalPromptOpen = false;
		activePermissionRequests.clear();
		warnedQuotaPeriods.clear();
		lastPermissionPhaseEndAt = Number.NEGATIVE_INFINITY;
		terminalOutcome = "success";
		taskGeneration = 0;
		retryNoticePlayed = false;
		contextWarningPlayed = false;
		lastContextPercent = undefined;
		clearRetryTimer();
		checkContextUsage(ctx);
		scheduleActivityReminder();
		if (event.reason === "startup" && options.automaticLifecycleCues !== false) play("welcome");
		else if (event.reason === "resume") play("session_switch");
		else if (event.reason === "new") play("new_session");
	});

	pi.on("model_select", (event) => {
		if (event.source === "set" || event.source === "cycle") play("model_switch");
	});

	pi.on("before_agent_start", () => {
		taskGeneration += 1;
		terminalOutcome = "success";
		retryNoticePlayed = false;
		clearRetryTimer();
		play("task_start", taskStartDelayMs);
	});

	pi.on("session_before_compact", (event) => {
		// Observational only: never return a value here (a return value is
		// interpreted as cancel or a custom summary by pi). Both manual and
		// automatic compactions answer immediately. Playback priority decides
		// whether a later notification interrupts this clip.
		if (event.reason === "manual") {
			play("compact_manual");
			return;
		}
		play("compact_auto");
	});

	pi.on("agent_end", (event, ctx) => {
		terminalOutcome = classifyTerminalOutcome(event.messages as AssistantLike[]);
		clearRetryTimer();
		if (terminalOutcome !== "network_error" || ctx.isIdle() || retryNoticePlayed) return;
		const generation = taskGeneration;
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			if (generation !== taskGeneration || retryNoticePlayed || ctx.isIdle()) return;
			retryNoticePlayed = true;
			play("retry");
		}, retryNoticeDelayMs);
		retryTimer.unref?.();
	});

	pi.on("agent_settled", (_event, ctx) => {
		clearRetryTimer();
		play(terminalOutcome);
		checkContextUsage(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		checkContextUsage(ctx);
	});

	pi.on("ui_prompt_start", () => {
		if (ourPromptActive) return; // our own activity dialog
		externalPromptOpen = true;
		if (activityPhase === "dialog") {
			activityPreempted = true;
			activityAbort?.abort();
		}
		if (activePermissionRequests.size === 0) play("input");
	});

	pi.on("ui_prompt_end", () => {
		if (ourPromptActive) return;
		externalPromptOpen = false;
	});

	pi.on("session_compact", (_event, ctx) => {
		play("compact_success");
		checkContextUsage(ctx);
	});

	pi.on("session_compact_failed", (event, ctx) => {
		if (!event.willRetry && ctx.isIdle()) play("compaction_failed");
	});

	const unsubscribePermissionPrompt = pi.events.on("permissions:ui_prompt", (raw) => {
		const requestId = stringField(raw, "requestId");
		if (!requestId) return;
		const now = Date.now();
		const beginsNewPhase =
			activePermissionRequests.size === 0 && now - lastPermissionPhaseEndAt > permissionGroupGapMs;
		activePermissionRequests.add(requestId);
		if (activityPhase === "dialog") {
			activityPreempted = true;
			activityAbort?.abort();
		}
		if (beginsNewPhase) play("permission");
	});

	const unsubscribePermissionDecision = pi.events.on("permissions:decision", (raw) => {
		const requestId = stringField(raw, "requestId");
		if (!requestId || !activePermissionRequests.delete(requestId)) return;
		if (activePermissionRequests.size === 0) lastPermissionPhaseEndAt = Date.now();

		const resolution = stringField(raw, "resolution");
		if (resolution === "user_approved" || resolution === "user_approved_for_session") {
			play("permission_approved");
		} else if (resolution === "user_denied") {
			play("permission_denied");
		} else {
			// A failed or otherwise non-human resolution closes the matching prompt
			// without pretending that the user chose Yes or No.
			stop("permission");
		}
	});

	const unsubscribeUsage = pi.events.on("usage:report", (raw) => {
		if (!isRecord(raw) || !Array.isArray(raw.buckets)) return;
		const providerId = stringField(raw, "providerId") ?? "unknown";
		let newlyLow = false;
		for (const item of raw.buckets) {
			if (!isRecord(item) || item.unit !== "percent" || typeof item.remaining !== "number") continue;
			const label = typeof item.label === "string" ? item.label : "quota";
			const period = typeof item.resetsAt === "number" ? String(item.resetsAt) : "current";
			const key = `${providerId}:${label}:${period}`;
			if (item.remaining <= QUOTA_WARNING_PERCENT) {
				if (!warnedQuotaPeriods.has(key)) newlyLow = true;
				warnedQuotaPeriods.add(key);
			}
		}
		if (newlyLow) play("quota_warning");
	});

	pi.on("session_shutdown", (event) => {
		disposed = true;
		clearRetryTimer();
		if (activityTimer) clearTimeout(activityTimer);
		activityTimer = undefined;
		if (activityRetryTimer) clearTimeout(activityRetryTimer);
		activityRetryTimer = undefined;
		if (activityWatchdog) clearTimeout(activityWatchdog);
		activityWatchdog = undefined;
		activityAbort?.abort();
		activityAbort = undefined;
		activityPhase = "idle";
		if (event.reason === "quit" && options.automaticLifecycleCues !== false) {
			// pi is about to exit, so the farewell must spawn synchronously
			// (no timer or microtask may run afterwards). Drop any clip that is
			// still playing and start goodbye directly.
			if (audioWakeTimer) clearTimeout(audioWakeTimer);
			audioWakeTimer = undefined;
			currentPlayback = undefined;
			activePlayer?.abort();
			activePlayer = undefined;
			activePlayerPromise = undefined;
			const path = resolveCandidate("goodbye");
			if (path) {
				const job: PlaybackJob = {
					sound: "goodbye",
					path,
					priority: SOUND_PRIORITIES.goodbye,
				};
				currentPlayback = job;
				startPlayback(job);
			}
		} else {
			if (audioWakeTimer) clearTimeout(audioWakeTimer);
			audioWakeTimer = undefined;
			currentPlayback = undefined;
			activePlayer?.abort();
			activePlayer = undefined;
		}
		unsubscribePermissionPrompt();
		unsubscribePermissionDecision();
		unsubscribeUsage();
	});

	pi.registerCommand("fairy-voice", {
		description: options.automaticLifecycleCues === false
			? "列出或试听 Fairy 语音；本 Pi 静音不影响共享桌面欢迎、告别与休息提醒"
			: "列出或试听 Fairy 提示语音",
		getArgumentCompletions: (prefix: string) => {
			const values = [
				"help",
				"list",
				"off",
				"on",
				"status",
				...Object.keys(SOUND_FILES).map((name) => `test ${name}`),
				"test activity",
			];
			return values.filter((value) => value.startsWith(prefix)).map((value) => ({ label: value, value, description: value.startsWith("test ") ? "试听语音或查看活动提醒说明" : ({ help: "显示帮助", list: "列出声音", off: "静音本 Pi", on: "恢复语音", status: "查询静音状态" } as Record<string, string>)[value] }));
		},
		handler: async (args, ctx) => {
			if (disposed) return;
			const value = args.trim();
			if (value === "help") {
				if (ctx.hasUI) ctx.ui.notify([
					"/fairy-voice help — 仅显示帮助，静音时也可用，不播放声音、不改状态。",
					"/fairy-voice 或 /fairy-voice list — 列出声音名称；/fairy-voice status — 查询静音状态。",
					"/fairy-voice off — 静音本 Pi；/fairy-voice on — 恢复；两者均播放开关确认音。无 toggle 命令。静音不写入磁盘，退出进程后恢复。" + (options.processMute ? " 同一 Pi 的 /reload、切换/新建会话继续保留静音。" : " 扩展重载后恢复。"),
					...(options.automaticLifecycleCues === false ? ["自动欢迎/告别由共享桌面统一播放，不受本 Pi 静音控制；桌面未连接时不提供这些自动桌面提示。"] : []),
					"/fairy-voice test <sound> — 试听下列名称（大小写敏感）；静音时不播放，test voice_on 不会解除静音。",
					"welcome 欢迎；goodbye 告别；task_start 任务开始；model_switch 模型切换；session_switch 会话切换；new_session 新建会话。",
					"permission 权限请求；permission_approved 允许；permission_denied 拒绝；input 等待输入；success 完成。",
					"network_error 网络错误；error 错误；aborted 中止；retry 重试；context_warning 上下文警告；compaction_failed 压缩失败；quota_warning 额度警告。",
					"compact_auto 自动压缩；compact_manual 手动压缩；compact_success 压缩完成；voice_off 静音确认；voice_on 恢复确认；activity_reminder 活动提醒。",
					options.activityReminders === false
						? "/fairy-voice test activity 或 /fairy-voice test activity_reminder — 集成版仅说明共享桌面休息提醒归属，不重播、不弹 Pi 对话框、不改计时；共享提醒不受本 Pi 静音控制，桌面未连接时不提醒。"
						: "/fairy-voice test activity — 测试活动提醒语音及对话框（无 UI 时仅语音），不改整点计时；test activity_reminder 仅试听语音。",
				].join("\n"), "info");
				return;
			}
			if (value === "off") {
				setMuted(true);
				play("voice_off", 0, true); // always-audible switch confirmation
				ctx.ui.notify("Fairy语音已静音（仅本次进程；退出后重新打开 pi 自动恢复）。" + lifecycleMuteNote, "info");
				return;
			}
			if (value === "on") {
				setMuted(false);
				play("voice_on", 0, true); // always-audible switch confirmation
				ctx.ui.notify("Fairy语音已恢复。", "info");
				return;
			}
			if (value === "status") {
				ctx.ui.notify(
					(muteState.muted ? "当前状态：已静音（仅本次进程，重启后自动恢复）。" : "当前状态：正常播音。") + lifecycleMuteNote,
					"info",
				);
				return;
			}
			if (!value || value === "list") {
				ctx.ui.notify("可试听的声音：" + Object.keys(SOUND_FILES).join("、"), "info");
				return;
			}
			const match = /^test\s+(.+)$/.exec(value);
			const arg = match?.[1];
			if (options.activityReminders === false && (arg === "activity" || arg === "activity_reminder")) {
				ctx.ui.notify("休息提醒由共享桌面 Fairy 统一管理；此命令不重播、不弹出 Pi 对话框。桌面未连接时不提醒。", "info");
				return;
			}
			if (arg === "activity") {
				// One full reminder round (voice + dialog) for manual testing.
				// Runs outside the hourly state machine: no timer is armed,
				// cleared, or rescheduled, so the live schedule keeps its phase.
				if (muteState.muted) {
					ctx.ui.notify("已静音：活动提醒语音未播放（对话框也不弹出）。", "warning");
					return;
				}
				play("activity_reminder");
				if (!ctx.hasUI) {
					ctx.ui.notify("活动提醒语音已播放（当前模式无对话框）。", "info");
					return;
				}
				const controller = new AbortController();
				const watchdog = setTimeout(() => controller.abort(), activityDialogTimeoutMs);
				watchdog.unref?.();
				// Mark the dialog as ours so the ui_prompt_start bookkeeping does
				// not treat it as an unrelated blocking prompt (which would play
				// the input clip over the reminder voice).
				ourPromptActive = true;
				try {
					const answer = await ctx.ui.select(
						ACTIVITY_DIALOG_TITLE,
						[ACTIVITY_OPTION_GO, ACTIVITY_OPTION_WORK],
						{ timeout: activityDialogTimeoutMs, signal: controller.signal },
					);
					ctx.ui.notify(
						answer === ACTIVITY_OPTION_GO
							? "已确认活动！本次测试不影响整点计时。"
							: answer === ACTIVITY_OPTION_WORK
								? "已选择再工作一会儿；真实提醒仍按原计划进行。"
								: "已跳过本次测试提醒。",
						"info",
					);
				} finally {
					ourPromptActive = false;
					clearTimeout(watchdog);
				}
				return;
			}
			const sound = arg as FairySound | undefined;
			if (!sound || !(sound in SOUND_FILES)) {
				ctx.ui.notify("用法：/fairy-voice list 列出声音；/fairy-voice test <sound> 试听；/fairy-voice test activity 查看活动提醒", "warning");
				return;
			}
			if (muteState.muted) {
				ctx.ui.notify(`已静音：${sound} 未播放。`, "warning");
				return;
			}
			play(sound);
		},
	});
}
