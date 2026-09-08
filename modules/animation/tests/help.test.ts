import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { openSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(platform = "darwin", startupLease?: { fd: number; token: string }) {
 const root = await mkdtemp(join(tmpdir(), "fairy-command-"));
 const source = (await readFile(new URL("../src/index.ts", import.meta.url), "utf8"))
  .replace('from "./desktop/client.ts"', `from ${JSON.stringify(root + "/client.mts")}`)
  .replaceAll("process.platform", JSON.stringify(platform));
 await writeFile(root + "/entry.mts", source);
 await writeFile(root + "/client.mts", `
export const calls = []; export let failure;
export const fail = value => { failure = value; };
export const eligible = mode => mode === 'tui';
let saved = 'full';
export async function welcomeSetting(choice) { calls.push(['welcome', choice]); if(failure) throw Error(failure); return saved = choice ?? saved; }
export class DesktopClient {
 constructor(notify) { calls.push('construct'); this.notify = notify; }
 start() { calls.push('start'); }
 dispose() { calls.push('dispose'); }
 setAppearance(value) { calls.push(['theme',value]); }
}
`);
 const client = await import(root + "/client.mts");
 const { default: install } = await import(root + "/entry.mts");
 let command: any; const handlers = new Map<string, Function>(), flags = new Map<string, any>(), values = new Map();
 let reads = 0;
 install({ registerFlag(name: string, flag: any) { flags.set(name, flag); },
  getFlag(name: string) { reads++; return values.get(name); }, on(name: string, handler: Function) { handlers.set(name, handler); },
  registerCommand(_name: string, value: any) { command = value; } }, { startupLease });
 assert.equal(reads, 0, "factories must not inspect flags before host population");
 const notes: [string, string][] = [];
 const ctx = { hasUI: true, mode: "tui", ui: { notify(text: string, kind: string) { notes.push([text, kind]); },
  setWidget() { assert.fail("desktop-only must never mount terminal widgets"); } } };
 return { ...client, command, handlers, flags, values, ctx, notes, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("fairy-anim help is Chinese notify-only and preserves off/welcome without assets or native control", async () => {
 const h = await fixture();
 try {
  await h.command.handler(" HELP ", h.ctx);
  assert.deepEqual(h.calls, []);
  const help = h.notes.at(-1)![0];
  for (const syntax of ["help", "on", "off", "toggle", "welcome full", "welcome simple"]) assert.ok(help.includes(`/fairy-anim ${syntax}`));
  for (const meaning of ["查询已保存", "下一次新共享桌面生命周期", "不重播", "右键菜单", "拖动", "全局持久化", "不写入设置", "扩展重载", "其他 Pi", "无终端回退"]) assert.ok(help.includes(meaning), meaning);
  assert.doesNotMatch(help, /theme|Kitty|mode auto|mode pixel|mode terminal/);
  assert.match(h.command.description, /桌面/);
  assert.doesNotMatch(h.command.description, /theme/);
  assert.match(help, /自动跟随 macOS 系统外观/);
  await h.command.handler("off", h.ctx);
  const before = structuredClone(h.calls);
  await h.command.handler("help", h.ctx); assert.deepEqual(h.calls, before);
  await h.command.handler("toggle", h.ctx);
  assert.deepEqual(h.calls.slice(-2), ["construct", "start"]);
  h.ctx.mode = "rpc"; await h.command.handler("help", h.ctx); assert.equal(h.notes.at(-1)![0], help);
  h.ctx.hasUI = false; const n = h.notes.length;
  await h.command.handler("help", h.ctx); assert.equal(h.notes.length, n);
 } finally { await h.cleanup(); }
});

test("obsolete theme commands are warning-only while off/on and never replay on attach", async () => {
 const h = await fixture();
 try {
  for (const state of ["off", "on"]) {
   await h.command.handler(state, h.ctx);
   const before = structuredClone(h.calls);
   for (const arg of ["theme", "theme auto", "theme light", "theme dark", " THEME DARK ", "theme invalid"]) {
    await h.command.handler(arg, h.ctx);
    assert.deepEqual(h.calls, before, `${state}: ${arg}`);
    assert.equal(h.notes.at(-1)![1], "warning");
    assert.match(h.notes.at(-1)![0], /用法：/);
    assert.doesNotMatch(h.notes.at(-1)![0], /theme/);
   }
   await h.command.handler("toggle", h.ctx);
   assert.deepEqual(h.calls.slice(before.length), state === "off" ? ["construct", "start"] : ["dispose"]);
  }
  await h.command.handler("", h.ctx);
  await h.command.handler("on", h.ctx);
  assert.deepEqual(h.calls, ["construct", "start", "dispose", "construct", "start"]);
  h.handlers.get("session_shutdown")!({}, h.ctx);
  assert.equal(h.calls.at(-1), "dispose");
 } finally { await h.cleanup(); }
});

test("fairy-anim exact Chinese welcome success/query/failure and invalid commands never attach", async () => {
 const h = await fixture();
 try {
  await h.command.handler("welcome full", h.ctx);
  assert.deepEqual(h.notes.at(-1), ["Fairy 开场：full 已保存，下一次新共享桌面生命周期生效；当前开场不变。", "info"]);
  await h.command.handler("welcome", h.ctx);
  assert.deepEqual(h.notes.at(-1), ["Fairy 开场：full（已保存的选择）。", "info"]);
  h.fail("fixture write failed"); await h.command.handler("welcome simple", h.ctx);
  assert.deepEqual(h.notes.at(-1), ["Fairy 开场设置未确认保存：请关闭所有 Pi 的桌面连接后重试；若仍失败，请检查设置目录写入权限及 Swift/Xcode SDK。诊断：Error: fixture write failed", "error"]);
  await h.command.handler("welcome other", h.ctx);
  assert.deepEqual(h.notes.at(-1), ["用法：/fairy-anim welcome [full|simple]", "warning"]);
  for (const arg of ["mode", "mode auto", "mode desktop", "mode terminal", "mode vector", "mode pixel", "mode nonsense", "unknown", "theme invalid"]) {
   const before = structuredClone(h.calls); await h.command.handler(arg, h.ctx); assert.deepEqual(h.calls, before);
   assert.match(h.notes.at(-1)![0], /用法：/);
  }
  assert.ok(!h.calls.includes("construct"));
 } finally { await h.cleanup(); }
});

test("desktop-only nonmacOS explicitly unsupported; no terminal graphics or native attach", async () => {
 const h = await fixture("linux");
 try {
  h.handlers.get("session_start")!({}, h.ctx);
  assert.deepEqual(h.notes.at(-1), ["桌面 Fairy 仅支持 macOS；当前系统不支持，且无终端动画回退。Pi 和语音仍可使用。", "warning"]);
  await h.command.handler("welcome full", h.ctx);
  assert.deepEqual(h.notes.at(-1), ["桌面开场设置仅支持 macOS。", "warning"]);
  for (const arg of ["on", "toggle", "toggle", "theme auto", "off"]) await h.command.handler(arg, h.ctx);
  assert.deepEqual(h.calls, []);
 } finally { await h.cleanup(); }
});

// Execute the installed host's actual flag-application function in an isolated resource fixture.
// No host entrypoint, user settings, plugins, model runtime or native helper is loaded.
test("installed host populates obsolete flag after registration; every value closes startup fd and blocks all attachment", { skip: !process.env.PI_VOICE_TEST_HOST }, async () => {
 const source = await readFile(join(process.env.PI_VOICE_TEST_HOST!, "dist/core/agent-session-services.js"), "utf8");
 const start = source.indexOf("function applyExtensionFlagValues("), end = source.indexOf("/**", start);
 assert.ok(start >= 0 && end > start);
 const apply = new Function(`${source.slice(start, end)}; return applyExtensionFlagValues;`)();
 assert.ok(source.indexOf("await resourceLoader.reload(") < source.indexOf("diagnostics.push(...applyExtensionFlagValues("));
 for (const value of ["auto", "desktop", "terminal", "vector", "pixel", "unknown", ""]) {
  const fd = openSync("/dev/null", "r"); const h = await fixture("darwin", { fd, token: "fixture" });
  try {
   assert.equal(h.flags.get("fairy-anim-mode").default, undefined);
   assert.match(h.flags.get("fairy-anim-mode").description, /已移除/);
   assert.deepEqual(apply({ getExtensions: () => ({ extensions: [{ flags: h.flags }], runtime: { flagValues: h.values } }) }, new Map([["fairy-anim-mode", value]])), []);
   h.handlers.get("session_start")!({}, h.ctx);
   assert.throws(() => fstatSync(fd), { code: "EBADF" });
   assert.deepEqual(h.notes.at(-1), ["--fairy-anim-mode 已移除，请删除此启动参数后重启 Pi；本次不会连接桌面。语音、帮助和开场偏好命令仍可使用。", "warning"]);
   for (const arg of ["on", "off", "toggle", "theme dark", "help", "welcome full"]) await h.command.handler(arg, h.ctx);
   assert.deepEqual(h.calls, [["welcome", "full"]]);
   h.handlers.get("session_shutdown")!({}, h.ctx);
  } finally { await h.cleanup(); }
 }
});
