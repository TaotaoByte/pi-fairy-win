# 公共发行：资源、安装与验证

## 当前资源契约

包内提供全部 44 个语音模块 WAV（含两个电子权限反馈音）、240 帧预生成 PNG 和原创
`sfx-v4.wav`。语音清单与 SHA-256 在 `modules/voice/provenance.json`；组合测试校验
44 个文件、RIFF/WAVE 头、长度、逐文件哈希及源码引用覆盖。不是空声音占位或按需下载。
普通播放不需要模型、Python 或图片构建依赖。音频权利边界见 [AUDIO-PROVENANCE](AUDIO-PROVENANCE.md)。

所有运行资源基于 `import.meta.url` / 模块路径定位，原生启动接收计算后的资源路径。
无需本机单独的 pi-fairy-voice 目录，也不依赖作者的单仓库目录。

如果用户删除/损坏资源：TS 语音选择器会过滤不存在的文件；无候选时在播放器调用前返回。
`test success` 不报告缺资源，`on`/`status` 只表示静音状态。权限/压缩等事件不会因此阻塞
代理执行。缺文件不等于完整可用；可用性不能只看命令反馈。
Swift `LifecycleAudio` 在选择可读文件前清空 pending，无候选则返回；没有正在运行的播放器时
立即 idle，因此代码上的视觉结束等待不会单因缺音频挂起。此结论为源码检查，**不是原生执行证明**。
共享休息视觉仍按桌面时钟处理；全屏开场 SFX 与语音独立，不因语音文件缺失而自动静音。
历史 display-cancel / missing-welcome 六秒退出失败仍未解决，见 [已知风险](DESKTOP-INTRO.md#acceptance-and-known-risk--2026-09-06)。

## 安装边界

支持的桌面平台仅 macOS。检查环境为 macOS 15.6.1 arm64、Node 24.19.0、Pi 0.85.1；
这不是最低版本声明。需要 Swift/CLT/SDK，首次桌面可能编译用户缓存；预生成图像可直接使用。
本次只核对已安装 Pi 的完整 `docs/packages.md` 与 README、quickstart 交叉引用。
普通 Git 安装语法见根 README；默认用户级设置，`-l` 为项目级；Git 包默认 npm install
省略 dev 依赖，自定义 npmCommand 时可能不同。没有实测网络安装、依赖解析或全新主机启动。
`private: true` 仅防误发 npm，不妨碍 Pi Git 安装。锁文件不是安装成功证据。

普通插件在 `session_start` 后启动；可选提前入口需要独立准备缓存与全局未过滤本地路径。
Git URL 设置不符合该守卫；不得自动改本地路径或 shell。见 [STARTUP-ENTRY](STARTUP-ENTRY.md)。
非 macOS 安装 Agent 必须先识别平台并停止桌面安装，不先调用 macOS 工具或自动移植。

## 测试矩阵

| 命令 | 范围与限制 |
| --- | --- |
| `npm run test:public` | 语音规则 mock、动画帮助 fake client、组合入口、44 WAV 完整性、缺资源命令回归、Swift 缺资源静态断言；不启动播放器或 GUI |
| `npm run test:voice` | 本地 mock 规则；host-boundary 用例需显式 PI_VOICE_TEST_HOST，否则有明确 skip；不依赖独立语音包 |
| `npm run test:composition` | 公共树组合测试；假 exec 只校验音频路径/格式，不播放 |
| `npm run test:animation` / `npm test` | 还有 Swift 编译、原生 fixtures、临时目录、resvg 开发依赖等要求；未完整执行，不能承诺全绿 |
| `prepare:desktop`、`test:startup-entry`、`smoke:desktop` | 编译缓存 / helper / 可见桌面等副作用；不是默认安装验收，本次未执行 |
| `build:frames`、`check:assets`、`check:effects` | 离线开发/图像检查；可能需要 resvg、Python/Pillow；本次不下载依赖 |

安全子集的成功不是实际扬声器、物理首帧、输入、显示器切换、休眠恢复或 native 退出认证。
