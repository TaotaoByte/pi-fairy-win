# 资源完整性与排障

包内包含 **44 个语音模块 WAV、240 帧 PNG、原创开场 SFX**；无需模型、下载器或作者目录。
语音文件名及哈希见[provenance.json](../modules/voice/provenance.json)，[音频权利边界](AUDIO-PROVENANCE.md)独立于代码许可。
只加载根 `index.ts`，普通安装与平台依赖见 [README](../README.md)。`private: true` 防误发 npm，不禁止 Pi Git 安装。

## 常见问题

- **桌面不出现**：仅支持 macOS 交互式 TUI，子代理不连接。检查 Swift/CLT/SDK 和中文错误提示；
  首次可能异步编译。修复 SDK 后 `/reload`，连接错误可 off/on 重试。无终端回退。
- **更新仍是旧行为**：reload 不替换存活的共享 helper；正常释放所有 Pi 桌面连接，等告别结束再重启。
  不强杀其他会话或删除状态。见[迁移/回滚](INTEGRATION.md)。
- **开场晚于 TUI**：普通插件的 `session_start` 时机如此；[可选提前入口](STARTUP-ENTRY.md)须独立启用。
- **语音没响**：检查本 Pi 静音、系统输出及文件完整性；低优先级可能被丢弃，声音不重试。
  on/status 仅表示静音状态，test success 不诊断缺文件。不要自动下载、生成或替换损坏资源。
  权限/额度需要对应事件提供者，压缩通知受加载顺序影响，见[语音排障](../modules/voice/README.md#通知投递与排障)。
- **静音后仍有声音**：共享欢迎、告别、SFX 和休息提醒不受 per-Pi 静音控制。
- **退出/连接慢**：视觉退场与播放需完成；显示取消/缺欢迎文件的[已知退出风险](DESKTOP-INTRO.md#已知退出风险)尚未解决。

缺失声音时 TS 选择器过滤不存在文件，无候选则不调用播放器，不阻塞代理执行。
原生生命周期选择失败按静音处理；SFX 独立，不随缺少欢迎语自动静音。
这不等于原生退出已获验证，资源损坏应停止安装并报告。

## 验证命令与限制

从包根目录运行，先自行准备所需环境：

| 命令 | 范围 / 副作用 |
| --- | --- |
| `npm run test:public` | mock 语音规则、帮助、组合入口、WAV 哈希/格式、缺资源路径及原生静态断言；不启动桌面/播放器 |
| `npm run test:voice` | mock 规则；host-boundary 用例需显式 `PI_VOICE_TEST_HOST=/absolute/path/to/pi-coding-agent`，否则 skip；只读宿主 runner，不启动 Pi |
| `npm run test:composition` | 组合入口与资源检查，假播放器不播放 |
| `npm test` / `npm run test:animation` | 包含原生 Swift fixtures，需 macOS SDK；部分检查需 resvg 开发依赖，不能视为无 GUI 的安全子集 |
| `npm run prepare:desktop` | 编译本用户临时缓存，不启动桌面 |
| `npm run test:startup-entry` | 私有 headless 原生 fixtures 与 PTY，编译但无真实音画 |
| `npm run smoke:desktop` | 显式 GUI smoke，会显示桌宠 |
| `npm run build:frames` / `npm run check:assets` / `npm run check:effects` | 离线图像构建/检查，可能需要 resvg、Python/Pillow；build 会改生成资源 |

模拟测试不是实际 Git 安装、全新主机加载、扬声器、物理首帧、输入路由、多屏或休眠恢复认证。
最低 macOS/Node/Pi 与其他架构兼容范围尚未确证；不要将命令列出等同于全量测试通过。

## 来源记录

公开文档省略内部设计计划、研究笔记、实施日志与发布检查表；用户行为和限制保留在使用指南中。
视觉修改归属仍在完整 NOTICE、文件头与 LICENSES 中，未因省略研究笔记而改变。
语音 `source-package.json` 保留 0.2.29 的来源描述与原始入口信息，仅将文件清单对齐公开树；
它不是另一个安装入口。`provenance.json` 的实现/测试及 WAV 哈希保持原值，不覆盖后续文档修订。
历史设计文档的既有 MIT 授权不因公开树省略而撤回，也不扩展到第三方声音权利。
