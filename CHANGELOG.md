# 发布说明

## 0.7.1-windows（本仓库移植）

- **新增 Windows 桌面支持**：用 C# / WPF（.NET Framework 4.x）重写 `native/Fairy.swift` 为
  `native/win/Fairy.cs`，由系统自带的 `csc.exe`（C# 5，无需 Visual Studio / .NET SDK）首次使用时
  编译并缓存到 `%LOCALAPPDATA%\pi-fairy\`。窗口、右键尺寸菜单、拖动位置、双主题帧、涟漪动效、
  休息提醒和生命周期音效均保留；进程间租约改用**命名管道**（`\\.\pipe\pi-fairy-<用户>`）。
- **语音 Windows 播放路径**：新增 PowerShell `System.Media.SoundPlayer`，与 macOS `afplay` 并存。
- `privateDirectory()`、`buildHelper()`、`cachedNativePath()`、`connectLease()` 与 `requestWelcome()`
  按平台分支；macOS 的 Swift/unix-socket 路径不变。
- 测试：POSIX 专属（unix socket、fd 传递、`/tmp`、Swift 编译）自动跳过；新增 `desktop-win.test.ts`
  覆盖命名管道地址、C# 编译、离线开场设置与实盘租约协议。公开回归在本机全绿。
- 开场提前入口（zsh prelude）仍仅 macOS；Windows 不提供，不冒充安装回退。

## 0.7.0

- macOS 专用共享桌面；中文动画/语音命令帮助与反馈，无终端回退或 theme 命令。
- full/simple 开场选择、位置与大小持久化、统一告别及空闲动效。
- 共享桌面休息提醒；语音权限、压缩、静音与重载行为修正。
- 普通插件安装与可选 zsh 提前入口分离，后者不保证物理首帧。
- 保留 Apache-2.0 图形来源、修改记录与原创程序合成 SFX；按作者指示纳入全部 44 个语音模块 WAV，原样复制。原创代码/文档（含语音模块）为 MIT；音频另列来源与权利边界，不把分发指示当作第三方授权。

版本号不保证同名 Git tag 存在；安装时请选择仓库中实际存在的引用。
