import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { DesktopClient } from "../modules/animation/src/desktop/client.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import install from "../index.ts";
import animation from "../modules/animation/src/index.ts";
import voice from "../modules/voice/fairy.ts";

function harness(factory: typeof install, modeFlag: string | undefined = undefined) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const bus = new Map<string, Set<(event: any) => unknown>>();
	const commands = new Map<string, any>();
	const flags = new Map<string, any>();
	const plays: string[] = [];
	const pi = {
		on(name: string, handler: (event: any, ctx: any) => unknown) {
			const list = handlers.get(name) ?? [];
			assert.ok(!list.includes(handler));
			list.push(handler); handlers.set(name, list);
		},
		events: { on(name: string, handler: (event: any) => unknown) {
			const list = bus.get(name) ?? new Set();
			assert.ok(!list.has(handler)); list.add(handler); bus.set(name, list);
			return () => list.delete(handler);
		} },
		registerCommand(name: string, command: any) {
			assert.ok(!commands.has(name), `duplicate command ${name}`); commands.set(name, command);
		},
		registerFlag(name: string, flag: any) {
			assert.ok(!flags.has(name)); flags.set(name, flag);
		},
		getFlag: () => modeFlag,
		async exec(command: string, args: string[]) {
			assert.ok(["afplay", "paplay", "aplay"].includes(command));
			assert.ok(args[0].startsWith(fileURLToPath(new URL("../modules/voice/sounds/", import.meta.url))));
			assert.equal(readFileSync(args[0]).toString("ascii", 0, 4), "RIFF");
			plays.push(args[0]); // Never spawn an actual audio player.
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	factory(pi as any);
	const ctx = {
		mode: "print", hasUI: false, isIdle: () => true, getContextUsage: () => ({ percent: 0 }),
		ui: { notify() {}, setWidget() { assert.equal(ctx.mode, "tui", "headless composition must not mount GUI"); } },
	};
	return { handlers, bus, commands, flags, plays, ctx,
		async emit(name: string, event: any = {}) {
			for (const handler of handlers.get(name) ?? []) assert.equal(await handler(event, ctx), undefined);
		},
	};
}

const counts = (map: Map<string, any>) => Object.fromEntries([...map].map(([key, list]) => [key, list.length ?? list.size]));

test("composition registers exactly the sum of both modules, without duplicate commands or bus subscriptions", async () => {
	const a = harness(animation), v = harness(voice), combined = harness(install);
	const expected = counts(a.handlers);
	for (const [key, count] of Object.entries(counts(v.handlers))) expected[key] = (expected[key] ?? 0) + count;
	assert.deepEqual(counts(combined.handlers), expected);
	assert.deepEqual([...combined.commands.keys()], ["fairy-anim", "fairy-voice"]);
	assert.deepEqual([...combined.flags.keys()], ["fairy-anim-mode"]);
	assert.deepEqual(counts(combined.bus), { "permissions:ui_prompt": 1, "permissions:decision": 1, "usage:report": 1 });
	assert.equal(combined.plays.length, 0, "registration starts no audio");
	await combined.emit("session_start", { reason: "startup" });
	assert.equal(combined.plays.length, 0, "root suppresses only automatic startup audio");
	await combined.emit("session_before_compact", { reason: "manual" });
	await combined.emit("session_compact");
	const soundCommands = combined.commands.get("fairy-voice").getArgumentCompletions("test ");
	for (const { value } of soundCommands) {
		if (value === "test activity") continue;
		await combined.commands.get("fairy-voice").handler(value, combined.ctx);
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	const beforeQuit = combined.plays.length;
	await combined.emit("session_shutdown", { reason: "quit" });
	assert.equal(combined.plays.length, beforeQuit, "root suppresses automatic farewell");
	assert.ok([...combined.bus.values()].every(set => set.size === 0), "voice unsubscribes on shutdown");
	await a.emit("session_shutdown", { reason: "reload" });
	await v.emit("session_shutdown", { reason: "reload" });
});

test("public voice implementation and all 44 WAVs match shipped provenance", () => {
	const root = new URL("../modules/voice/", import.meta.url);
	const provenance = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8"));
	assert.equal(provenance.bundledVoiceWavCount, 44);
	assert.equal(Object.keys(provenance.sha256).length, 46, "two implementation/test files plus 44 WAVs");
	for (const [target, sha256] of Object.entries(provenance.sha256)) {
		const bytes = readFileSync(new URL(target, root));
		assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, target);
	}
	const sounds = readdirSync(new URL("sounds/", root)).filter(name => name.endsWith(".wav"));
	assert.equal(sounds.length, 44);
	const source = readFileSync(new URL("fairy.ts", root), "utf8");
	for (const match of source.matchAll(/"([\w-]+\.wav)"/g)) assert.ok(sounds.includes(match[1]), match[1]);
	for (const name of sounds) {
		const bytes = readFileSync(new URL(`sounds/${name}`, root));
		assert.equal(bytes.toString("ascii", 0, 4), "RIFF", name);
		assert.equal(bytes.toString("ascii", 8, 12), "WAVE", name);
		assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, name);
	}
});

test("package discovery exposes only the composition entry and has scoped license metadata", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.name, "pi-fairy");
	assert.equal(manifest.private, true);
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.license, "SEE LICENSE IN LICENSES.md");
});


