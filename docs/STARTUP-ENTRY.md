# 可选 zsh 提前开场

这是独立、可撤销的 **zsh 函数**，不是替换 Pi 可执行文件、宿主补丁、守护进程或安装钩子。
普通插件在 `session_start` 启动，不能保证早于 TUI；本入口仅在下述窄条件下等 Fairy
**软件 ready 后再 exec Pi**。软件绘制/排序确认不是物理首帧或音画同步认证。

## 显式准备、启用与撤销

1. 正常释放所有旧桌面租约，让旧 helper 完成退出；不要删除或强杀活跃 helper。
2. 在包根目录显式运行 `npm run prepare:desktop`。需要 macOS Swift/CLT/SDK；
   它只编译两个源代码/架构哈希命名的原生程序到私有 `/tmp/pi-fairy-UID/`，不启动窗口、租约或声音。
   重启/清理可能删除缓存；缓存缺失时提前入口回退普通 Pi，需重新准备，不自动编译。
3. 用户自行在交互式 zsh 中执行 `source /absolute/path/to/pi-fairy/modules/animation/scripts/startup.zsh`。
   请使用实际本地 checkout 路径。**不自动修改 `.zshrc`**；持久 source 须单独决定。
   不要未经检查覆盖已有 `pi` 函数或 alias。
4. `command pi ...` 始终绕过函数；`unfunction pi` 从当前 shell 撤销。
   如自行添加过 shell 配置，只删除对应 source 行，不覆盖整个配置。

函数每次从当前 PATH 解析外部 `pi`，不固定 nvm 版本路径。只读识别包名及声明的 `bin.pi`；
未知 wrapper/目录布局正常委托，不修改宿主。Pi 更新不覆盖此包或函数，但未来配置/协议变化可能
需要重新检查可选入口，不承诺无限版本兼容。

## 支持条件与回退

仅支持 macOS 下**无参数、前台、交互式 `pi`**，三个标准流均为 TTY，且两个精确版本的
原生程序已缓存。任何参数（含 help/version、管理命令、RPC/print、`-ne`、未知参数）原样绕过。
非 TTY、子代理、agent-dir/package-dir override、NODE_OPTIONS 调用也绕过，不解析 Pi CLI。

守卫只读 JSON，不加载扩展、不联网、不安装资源、不写设置：

- 全局 `packages` 必须恰好一次以**未过滤字符串本地路径**包含集成根目录；相对路径按
  `~/.pi/agent` 解析。普通 Git URL 安装不满足此条件，勿自动换为本地路径。
  package object/filter 形式、全局 `extensions` override 保守回退，其他字符串包由 Pi 处理。
- 根 manifest 必须只注册 `./index.ts`。
- 项目 `packages/extensions/skills/prompts/themes` 列表必须不存在或为空；项目中不可有实际
  `.pi/extensions`、`skills`、`prompts`、`themes`，也不可有祖先项目 `.agents/skills` 目录。
  仅有 `.pi/npm` 缓存或空 `packages` 列表不影响资格。
- 普通 model/theme/changelog 设置无关；相关配置损坏或有歧义时回退。
  恢复兼容配置后自动恢复资格，不需要全设置哈希或重新授权。

这不是完整 Pi 资源解析器；其他扩展仍可能失败，ready 不等于插件一定成功注册。
正常 Git 安装、改为本地包路径、编译与 shell 激活应分别批准。

## 等待、接管与失败

缺缓存/不支持配置立即委托普通 Pi。连接与 ready 等待总预算 **1.5 秒**，只在私有 UID 目录工作；
已有或不可访问 socket 不会被删除、替换或强制升级。必要时通过短命 trampoline 启动缓存 helper；
超时只清理自己未持租约的 trampoline，不杀共享 helper，不创建代理 Pi 进程。

`prelude FAIRY2` 获得临时租约；旧 helper 不将它算作有效连接，因此可回退普通启动。
已开场的同一生命周期只确认现状，不重播；退场中/不兼容 owner 回退。
随后以同进程 `exec` 外部 Pi，保留前台进程组、stdio、终端与 job-control。
继承的 socket/token 供集成会话 handler claim，没有刻意的零租约间隙或第二份连接。

临时租约从原生接受起 **15 秒**内未 claim 则过期；EOF、exec 失败、无效 claim 或普通退出也释放。
启动过慢/扩展禁用或失败可丢失提前开场，随后回到普通插件路径；不保证失败启动或 OS 挂起期间
连续播放。claim 后沿用正常[共享生命周期与宽限](LIFECYCLE-AUDIO.md)。

不抢键盘焦点，打字/Ctrl-C/Ctrl-Z 保留终端语义。full 遮罩仍吸收鼠标且无 SKIP；
simple 鼠标穿透。两种模式回到保存位置，详见[开场与限制](DESKTOP-INTRO.md)。
[休息计时](REST-REMINDER.md)从实际可见 Fairy 开始，不从临时租约或全屏遮罩开始。

## 验证边界

`npm run test:startup-entry` 使用私有 headless 原生 fixtures、假 Pi 可执行文件与 PTY，
需编译但不访问用户 helper/偏好、不显示真实窗口或播放音频。它检查 ready/claim、租约过期、
保守回退、PATH 与终端信号，不认证 WindowServer、物理首帧或实际 Pi 安装。
[已知退出延迟风险](DESKTOP-INTRO.md#已知退出风险)仍适用，不能用提前入口测试当作已修复证明。
