# Shared desktop lifecycle audio

The integrated root alone passes `automaticLifecycleCues: false` and
`processMute: true`, `activityReminders: false` to voice and
an absolute `modules/voice/sounds/` directory to animation. This suppresses only
automatic per-Pi startup/quit audio, not either session handler: timer/dialog/
player cleanup and permission/usage unsubscription still run. `/resume`, `/new`,
model, task, permission, compaction, usage and explicit
`/fairy-voice test welcome|goodbye` keep their existing behavior. Direct voice
module registration defaults to the original behavior. No standalone source,
global settings, sound bytes, artwork or animation sampler was changed.

The integrated [rest reminder](REST-REMINDER.md) now also belongs to the shared
owner, with no legacy per-Pi activity timer/dialog even in desktop-disconnected use.
Both normal and pre-TUI launches opt in with `--rest-reminder`; raw diagnostics
reject this option before resources. Activity playback uses a 9s budget to fit the
unchanged 8.09s activity-3 clip; the lifecycle budgets below remain unchanged.

## Scope and mute

- The integrated desktop starts one [saved full/simple opening](DESKTOP-INTRO.md)
  after its first validated interactive lease. Full welcome7 begins after HDD
  progress/materialization; simple chooses available welcome1–6 after central
  growth. More Pi clients do not replay it; commands affect only the next owner.
  Early final-lease loss or display interruption stops/suppresses welcome;
  normal grace and later farewell remain.
- Final desktop lease loss starts the existing 3-second grace. A valid client
  returning before retirement commits cancels it, with neither farewell nor
  another welcome. Reload/session replacement use this same lease mechanism.
- After grace the desktop performs the same local 0.95s expansion/shrink/fade
  for either welcome mode, alongside one farewell, even if
  the final Pi crashed or received SIGKILL. `/fairy-anim off` or switching the
  final desktop client off also ends this desktop lifetime, even if Pi
  itself remains alive. Integrated desktop-disconnected/noninteractive use has no
  automatic welcome/farewell. Subagents remain ineligible for desktop leases.
- **Shared desktop welcome/farewell/rest reminders are independent of per-Pi `/fairy-voice off`.**
  Mute continues to govern this Pi's other sounds, including
  across reload/session replacement; a fresh process starts unmuted. See the
  [voice audit](VOICE-AUDIT.md) for compaction load order and validation. Command
  help, off confirmation text and status explain the exception. There is no
  global mute setting or shared voice settings UI.
- Native lifecycle playback never overlaps another native lifecycle clip:
  farewell preempts unfinished welcome. It can overlap per-Pi notifications;
  existing non-lifecycle priorities are unchanged, not globally arbitrated.
- Killing the helper itself with SIGKILL, OS shutdown, loss of audio hardware,
  missing/unreadable clips or player failure cannot guarantee audible farewell.
  Cues are single playback attempts, not durable or retryable notifications.

## Ownership and protocol

The same private per-user directory, persistent flock inode, source-hashed
Swift cache, stale socket safeguards and saved size path are retained. Only the
flock owner can create a panel or launch audio. Losers exit silently.

`FAIRY2` deliberately replaces the old one-sided `FAIRY1` handshake:

1. Client sends `lease FAIRY2\n`.
2. Owner replies `FAIRY2 <pid>\n` after validating the hello.
3. The native protocol retains `theme auto|light|dark\n` for diagnostics/tests.
   The animation extension no longer exposes a manual appearance command or sends
   appearance overrides; new helpers retain their automatic macOS default.

The optional [startup entry](STARTUP-ENTRY.md) adds a separate provisional
`prelude FAIRY2 <UUID>` hello, software-ready acknowledgement and same-fd claim.
Unclaimed provisional leases expire after15s; the original client protocol and
claimed lifetime below remain unchanged. Old helpers reject the new hello without
activation; no live helper is replaced.

An accepted socket alone is not a lease and cannot show the pet, reset grace or
play audio. Unqualified sockets expire after one second; malformed input closes
the peer. The existing 64-peer/256-byte bounds remain, with bounded drain loops
on the same 20 FPS main loop. This is protocol qualification, not cryptographic
Pi identity: the private UID-owned 0700 directory is the security boundary.
Same-user programs able to send the valid hello can deliberately acquire a lease.

Retirement commits on the main loop after draining queued accepts and peer reads
and observing final-lease grace expiry. This is not an atomic promise about a
connection arriving just after that drain. After commit new connections receive
`FAIRY2 retiring\n` and are closed, never admitted. The listener stays available
for that response while the helper retains its lock through local visual
completion and farewell. After both it removes only its owned socket, closes
owned windows/server/timers, and exits. Ripple children detach before shrink.
All server/client/lock descriptors are close-on-exec: a player cannot keep a
lease or lock alive accidentally.

