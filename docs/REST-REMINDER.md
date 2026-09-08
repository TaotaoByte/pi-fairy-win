# Shared desktop rest reminder

Integrated desktop Fairy alone owns one awake-elapsed schedule. It starts once
when the pet is first visibly ordered with nonzero alpha (not lease qualification
or the full intro's cover). One hour later, after intro/lifecycle playback finishes,
a non-key/non-main HDD-inspired panel appears beside Fairy. No input surveillance,
keyboard monitor, Accessibility permission, work detection, or persistent reminder
setting is used. This measures an **awake desktop lifetime**, not hours worked.

The panel has no close/ignore/timeout/outside-click dismissal. It stays unresolved
until an explicit choice, including across sleep and long periods without response:

- **稍后 · 5 分钟**: next reminder five awake minutes from the click.
- **去休息 · 1 小时**: next reminder one awake hour from the click.

Both response buttons are silent. Existing permission approval/denial effects do
not mean “later/rest”; goodbye-6 implies departure/unbinding and is not reused.
On presentation the shared owner attempts one available activity-1..3 recording,
avoiding its previous activity variant when alternatives exist. Existing phrases:
1. 健康提醒：主人已连续工作一小时。请起身活动，保护肩颈。
2. 主人，该活动一下身体了。Fairy可不想您变成一座雕像。
3. 主人，我可是不用休息的超级人工智能。但您这具称不上健康的肉身，还是活动一下为好。

The first phrase is inherited wording, not evidence of work/input monitoring.
Audio bytes are unchanged; missing/unreadable/failed audio never blocks the panel
or countdown. Measured durations are 5.83s/4.63s/8.09s. Activity alone has a **9s**
player budget; welcome/goodbye retain **8s**, with the existing TERM/200ms/KILL
main-loop enforcement, not a hard end-to-end launch/shutdown guarantee. The same
native player prevents native overlap: intro/lifecycle defer presentation, goodbye
preempts activity and committed retirement closes the prompt and cancels forever.
Independent per-Pi task/permission/etc. clips remain independently prioritized.

`mach_absolute_time` with `mach_timebase_info` counts awake time, excluding OS
sleep (SDK `mach/mach_time.h` contrasts `mach_continuous_time`, which advances during
sleep). No wake replay or skipped unanswered round exists. A defensive nondecreasing
clock clamp prevents injected clock rollback from accelerating the next reminder.
New clients, reload, prelude claim and zero-client grace retain the same schedule
and unresolved panel. Committed retirement ends it; a new shared lifetime gets a
new clock. Restart all old desktop leases normally before activating changed code;
no live helper/cache operation is part of this change.

## Interaction chrome and launch boundaries

The rest panel follows pet movement/resize notifications and clamps to the screen.
The existing right-click size menu uses the same cool-blue charcoal, gray/white
text, thin border, muted ice-blue selection/hover and subdued failure color.
Pending-save/retry behavior and menu outside/right-click dismissal are unchanged.
When both are open the menu fits into the largest nonoverlapping screen strip;
on small screens only the menu scales to preserve all rows. Offscreen geometry
checks cover 640×480 and offset 1920×1080 screens. Extremely small/atypical virtual
displays and perceived readability remain physical acceptance limits.
No pet artwork, idle effects, intro appearance/timing/SFX, saved preferences or
terminal theme changed.

Both normal DesktopClient and pre-TUI Startup explicitly pass `--rest-reminder`
with the integrated sounds path. Raw animation-only launches do not. Native
headless/test/diagnostic invocations reject that flag before IPC/GUI/audio resource
creation; tests inject the production schedule/player and render NSViews offscreen.
Integrated voice sets `activityReminders: false` (default true): neither the legacy
per-Pi timer nor `test activity`/`test activity_reminder` creates a dialog or audio.
The commands explain shared ownership and do not replay or alter its schedule.
Desktop-disconnected use therefore has no reminder. Direct module registration and
the independently distributed standalone voice package is not part of this repository.
Per-Pi `/fairy-voice off` does not mute shared rest or lifecycle cues.

## Silent evidence

`modules/animation/tests/rest-reminder.test.ts` executes production Swift schedule,
audio owner, geometry and view definitions with a fake awake clock, recording-only
executable, missing assets, long unanswered intervals, duplicate choices, rollback,
first/next hour, five-minute rearm, reconnect-equivalent visibility and retirement.
It exports menu/prompt normal/hover/warning previews at 1x/2x when
`FAIRY_REST_EVIDENCE` points to a private scratch directory. Existing private IPC,
startup handoff, intro offscreen and integrated/default voice tests cover adjacent
boundaries. Fake awake time validates scheduling, not physical OS suspension;
NSView rendering is not WindowServer/focus/Spaces/dragging or speaker acceptance.
Historical six-second exit failures remain owner-deferred and are not this gate.
