# pi-fairy

为 Pi 提供 macOS 与 Windows 共享桌面 Fairy 与事件语音通知。中文命令帮助，桌面拖动与位置/大小记忆，全屏或简洁开场、统一告别、空闲动效与共享休息提醒。

> **包含全部 44 个语音模块 WAV**（含两段电子权限提示音），安装后无需本地模型或另行下载声音。原创代码/文档采用 MIT；Apache 视觉适配与合成语音另有边界，见 [许可证与素材说明](LICENSES.md) 和 [音频来源](docs/AUDIO-PROVENANCE.md)。资源完整不等于本机已通过真实音画测试。
>
> 仓库：<https://github.com/ymd-physics/pi-fairy>。

## 平台与依赖

- **桌面支持 macOS 与 Windows**。
  - macOS 依赖 AppKit、Swift 编译器与可用的 Xcode Command Line Tools/SDK；没有终端像素或矢量回退，没有 `mode` 或 `theme` 设置入口。外观自动跟随系统。
  - Windows 桌面是本仓库的 **Windows 移植分支**：用 C# / WPF（.NET Framework 4.x）重写为 `native/win/Fairy.cs`，由 Pi 在首次使用时用系统自带的 `csc.exe` 编译缓存；无需安装 Visual Studio、.NET SDK 或 Swift。进程间租约使用 **命名管道**（`\\.\pipe\pi-fairy-<用户>`）替代 unix socket。外观自动跟随系统应用深浅色。
- 静态/模拟检查参考环境：macOS **15.6.1 / arm64**；Windows **11 x64 / Node 24.15 / Pi 0.85.1 / .NET Framework 4.8**。这不是最低系统版本声明，也不是桌面/音画端到端认证。
- 正常运行使用预生成图像，不需要本地语音模型、Python 或光栅化工具。首次桌面使用可能编译原生程序；Windows 第一次使用会调用 `csc.exe` 编译，耗时约 1–2 秒。显式 `npm run prepare:desktop` 是可选的编译准备，会写本用户缓存，不应未经许可运行。
- 离线重建图片才需要开发依赖 `@resvg/resvg-js`；部分资源检查需要 Python/Pillow。依赖安装须另行批准。
- 语音：macOS 用 `afplay`，Windows 用 PowerShell 的 `System.Media.SoundPlayer`（WAV 为 32 kHz 单声道 PCM16，原生支持），Linux 代码含 `paplay`/`aplay` 路径但未验证。

## 安装

先读源码与许可证，并核对本机 Pi 的 `docs/packages.md`。Pi 0.85.1 的 Git 安装语法：

```sh
pi install https://github.com/ymd-physics/pi-fairy
```

这会使用网络，默认更改用户级 Pi 设置，并可能运行 npm 安装依赖；加 `-l` 是项目级设置，不应擅自选择。Git 安装默认省略开发依赖（自定义 `npmCommand` 时可能不同）。建议使用已存在的 tag/commit：在 URL 后加 `@实际发布引用`，不要把示意引用当成已存在版本。

**Windows 提示**：安装后首次 `/fairy-anim on` 会编译 C# 桌面程序。需要 .NET Framework 4.x（Windows 10/11 自带）。若失败，请检查 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 是否存在。

不要同时加载集成版、旧 `pi-fairy-animation`、独立 `pi-fairy-voice` 或内部模块入口。同一代码的不同副本不会按内容去重。迁移须先查看现有包和用户意图，仅定点替换获批条目，保留其他插件、设置和旧副本以便回滚。详见 [迁移](docs/INTEGRATION.md)。

### 给安装 Agent 的提示词