`DesktopClient` waits through retiring responses without spawning losing
helpers. When the old owner exits it may launch the next owner, with at least
one second between connection-refused launch attempts and the existing three
launch/two crash-reconnect limits. The original 10-second connection budget
is not enlarged for retirement (first-use compilation retains its separate
120-second budget). If an abnormal/slow retirement exceeds that budget the
existing error is shown; `/fairy-anim off` then `on` is the explicit retry.

## Separate intro effects (0.5.2)

Integrated full launches also explicitly pass `--intro-sfx` to a separate
in-process AVAudioPlayer owner. It may overlap unchanged welcome7 using the
accepted SFX's baked ducking; no voice gain/mixing or lifecycle-player changes.
It shares the once-per-qualified-owner opening, independent of per-Pi mute,
and is stopped/invalidated on cancellation, retirement and shutdown.
Missing/failed/stale preparation falls back to silent effects without blocking
welcome or visuals. Raw/non-full/animation-only launches do not request it;
headless/test/diagnostic SFX options fail closed. See
[opening SFX timing and limits](DESKTOP-INTRO.md#original-sfx-v4-and-subtle-pulses).
The following afplay budgets concern **only existing welcome/farewell**, not SFX.

## Playback and silent diagnostics

The helper launches `/usr/bin/afplay` directly with one absolute WAV argument,
no shell and no Pi process dependency. Full opening uses exactly welcome7, with
no fallback if missing. Non-full native welcome uses 1–6; goodbye randomly selects
an available 1–6 recording from the integrated local directory. No new
state file tracks choices between helper lifetimes. All current lifecycle clips
are shorter than eight seconds (longest welcome 7.39s, farewell 6.13s).

Main-loop ticks enforce an eight-second budget from the requesting tick's
timestamp, then TERM and 200ms to KILL; further ticks observe exit before starting
a pending farewell or exiting. `Process.run()` is synchronous, so enforcement
requires launch to return and the loop to progress: this is not an independent
end-to-end shutdown watchdog. Normal playback is expected to fit a new client's
10-second retry window, not guaranteed to do so. See the retained
[shutdown-delay risk](DESKTOP-INTRO.md#acceptance-and-known-risk--2026-09-06).
The helper owns only its own player PID, never a system-wide player kill.

Animation by itself passes no audio/intro option and stays silent/noncinematic.
Integrated DesktopClient and early Startup launches add `--intro-saved` and
`--intro-sfx`; the owner reads the saved mode after locking and ignores SFX for
simple. Existing raw diagnostics do not opt in. `/fairy-anim welcome full|simple`
changes only the next owner, using a separate non-lease acknowledgement channel
or an offline flock-owning settings command; it never changes audio mute policy. Native explicit
launch options are `--lifecycle-sounds /absolute/directory` and, for isolated
recording diagnostics, `--lifecycle-player /absolute/executable`. These options
are never taken from socket messages. Headless audio requires an explicit player
so existing automated headless launches cannot accidentally invoke afplay.

`modules/animation/tests/lifecycle.test.ts` compiles the real helper and uses an
executable Python recording player, private sockets/preferences, including an
actual AppKit eight-launch scenario. It verifies no-client/malformed silence,
first/last cues, grace reconnect, final Pi SIGKILL, newcomer during farewell,
player parent/path, welcome preemption, bounded stubborn-player cleanup and
animation-only silence. GUI size/effects smoke still passes no audio option.
Tests do not certify perceived sound, physical dragging, Spaces or fullscreen.

## Upgrade and provenance

**Close/restart all old Pi instances in a controlled upgrade.** Release every
old desktop lease and wait until its helper exits before loading the reviewed
root. FAIRY1 and FAIRY2 clients/helpers cannot share leases. A live old helper
is never unlinked or force-upgraded; incompatible greeting errors instruct a
full Pi restart. On subsequent FAIRY2 upgrades allow grace plus farewell to
finish (normally under 12 seconds) before switching versions. No cache or size
preferences should be deleted.

`modules/voice/provenance.json` identifies original-code lineage and hashes of the
shipped voice implementation/tests and all 44 bundled WAVs. Their distribution
is an explicit owner instruction, not a third-party rights grant. Original standalone metadata is historical; current original code/docs
are MIT under the root LICENSE. This document describes integrated lifecycle
logic; see [public resource boundaries](PUBLIC-DISTRIBUTION.md) for validation limits.
