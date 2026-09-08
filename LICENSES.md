# 许可范围 / License scope

原创代码、测试、文档（包括 `modules/voice/`；历史语音设计文档的既有 MIT 授权不因省略而改变）由作者
**ymd-physics** 确认为自己的原创作品，采用 [MIT](LICENSE)，Copyright (c) 2026 ymd-physics。
这不是把第三方改编作品重新声明为原创，也不是语音素材的公开授权。

| 范围 | 许可 / 边界 |
| --- | --- |
| 原创 Pi 集成、动画运行逻辑、语音代码、测试、文档、构建工具 | MIT；Apache 标注部分除外 |
| 原创程序合成 `modules/animation/assets/intro/sfx-v4.wav` 与生成器 | MIT；非游戏采样，见 [SFX 来源](modules/animation/assets/intro/README.md) |
| Fairy-DSH 改编代码、视觉设计及 PNG/GIF 衍生素材 | 保留 Apache-2.0；见动画模块 [LICENSES](modules/animation/LICENSES.md)、[NOTICE](modules/animation/NOTICE) 及 [完整许可证与上游声明](modules/animation/licenses/) |
| 44 个语音模块 WAV（含 2 个电子权限反馈音） | 按作者明确分发指示收录；不在代码 MIT / Apache 授权内。来源及权利边界见 [音频来源](docs/AUDIO-PROVENANCE.md)，不虚构独立音频许可 |
| 第三方角色、名称、商标、声音人格、模型与官方素材 | MIT / Apache 不转授这些权利；不暗示官方认可 |
| 依赖 | 各自许可证，不能由本项目统一转授 |

视觉适配来源为 Chengzhibense/Fairy-DSH，提交
`d639887a386b0de6fef2e61c97dc268631854591`。完整原始 notices、修改说明与归属保持不变。
原创实现与 Apache 适配的逐文件边界以动画模块声明及文件头为准。

历史说明：独立语音 0.2.29 的 `source-package.json` 没有 license 字段；这是保留的源元数据，
不是当前原创语音代码/文档的授权阻碍。当前 MIT 来自作者明确授权，而非从缺失字段推断。
该代码授权及作者收录音频的指示不等于第三方角色声音权利已获清理。使用与验证边界见 [PUBLIC-DISTRIBUTION](docs/PUBLIC-DISTRIBUTION.md)。
