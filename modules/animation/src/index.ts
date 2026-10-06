/** macOS desktop Fairy; no terminal renderer or fallback. */
import { closeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DesktopClient, eligible, welcomeSetting, type WelcomeMode, type StartupLease } from "./desktop/client.ts";

const REMOVED_MODE = "--fairy-anim-mode 已移除，请删除此启动参数后重启 Pi；本次不会连接桌面。语音、帮助和开场偏好命令仍可使用。";

export default function fairyAnimationExtension(
	pi: ExtensionAPI,
	options: { lifecycleSoundsDirectory?: string; startupLease?: StartupLease } = {},
) {
	// Rejection-only migration guard. Flags are populated by the host AFTER factories run.
	pi.registerFlag("fairy-anim-mode", { description: "已移除的后端参数；请删除此参数，否则本次禁用桌面连接", type: "string" });
	let desktop: DesktopClient | undefined;
	let startupLease = options.startupLease;
	let enabled = true;
	function discardStartupLease(): void {
		if (startupLease) { try { closeSync(startupLease.fd); } catch {} startupLease = undefined; }
	}
	function attach(ctx: ExtensionContext): void {
		if (!eligible(ctx.mode)) { discardStartupLease(); return; }
		if (pi.getFlag("fairy-anim-mode") !== undefined) {
			discardStartupLease(); desktop?.dispose(); desktop = undefined;
			ctx.ui.notify(REMOVED_MODE, "warning"); return;
		}
		if (process.platform !== "darwin" && process.platform !== "win32") {
			discardStartupLease();
			ctx.ui.notify("桌面 Fairy 仅支持 macOS 与 Windows；当前系统不支持，且无终端动画回退。Pi 和语音仍可使用。", "warning"); return;
		}
		if (enabled && !desktop) {
			desktop = new DesktopClient((message) => ctx.ui.notify(message, "error"), undefined, options.lifecycleSoundsDirectory, startupLease);
			startupLease = undefined;
			desktop.start();
		}
	}
	pi.on("session_start", (_event, ctx) => { if (!desktop) attach(ctx); });
	pi.on("session_shutdown", () => { discardStartupLease(); desktop?.dispose(); desktop = undefined; });
	pi.registerCommand("fairy-anim", {
		description: "桌面 Fairy：help 帮助；on/off/toggle 开关；welcome full/simple 开场偏好",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "help") {
				if (ctx.hasUI) ctx.ui.notify([
					"/fairy-anim help — 仅显示帮助，不启动桌面、不读写设置。",
					"/fairy-anim 或 /fairy-anim on — 开启；/fairy-anim off — 关闭；/fairy-anim toggle — 切换。仅本 Pi 的显示/桌面连接，不关闭其他 Pi 持有的共享桌面。",
					"开关不写入设置；扩展重载后本 Pi 状态重置。桌面自动跟随系统外观。显示控制仅 macOS/Windows 交互式 TUI 生效；其他系统不支持桌面，无终端回退。",
					"/fairy-anim welcome — 查询已保存的开场选择（不是当前播放状态）。",
					"/fairy-anim welcome full — 保存完整 HDD 开场；/fairy-anim welcome simple — 保存简洁生长/落位开场。仅 macOS/Windows，全局持久化，下一次新共享桌面生命周期生效，不重播、不启用已关闭的桌面。",
					"桌面大小仅通过右键菜单调整，位置通过拖动调整；大小/位置全局持久化，无对应斜杠命令。",
				].join("\n"), "info");
				return;
			}

			if (!eligible(ctx.mode)) {
				if (ctx.hasUI) ctx.ui.notify("桌面显示和开场设置仅限非子进程的交互式 Pi 使用。", "warning");
				return;
			}
			if (arg === "welcome" || arg.startsWith("welcome ")) {
				if (!/^welcome(?: (full|simple))?$/.test(arg)) { ctx.ui.notify("用法：/fairy-anim welcome [full|simple]", "warning"); return; }
				if (process.platform !== "darwin" && process.platform !== "win32") { ctx.ui.notify("桌面开场设置仅支持 macOS 与 Windows。", "warning"); return; }
				try {
					const choice = arg.split(" ")[1] as WelcomeMode | undefined;
					const saved = await welcomeSetting(choice);
					ctx.ui.notify(`Fairy 开场：${saved}${choice ? " 已保存，下一次新共享桌面生命周期生效；当前开场不变。" : "（已保存的选择）。"}`, "info");
				} catch (error) { ctx.ui.notify(`Fairy 开场设置未确认保存：请关闭所有 Pi 的桌面连接后重试；若仍失败，请检查设置目录写入权限${process.platform === "darwin" ? "及 Swift/Xcode SDK" : "及 .NET Framework 4.x"}。诊断：${String(error)}`, "error"); }
				return; // Preferences never enable a desktop, even with an obsolete CLI flag.
			}
			if (arg === "mode" || arg.startsWith("mode ")) {
				ctx.ui.notify("后端切换已移除；Fairy 仅支持 macOS 与 Windows 桌面。此命令不改变显示状态。用法：/fairy-anim help", "warning"); return;
			}
			if (!arg || arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else if (arg === "toggle") enabled = !enabled;
			else { ctx.ui.notify("用法：/fairy-anim [help|on|off|toggle|welcome|welcome full|welcome simple]", "warning"); return; }
			if (!enabled) { discardStartupLease(); desktop?.dispose(); desktop = undefined; }
			else if (!desktop) attach(ctx);
		},
	});
}
