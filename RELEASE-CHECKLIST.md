# 发布检查 — 完整资源候选，待独立审核

## 已确定的发行范围

- [x] 作者确认原创代码/测试/文档（包括语音模块、语音设计文档）为自己的作品，采用 MIT，Copyright 2026 ymd-physics。历史 voice 元数据缺 license 字段不再是代码授权阻碍。
- [x] 保留 Apache-2.0 视觉适配、衍生图片、完整 Fairy-DSH notices、源提交与修改归属；不将其冒充原创 MIT。
- [x] 按作者最新明确指示纳入全部 44 个语音模块 WAV（含 2 个电子权限反馈音），逐字节复制。旧排除方案已被取代；不下载、重生成或放入假声音。
- [x] [音频来源](docs/AUDIO-PROVENANCE.md) 区分分发指示与第三方权利清理：不将语音纳入代码 MIT，不虚构音频授权/禁止条款。模型与参考录音不打包。
- [ ] 公开前审阅仍未确证的第三方角色声音/模型/参考录音权利风险；作者的分发指示不消除此风险。

## 包装与验证

- [x] 运行 TS/Swift/脚本保持源字节；候选仅文档、元数据及公共树组合测试调整，不改源安装包。
- [x] 44 WAV、原创 SFX、240 帧图像完整；使用模块相对资源路径，无独立语音包依赖。
- [x] 元数据保持 `private: true` 与分范围许可证；Pi 只发现根 `index.ts`。Git 不执行 npm files allowlist，需全树检查。
- [x] 根 README 提供中文普通 Git 安装与平台先行 Agent 提示词；提前 shell 入口独立审批，不自动改设置、安装依赖或移植。
- [x] 核对 Pi 0.85.1 完整 packages 文档及 README/quickstart；正常安装会联网、可能安装依赖和改设置，本次未执行。
- [x] `npm run test:public`：58 通过、1 明确 host opt-in 跳过、0 失败（59 项）；fake client/player，无 GUI/播放。包含资源 SHA-256/RIFF 与缺资源安全回归。
- [ ] 实际 Git 安装、依赖解析、全新主机加载及物理音画尚未测试，不能以 mock 代替。
- [ ] 全量动画/原生/启动入口/图像重建测试未执行；测试矩阵见 [PUBLIC-DISTRIBUTION](docs/PUBLIC-DISTRIBUTION.md)。
- [ ] 最低 macOS/Node/Pi 与其他架构未认证；仅记录 macOS15.6.1 arm64、Node24.19.0、Pi0.85.1 检查环境。
- [ ] 历史 display-cancel / missing-welcome 六秒退出失败保持未知风险，未声称修复；见 [DESKTOP-INTRO](docs/DESKTOP-INTRO.md#acceptance-and-known-risk--2026-09-06)。

## 最后发布门

- [ ] 独立 reviewer 按**完整 44 WAV 发行范围**检查许可措辞、来源、资源清单、私密数据扫描与测试证据。
- [ ] 经用户另行批准执行必要隔离安装/运行验证，并确认 tag/version 与远程发布操作。0.7.0 不代表已有公开 tag。
- [ ] 本次没有 staging、commit、push、凭据操作或用户设置修改；本地审计与恢复快照不属于公共仓库。
