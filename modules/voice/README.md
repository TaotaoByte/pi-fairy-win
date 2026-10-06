# Voice module (integrated pi-fairy)

Original code/docs: MIT, Copyright (c) 2026 ymd-physics. All 44 expected WAVs
listed below are bundled; no model or downloader is needed. Audio is not covered
by code MIT; see [audio provenance](../../docs/AUDIO-PROVENANCE.md).
The following describes direct-module rules. Install only the root entry: integrated lifecycle/rest
cues are owned by the desktop. See [public boundaries](../../docs/PUBLIC-DISTRIBUTION.md).

Playback paths: macOS uses `afplay`, Windows uses PowerShell's
`System.Media.SoundPlayer` (the bundled 32 kHz mono PCM16 WAVs are natively
supported), Linux falls back to `paplay`/`aplay` (unverified).

The module selects pre-generated static audio for the events listed below.

The extension is observational only: it does not inject messages into context,
call a model at runtime, or alter agent/tool execution.

## Direct-module events

- Process startup (opening pi from the terminal) — one of seven welcome
  recordings picked at random; variant memory is in-process only
- Quitting pi — one of six farewell recordings picked at random
  (spawned synchronously, played after
  the session teardown)
- Each accepted user prompt, 0.5 seconds after its agent task starts
- Manual model changes (`set`/`cycle`, excluding startup restore)
- `/resume` session switches and `/new` sessions (excluding startup, reload, and fork)
- Permission phase and other blocking UI prompts
- Distinct immediate effects for human permission approval and denial
- Settled success (one of three recordings at random, no consecutive
  repeat), network error, general error, or abort
- Network retry lasting at least five seconds
- Context usage crossing 80%
- Compaction in progress: manual `/compact` and automatic
  (threshold/overflow, including the codex-compaction native path — same event chain)
- Successful compaction
- Standalone compaction failure
- Percentage quota crossing 10%, using reports already fetched by `pi-usage-ym`
- Hourly stretch reminder while pi is open: one of three activity recordings at
  random (never repeating the previous hour's choice), then a native pi dialog
  ("好，去活动一下。" / "再工作一会儿。"). Choosing the work-again option
  re-arms in five minutes; Esc or an unanswered ten-minute window skips the
  round until the next hour. The dialog never enters context or blocks the
  agent; it defers while permission or other dialogs are open and retries
  (five-second polling) inside the ten-minute window if displaced. The
  one-hour countdown restarts on every session start and is cancelled on
  shutdown

Playback uses priority-based preemption (`high > medium > low`). A new equal-
or higher-priority notice interrupts the current Fairy player; lower-priority
notices are dropped. Interrupted clips are not resumed, and unrelated system
audio is never affected.

Final outcomes are mutually exclusive and follow this precedence:

```text
network error > general error > abort > success
```

## Command

```text
/fairy-voice list
/fairy-voice test success
/fairy-voice test permission
/fairy-voice test activity   # one full reminder round: voice + dialog, live schedule untouched
/fairy-voice off            # mute everything in this process (aborts active clip, then says 语音模组已禁用。); new pi processes start unmuted
/fairy-voice on             # unmute (says 语音模组已加载。)
/fairy-voice status         # report current state
```

With resources present, off/on confirmation clips bypass mute. If resources
are missing they silently do not play; commands still report mute state textually.

## Audio files

Expected under `sounds/`:

```text
welcome-1.wav
welcome-2.wav
welcome-3.wav
welcome-4.wav
welcome-5.wav
welcome-6.wav
welcome-7.wav
goodbye-1.wav
goodbye-2.wav
goodbye-3.wav
goodbye-4.wav
goodbye-5.wav
goodbye-6.wav
activity-1.wav
activity-2.wav
activity-3.wav
task-start-1.wav
task-start-2.wav
task-start-3.wav
task-start-4.wav
model-switch.wav
session-switch.wav
new-session.wav
permission-1.wav
permission-2.wav
permission-3.wav
permission-approved.wav
permission-denied.wav
input.wav
success-1.wav
success-2.wav
success-3.wav
network-error.wav
error.wav
aborted.wav
retry.wav
context-warning.wav
compaction-failed.wav
quota-warning.wav
compact-auto.wav
compact-manual.wav
compact-success.wav
voice-off.wav
voice-on.wav
```

## 通知投递与排障

集成安装只使用根入口：自动欢迎/告别/休息提醒属于共享桌面，不受 per-Pi 静音影响；
此页列出的 direct-module 小时对话框在集成版中不启用，`test activity` 也不会启动它。
集成静音跨 reload/会话替换保留，新进程默认开启；直接注册模块的默认静音只在实例内保留。
随机防重复按类别记录，但不持久化到新进程或共享 helper 生命周期。

- 若使用 `pi-codex-compaction`，应让 **pi-fairy 在它之前加载**，否则开始通知可能等远程工作结束才收到，
  随即被完成提示中断，或因取消而未收到。只在用户批准后定点调整顺序，不覆盖其他设置。
- 快速压缩、同级/更高优先级通知仍会中断开始语音；不保证每条声音完整可听。
  空闲手动取消按压缩失败处理；自动失败的提示受 `!willRetry && ctx.isIdle()` 条件限制。
- 权限请求按连续等待阶段去重；匹配的人工批准/拒绝立即中断请求语音并播电子音，
  自动策略允许不播放确认音，非人工失败不伪装成人工拒绝。需要宿主/权限扩展提供相应事件。
- 额度通知需要另一个插件提供 `usage:report`（例如独立安装的 pi-usage-ym），本包不捆绑它；
  同一额度周期/种类去重。上下文提示在跨越 80% 时触发，压缩后降到阈值以下才重置。
- 事件处理仅观察，不注入上下文、不调用模型、不改变工具执行。声音丢失不代表任务或权限状态改变。

代码规则 mock 与 Pi 0.85.1 的只读宿主接口检查不认证真实权限 UI、远程压缩或播放时序。
资源损坏、平台播放器与验证命令见[排障指南](../../docs/PUBLIC-DISTRIBUTION.md)。