test("root configures only the integrated desktop audio path, while animation alone stays silent", { skip: process.platform !== "darwin" }, async () => {
 const clients: DesktopClient[] = [];
 const start = mock.method(DesktopClient.prototype, "start", function(this: DesktopClient) { clients.push(this); });
 const childMarker = process.env.PI_SUBAGENT_CHILD;
 delete process.env.PI_SUBAGENT_CHILD;
 try {
  for (const factory of [install, animation]) {
   const h = harness(factory); h.ctx.mode = "tui";
   // No native launch or real audio: DesktopClient.start is replaced above.
   await h.emit("session_start", { reason: "startup" });
   const client = clients.at(-1)!;
   assert.ok(client);
   assert.equal((client as any).lifecycleSoundsDirectory, factory === install
    ? fileURLToPath(new URL("../modules/voice/sounds/", import.meta.url)) : undefined);
   assert.deepEqual(h.plays, []);
   await h.commands.get("fairy-anim").handler("off", h.ctx);
   await h.emit("session_shutdown", { reason: "quit" });
   assert.ok([...h.bus.values()].every(set => set.size === 0));
  }
 } finally {
  start.mock.restore();
  if (childMarker === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = childMarker;
 }
});

test("root mute survives reload factory replacement without affecting default voice registration", async () => {
 const key = Symbol.for("pi-fairy.voice.process-mute");
 const globals = globalThis as any, previous = globals[key];
 delete globals[key];
 try {
  const old = harness(install);
  await old.commands.get("fairy-voice").handler("off", old.ctx);
  await old.emit("session_shutdown", { reason: "reload" });
  const next = harness(install);
  await next.emit("session_start", { reason: "reload" });
  const notes: string[] = [];
  next.ctx.hasUI = true;
  next.ctx.ui.notify = (text?: string) => { notes.push(text ?? ""); };
  const muteBefore = structuredClone(globals[key]);
  await next.commands.get("fairy-voice").handler("help", next.ctx);
  assert.match(notes.at(-1)!, /同一 Pi 的 \/reload、切换\/新建会话继续保留静音/);
  assert.match(notes.at(-1)!, /共享提醒不受本 Pi 静音控制/);
  assert.deepEqual(globals[key], muteBefore, "help preserves process-local mute after reload");
  assert.deepEqual(next.plays, [], "help plays no sound while muted");
  await next.commands.get("fairy-voice").handler("test compact_manual", next.ctx);
  assert.deepEqual(next.plays, []);
  const direct = harness(voice);
  await direct.commands.get("fairy-voice").handler("test compact_manual", direct.ctx);
  assert.equal(direct.plays.length, 1);
  await next.emit("session_shutdown", { reason: "reload" });
  await direct.emit("session_shutdown", { reason: "reload" });
 } finally {
  if (previous === undefined) delete globals[key]; else globals[key] = previous;
 }
});

test("integrated root has no legacy activity timer or manual dialog in desktop-disconnected composition", async (t) => {
 t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
 const h = harness(install);
 const notes: string[] = []; h.ctx.ui.notify = (text?: string) => { notes.push(text ?? ""); };
 await h.emit("session_start", { reason: "reload" });
 t.mock.timers.tick(24 * 3600_000);
 for (const arg of ["activity", "activity_reminder"]) await h.commands.get("fairy-voice").handler("test " + arg, h.ctx);
 assert.deepEqual(h.plays, []);
 assert.ok(notes.every(note => note.includes("共享桌面")));
 await h.emit("session_shutdown", { reason: "reload" });
});

test("missing voice resources are silent, leave commands responsive, and never invoke a player", async () => {
 const missing = new URL("../modules/voice/sounds/not-a-shipped-resource.wav", import.meta.url);
 assert.equal(existsSync(missing), false);
 const h = harness(pi => voice(pi, {
  automaticLifecycleCues: false,
  activityReminders: false,
  fileExists: () => existsSync(missing), // Actual missing-file result, never a counterfeit clip.
 }));
 const notes: string[] = [];
 h.ctx.hasUI = true;
 h.ctx.ui.notify = (text?: string) => { notes.push(text ?? ""); };
 await h.emit("session_start", { reason: "startup" });
 await h.emit("session_before_compact", { reason: "manual" });
 await h.emit("session_compact");
 await h.commands.get("fairy-voice").handler("test success", h.ctx);
 assert.deepEqual(notes, [], "current runtime does not warn about a missing clip");
 for (const command of ["off", "on", "status", "help", "test activity"]) {
  await h.commands.get("fairy-voice").handler(command, h.ctx);
 }
 assert.ok(notes.some(note => note.includes("已恢复")), "on reports mute state, not resource availability");
 assert.ok(notes.some(note => note.includes("共享桌面")));
 assert.deepEqual(h.plays, []);
 await h.emit("session_shutdown", { reason: "quit" });
 assert.ok([...h.bus.values()].every(set => set.size === 0));
});

test("native missing lifecycle cue clears pending before returning; visual retirement checks idle (static only)", () => {
 const source = readFileSync(new URL("../modules/animation/native/Fairy.swift", import.meta.url), "utf8");
 assert.match(source, /pending = nil\s+let paths = lifecyclePaths[^\n]+isReadableFile/);
 assert.match(source, /guard let path = candidates.randomElement\(\) else \{ return \}/);
 assert.match(source, /var idle: Bool \{ player == nil && pending == nil \}/);
 assert.match(source, /if visualDone && lifecycleAudio.idle/);
});
