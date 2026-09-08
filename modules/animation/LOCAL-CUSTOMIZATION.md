# LOCAL-CUSTOMIZATION.md — 集成 Fairy 桌面模块

当前仅 macOS 原生桌面。终端/像素实现、独占测试与旧 PTY 图形协议 smoke 已删除。
保留 `native/Fairy.swift` 的桌宠/开场/音频/休息提醒行为，`native/Startup.swift` 的
私有租约与 exec/job-control 不变量，以及所有 IPC/cache/settings 名称。
保留 SVG、idle-motion、240 PNG、manifest、离线生成器和美术预览；resvg 仅用于离线构建。
保留 Apache 归属、NOTICE、licenses 和适配研究快照，不将语音/音频统一授权。
命令反馈仅集成副本中文化；原始独立语音包不变。

后端命令已移除；旧 CLI 参数仅拒绝连接并提示迁移，不保留选择能力。
当前语义以模块 README、ANIMATION-CONTRACT 和集成根文档为准。

## 视觉来源与修改约束

Fairy-DSH 视觉适配基于提交 `d639887a386b0de6fef2e61c97dc268631854591`。
独立 SVG 几何/白色渐变、分层呼吸与旋转角点替代早期微弱摆动。
`assets/idle-motion.json` 是参数入口；6 秒帧资源闭合，呼吸 1.5s、旋转 12s，
分别调整自上游 1.44s / 15s。保留 NOTICE、LICENSES、完整 licenses、文件归属和
PNG/GIF 衍生范围。MIT 原创插件不能覆盖 Apache 适配范围。
[研究笔记](docs/FAIRY-DSH-RESEARCH.md) 记录适配前的分析，不是当前支持后端清单。
