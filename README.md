# pi-fairy

为 Pi 提供 macOS 共享桌面 Fairy 与事件语音通知。中文命令帮助，桌面拖动与位置/大小记忆，全屏或简洁开场、统一告别、空闲动效与共享休息提醒。

> **包含全部 44 个语音模块 WAV**（含两段电子权限提示音），安装后无需本地模型或另行下载声音。原创代码/文档采用 MIT；Apache 视觉适配与合成语音另有边界，见 [许可矩阵](LICENSES.md) 和 [音频来源](docs/AUDIO-PROVENANCE.md)。资源完整不等于本机已通过真实音画测试。
>
> 仓库：<https://github.com/ymd-physics/pi-fairy>。当前仍为本地待审发布候选；安装前确认仓库已有经审核的发布内容。本次未上传、未执行安装。

## 平台与依赖

- **桌面仅支持 macOS**，依赖 AppKit、Swift 编译器与可用的 Xcode Command Line Tools/SDK；没有终端像素或矢量回退，没有 `mode` 或 `theme` 设置入口。外观自动跟随 macOS。
- 本次静态/模拟检查环境：macOS **15.6.1 / arm64**、Node **24.19.0**、Pi **0.85.1**；检测到 `/usr/bin/swift` 和已选择的 Xcode 工具目录。这不是最低系统版本声明，也不是桌面/音画端到端认证。最低 macOS、Node 与 Pi 兼容范围尚待独立验证。
- 正常运行使用预生成图像，不需要本地语音模型、Python 或光栅化工具。首次桌面使用可能编译原生程序；显式 `npm run prepare:desktop` 是可选的编译准备，会写本用户临时缓存，不应未经许可运行。
- 离线重建图片才需要开发依赖 `@resvg/resvg-js`；部分资源检查需要 Python/Pillow。依赖安装须另行批准。
- 其他系统**不支持桌面**。语音代码含 Linux `paplay`/`aplay` 路径，但未验证跨平台播放可用；不能承诺跨平台语音。Windows 也没有已实现的播放器路径。非 macOS 桌面适配必须作为用户另行授权的独立开发项目，不能冒充安装回退。

## 安装（仅在发布门槛关闭后）

先读源码、许可证与检查清单。以下是已核对 Pi 0.85.1 完整 `docs/packages.md` 和 README 的语法，**本次没有执行**：

```sh
pi install https://github.com/ymd-physics/pi-fairy
```

这会使用网络，默认更改用户级 Pi 设置，并可能运行 npm 安装依赖；加 `-l` 是项目级设置，不应擅自选择。Git 安装默认省略开发依赖（自定义 `npmCommand` 时可能不同）。正式发布后建议使用审核过的 tag/commit：在 URL 后加 `@实际发布引用`，不要把示意引用当成已存在版本。

不要同时加载集成版、旧 `pi-fairy-animation`、独立 `pi-fairy-voice` 或内部模块入口。同一代码的不同副本不会按内容去重。迁移须先查看现有包和用户意图，仅定点替换获批条目，保留其他插件、设置和旧副本以便回滚。详见 [迁移](docs/INTEGRATION.md)。

### 给安装 Agent 的提示词

```text
第一步只读判断操作系统、版本与架构。若不是 macOS，立即说明桌面不支持，
不执行任何 macOS 命令，不安装替代后端、不自动移植；必须先获得主人明确批准
才能开展独立的平台适配。不要宣称语音在其他平台一定可用。
只有确认 macOS 后，再只读检查 Node、Pi、swift/swiftc 与 Xcode CLT/SDK；
完整阅读本机 Pi docs/packages.md 及其安装交叉引用，再读 pi-fairy README、
LICENSES、RELEASE-CHECKLIST、PUBLIC-DISTRIBUTION 和源码，检查全局/项目重复入口。
核对 44 个语音 WAV 与原创开场 SFX 完整，说明代码许可不转授第三方声音权利。
若资源损坏/缺失，停止并报告，不下载、生成、替换声音；资源完整不等于播放已验收。
给出依赖、设置、缓存及 shell 变更清单；获得我的明确批准后才能安装依赖、
修改设置或 shell。不要覆盖整个 settings.json，不要删除旧包或杀死共享 helper。
正常安装与可选提前开场必须分开审批，不要默认改 .zshrc。
若不是 macOS，说明桌面不支持并停止桌面安装；平台适配需作为另行授权的
独立开发项目，不要自动移植、安装替代桌面后端或宣称语音一定可用。
```

## 使用与行为边界

- `/fairy-anim help`、`/fairy-voice help`：中文只读帮助，不播放声音或启动桌面。
- `/fairy-anim on|off|toggle`：本 Pi 的桌面租约；其他 Pi 仍可持有共享桌面。
- `/fairy-anim welcome full|simple`：保存下一次新共享生命周期的开场模式，不立即重播。拖动位置与右键菜单大小全局保存。
- `/fairy-voice on|off|status`：本进程语音状态；**不控制共享桌面的欢迎、告别、休息提醒**。这些共享声音由桌面 owner 管理。
- [共享休息提醒](docs/REST-REMINDER.md)由同一个桌面 owner 调度；集成版不启用独立语音的旧每小时轮次。
- [语音规则审计](docs/VOICE-AUDIT.md)：压缩、权限、上下文与额度等事件有投递边界。及时压缩开始通知需在 codex-compaction 前加载；额度通知需要另行提供 `usage:report` 的插件，本包不捆绑它。

普通插件从 `session_start` 启动，**不能保证在 Pi TUI 之前显示**。[可选 zsh 提前开场](docs/STARTUP-ENTRY.md)是独立、可撤销的窄兼容入口，只确认软件 ready，不保证物理首帧。其守卫要求全局设置中恰好一个未过滤的本地包路径；普通 Git URL 安装不是已验证的提前入口配置。不自动改为本地路径或修改 shell。

## 开发与许可

源码资源通过模块相对路径定位，不需要作者工作目录或独立语音包。离线公共发行回归：

```sh
npm run test:public
```

该命令只用静态检查及 mock，不安装依赖、不启动桌面/播放器。原生测试需 Swift/SDK，光栅化测试需开发依赖；不能将 `npm test` 视为本版本的绿色保证；完整测试矩阵见 [发行说明](docs/PUBLIC-DISTRIBUTION.md)。

[LICENSE](LICENSE) 授权 ymd-physics 的原创代码、测试和文档（含语音模块）为 MIT，Copyright 2026 ymd-physics。[LICENSES.md](LICENSES.md) 区分原创与改编：Chengzhibense/Fairy-DSH 的 Apache-2.0 改编图形保留原 NOTICE、源提交和修改说明。两种代码许可都不转授游戏角色、商标、合成声音或模型权利。原创程序合成开场 SFX 保留，非游戏采样。
