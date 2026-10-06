# 发布说明

## 0.7.2-windows

- **修复拖动鬼畜**：拖动不再用 `MouseEventArgs.GetPosition`（坐标相对于鼠标捕获的元素，窗口一动就把位移反馈给下一帧，导致抖动）。改用 Win32 `GetCursorPos` 的屏幕绝对坐标 + 拖动起点固定锚点，窗口 1:1 跟随鼠标，不会自激。
- **修复退出后桌宠不消失**：新增共享 owner 的租约计数与 3 秒宽限退场（对应 macOS 的 flock 语义）。最后一个 Pi 断开后播放告别并退出；宽限内重连不闪烁。
- **修复多实例重复桌宠**：用用户级命名 mutex（`Local\pi-fairy-<用户>`）保证单 owner，第二个 helper 自动退出，进程崩溃时由 OS 释放。
- **修复动效面板抢输入**：effects 窗口改为宠物窗口的 owned window 并加 `WS_EX_TRANSPARENT|WS_EX_NOACTIVATE`，点击穿透到宠物，不再吞掉拖动/右键。
- **修复主题轮询**：`Dark()` 之前每 50ms 读一次注册表，现改为缓存、最多每秒刷新两次。
- **修复多屏与边界**：位置改用虚拟桌面坐标（支持副屏），拖动结束与缩放后夹紧到屏幕内；尺寸菜单跟随拖动。
- **新增 `--self-test`**：无窗口的确定性回归测试，覆盖拖动数学（1:1、单调无振荡）、涟漪重绘窗口有界、设置读写回环；已接入 `desktop-win.test.ts`。

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
