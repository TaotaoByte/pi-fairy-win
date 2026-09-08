# Voice module (integrated pi-fairy)

Original code/docs: MIT, Copyright (c) 2026 ymd-physics. All 44 expected WAVs
listed below are bundled; no model or downloader is needed. Audio is not covered
by code MIT; see [audio provenance](../../docs/AUDIO-PROVENANCE.md).
The following describes direct-module rules. Install only the root entry: integrated lifecycle/rest
cues are owned by the desktop. See [public boundaries](../../docs/PUBLIC-DISTRIBUTION.md).

The module selects pre-generated static audio for
the lifecycle and warning states defined in [`../../FAIRY-VOICE-PLAN.md`](../../FAIRY-VOICE-PLAN.md).

The extension is observational only: it does not inject messages into context,
call a model at runtime, or alter agent/tool execution.

## Direct-module event design (not a bundled-audio promise)

- Process startup (opening pi from the terminal) — one of seven welcome
  recordings picked at random, never repeating the previous startup's choice
- Quitting pi — one of six farewell recordings picked at random, never
  repeating the previous quit's choice (spawned synchronously, played after
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

With resources present, off/on confirmation clips bypass mute. If resources
are missing they silently do not play; commands still report mute state textually.
```

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