```text
请帮用户安装 https://github.com/ymd-physics/pi-fairy。

先检查操作系统和架构。当前桌宠支持 macOS 与 Windows；
其他系统不支持桌面（无终端动画回退），说明兼容性限制并停止安装。
若用户希望移植到其他系统，请先评估方案并征得同意，
不要直接执行平台命令或自行安装替代后端。

在 macOS 上，阅读项目 README、许可证与素材说明，以及当前 Pi 的包安装文档。
检查 Node.js、Pi、Swift/Xcode 工具链，并确认没有重复加载 Fairy 动画或语音插件。
在 Windows 上，确认存在 .NET Framework 4.x（%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe）；
首次启用桌面时会用 csc.exe 编译缓存 C# 桌面程序，无需 Visual Studio 或 .NET SDK。

向用户简要说明需要安装的依赖和配置改动，确认后再执行。
保留现有配置，不覆盖整个 settings.json，不删除旧包或终止正在使用的共享桌宠。
默认采用普通安装；提前于 Pi 界面播放开场动画的可选启动入口，
仅 macOS/zsh 支持，须单独说明并征得用户同意，不默认修改 shell 配置。

安装后检查动画资源、44 个语音文件和开场音效是否完整。
如有缺失或损坏，报告原因，不擅自生成或替换素材。
最后给出启动、常用命令、更新和卸载方法，并请用户确认实际画面与声音。
```

## 使用与行为边界

- `/fairy-anim help`、`/fairy-voice help`：中文只读帮助，不播放声音或启动桌面。
- `/fairy-anim on|off|toggle`：本 Pi 的桌面租约；其他 Pi 仍可持有共享桌面。
- `/fairy-anim welcome full|simple`：保存下一次新共享生命周期的开场模式，不立即重播。拖动位置与右键菜单大小全局保存。
- `/fairy-voice on|off|status`：本进程语音状态；**不控制共享桌面的欢迎、告别、休息提醒**。这些共享声音由桌面 owner 管理。
- [共享休息提醒](docs/REST-REMINDER.md)由同一个桌面 owner 调度；集成版不启用独立语音的旧每小时轮次。
- [语音通知与排障](modules/voice/README.md#通知投递与排障)：压缩、权限、上下文与额度等事件有投递边界。及时压缩开始通知需在 codex-compaction 前加载；额度通知需要另行提供 `usage:report` 的插件，本包不捆绑它。

普通插件从 `session_start` 启动，**不能保证在 Pi TUI 之前显示**。[可选 zsh 提前开场](docs/STARTUP-ENTRY.md)是独立、可撤销的窄兼容入口（仅 macOS/zsh），只确认软件 ready，不保证物理首帧。其守卫要求全局设置中恰好一个未过滤的本地包路径；普通 Git URL 安装不是已验证的提前入口配置。不自动改为本地路径或修改 shell。Windows 不提供提前入口。

## 开发与许可

源码资源通过模块相对路径定位，不需要作者工作目录或独立语音包。离线公共发行回归：

```sh
npm run test:public
```

该命令只用静态检查及 mock，不安装依赖、不启动桌面/播放器。原生测试需 Swift/SDK，光栅化测试需开发依赖；全量测试需要另行准备环境；测试范围见 [发行说明](docs/PUBLIC-DISTRIBUTION.md)。

[LICENSE](LICENSE) 授权 ymd-physics 的原创代码、测试和文档（含语音模块）为 MIT，Copyright 2026 ymd-physics。[LICENSES.md](LICENSES.md) 区分原创与改编：Chengzhibense/Fairy-DSH 的 Apache-2.0 改编图形保留原 NOTICE、源提交和修改说明。两种代码许可都不转授游戏角色、商标、合成声音或模型权利。原创程序合成开场 SFX 保留，非游戏采样。

## 部分参考与致谢

部分 Fairy 视觉素材与待机动画实现参考并改编自 [Chengzhibense/Fairy-DSH](https://github.com/Chengzhibense/Fairy-DSH)。感谢原作者的开源工作。具体改编范围、源版本与署名见 [NOTICE](modules/animation/NOTICE)；相关 Apache-2.0 许可证与原始声明均随仓库保留。

参考项目地址：<https://github.com/Chengzhibense/Fairy-DSH>
