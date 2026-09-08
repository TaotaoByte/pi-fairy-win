# Integrated voice audit — Pi 0.85.1

## Compaction delivery requires observer-first load order

Load the integrated `pi-fairy` package **before**
`npm:@ogulcancelik/pi-codex-compaction` in the effective extension order.
Keep standalone voice disabled. This is a reviewed configuration prerequisite,
not a setting changed by the extension or its tests. Preserve every other
package entry and back up settings before a targeted reorder.

Source proof from the installed Pi 0.85.1 distribution:

- `dist/core/package-manager.js:702–713` collects configured packages in order;
  `dist/core/extensions/loader.js:498–515` loads paths sequentially.
- `dist/core/extensions/runner.js:623–660` awaits each `emit` handler in extension
  order. `cancel:true` returns immediately; a custom compaction result does not.
- Installed codex-compaction `index.ts:223–269` awaits remote checkpoint creation
  inside `session_before_compact`, then returns its custom summary, or cancels.
- Pi `dist/modes/interactive/interactive-mode.js:2465–2468,5518–5521` routes
  `/compact` to `AgentSession.compact`. `dist/core/agent-session.js:1496–1555`
  emits before/success for manual compaction. Automatic threshold/overflow uses
  the separate `_runAutoCompaction` path (`1757–1842`), with the same hooks.

With codex first, Fairy receives the start event **after** remote work. The
immediately following success event preempts the start clip under the approved
same-priority policy. Cancellation in codex skips Fairy's start handler entirely.
The standalone and integrated start handlers were identical; this is an
extension-order interaction, not an integration-code regression or a missing
current-host event name. Earlier standalone load order/host history was not
reconstructed, so the reported earlier audible behavior is not disproved.

With Fairy first, the observer starts its clip before remote work and returns
`undefined`. No compaction result, cancellation, model request, or execution
order is changed. Fast compaction or an already-playing higher-priority cue can
still preempt/drop speech: audible completion of every clip is not guaranteed.
No undocumented `compaction_start` subscription, plugin internals, delayed
success, or runtime reordering is used. `compaction_start` is an AgentSession
subscriber event, not the public extension hook.

Manual failure/cancel clears host compaction state before
`session_compact_failed` (`agent-session.js:1573–1594`), allowing the existing idle
failure cue to terminate start speech. Automatic failures can arrive while busy;
existing `!willRetry && ctx.isIdle()` gating remains unchanged, and a start clip
can finish naturally rather than be stopped. The public failure event includes
`aborted`; existing voice treats an idle manual cancellation as compaction failure.
No stronger failure/cancel distinction or automatic failure guarantee is added.

The optional permanent startup entry checks that the integrated root occurs
exactly once as an unfiltered package string (`native/Startup.swift:49–82`). It
does not require a package index. Swapping only Fairy and codex-compaction leaves
that eligibility unchanged; it does not alter a live helper or replay an intro.

## Evidenced inherited rule defects corrected locally

- Category variants used one shared last filename: an intervening different
  category erased no-repeat memory. Track the previous choice by sound category.
- A recovered `agent_end` returned before clearing an outstanding network retry
  timer. Queued continuation could keep `isIdle()` false and produce stale retry
  speech. Clear the timer on each new terminal outcome before deciding to rearm.
- Muting an open hourly activity dialog aborted it after setting its phase idle;
  its continuation returned without scheduling the next hour. Rearm on that mute
  path just as for a deferred round.
- Pi reload/session replacement recreates factories (`agent-session.js:2217–2238`),
  resetting closure-local mute. Root registration now opts into a narrowly named
  process-global mute object, read at output/command boundaries. A disposed old
  command cannot write it. Fresh processes start unmuted; no disk, environment,
  session entry, or shared desktop mute is introduced. Default direct-module
  registration retains instance-local mute and its existing quit behavior.

The standalone package and all audio bytes remain untouched. Historical copied
module docs describe its default mode; this document and LIFECYCLE-AUDIO.md govern
integrated behavior. No cross-process random-choice persistence is claimed.

## 当前公共发行验证边界

上述规则来自源实现及 Pi 0.85.1 的接口检查，不是实时播放认证。
公开树提供 44 个 WAV。`npm run test:public` 验证 WAV 哈希/格式、缺文件安全路径和组合入口；
`npm run test:voice` 中规则测试使用 mock，installed-host 检查需显式设置
`PI_VOICE_TEST_HOST` 到本机 Pi 包目录（读取 runner 的 emit 方法，不启动 Pi）。
它不依赖其他独立语音源码目录，也不证明远程压缩、权限弹窗或真实语音时序。
完整范围见 [PUBLIC-DISTRIBUTION.md](PUBLIC-DISTRIBUTION.md)。
