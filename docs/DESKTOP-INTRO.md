# Desktop welcome modes and full opening v1

The integrated root defaults to the accepted full AppKit opening for each **new
shared desktop helper lifetime**, not each Pi, reload or grace reconnect. Both
`DesktopClient` and the optional native startup entry pass `--intro-saved`:
the flock owner reads the global choice after acquiring ownership. Animation
alone and old native diagnostics remain silent/noncinematic; explicit
`--intro-full` remains available for deterministic diagnostics.

## Welcome choice, position and local goodbye (0.7.0)

- `/fairy-anim welcome` reports the saved choice; `welcome full` and
  `welcome simple` persist it for the next new shared helper lifetime. Missing
  settings default to full. These commands never enable a disabled
  desktop or restart an entrance. Success requires native completed atomic-save
  acknowledgement, not merely a socket write. Unsupported old owners require a
  controlled all-Pi restart; their main leases are not disturbed.
- Simple has no cover, clock/errors/HDD, raster overlay or SFX. The same transparent
  Fairy grows from a 2-point center to a display-clamped large circle over 0.65s,
  holds until 1.0s, then eases to its saved endpoint at 2.4s. Idle frames continue;
  one available unchanged welcome1–6 starts after growth, never welcome7.
  During motion the pet is mouse-passthrough, with drag/menu disabled; no
  invisible full-screen input window. Finish/cancel restores ordinary input.
- Both entrances choose the saved display UUID when present, otherwise the pointer
  display/remaining screen. The landing uses the saved normalized visible-frame
  center and selected size, clamped safely; absent position defaults upper-right.
  Missing-display fallback never overwrites the original saved display. Display
  changes cancel controlled motion; no-display recovery remains hidden until a
  display returns, without replay or saving temporary geometry.
- Completed valid user drags save immediately, protecting against Pi crashes.
  Settings v2 adds `welcome` and `position: {display, x, y}` beside `size`; v1
  size-only data migrates on the next save. Coordinates must be finite and within
  [0,1], with a valid display UUID. Every native write rereads and patches only
  its field under the existing owner flock. Size changes preserve mode/position.
  Failed drag saves open the existing menu warning; its warning footer retries
  pending saves. Unrelated successful saves do not clear pending warnings.
  The helper also retains qualified resting intent: a normally completed landing
  (including the first default landing), or the latest completed user drag.
  User size changes update that intent when clamping shifts the resting center.
  At retirement commitment, before cancellation/shrink, it makes one best-effort
  save/retry of that intent. Failed drag intent remains authoritative even if
  storage recovers only at retirement. Mid-entrance, cancelled, non-user geometry,
  no-display and missing-monitor fallback frames do not authorize new intent;
  they cannot overwrite the remembered monitor. A final unwritable disk can still
  lose unsaved intent: no exit-blocking retry loop or stronger shutdown guarantee
  is introduced, and in-life warning/retry behavior remains unchanged.
- At final-lease 3s grace commitment, both modes use the same local outro:
  freeze the current frame, expand 6.5% over 0.18s, then shrink/fade smoothly to
  a point by 0.95s, without relocating its center. Ripples detach immediately.
  Existing goodbye selection begins alongside the visual; newcomers receive
  retiring. The owner retains its lock until visual completion **and** lifecycle
  audio idle. Hidden pets cannot be resurrected by subsequent ticks. Raw
  animation-only lifetimes retain their noncinematic behavior.

The command transport is a separate, unqualified `welcome FAIRY2 [full|simple]`
peer, never a lease or grace reset. With no listener only, a short-lived native
`--welcome-setting [full|simple]` command acquires the same nonblocking owner flock,
reads/patches settings, prints the result and exits before socket/AppKit/audio
creation. A racing/busy owner fails honestly; no stale competing whole-file
writer or old-owner bypass is used. Read/write errors are reported to Pi.
No global cache is warmed automatically by the shell; user-approved explicit
compile-only preparation is required after review of the changed native hashes.

Full artwork, timeline, welcome7 and SFX v4 remain unchanged except saved landing.
The historical six-second exit failures below remain UNKNOWN/deferred, not fixed.
Own-view/headless tests do not certify physical animation, dragging, display
unplugging, input routing or audiovisual timing.

## Startup ordering and explicit preparation

The installed Pi host starts its TUI before `session_start`, the earliest general
session hook used here. The intro therefore is **not guaranteed before the TUI**.
No factory process launch, trust-hook workaround, argv guessing or terminal
clearing/hiding is used. A strict before-TUI opening needs separately approved
host/launcher integration. The separate [opt-in startup entry](STARTUP-ENTRY.md), locally activated by the owner,
now supplies a narrow bare-interactive software-ready-before-exec path; ordinary
entry and unsupported invocations still use this post-TUI hook.

A missing source-hashed helper binary requires a separate, bounded Swift compile.
After updates, explicit `npm run prepare:desktop` from this package compiles only
through the existing `buildHelper()` cache (also preparing the optional native
startup executable). It starts no helper, socket, lease,
window or audio; it is not an install/startup hook. Run it only when preparing an
update. The first opening still compiles if that exact source/architecture cache
is absent. Existing helpers retain their old code until normal all-lease shutdown.

After a successful launch, the client now attempts its handshake immediately,
without an unconditional 100ms sleep. If the socket is not yet listening, normal
backoff resumes; launch spacing starts at completion of preparation/launch.
Connection/compilation budgets, qualification and reconnect limits are unchanged.
Isolated measurements for this change: optimized uncached-output compile 4.585s;
production 240-image construction 48ms initially, 15–17ms on repeats; native
headless spawn-to-greeting 352ms initially, 64–65ms warm. These separate measurements
exclude GUI startup/WindowServer first visibility, physical latency and audio;
they cannot be summed into a claimed user-visible startup bound. Filesystem/SDK
caches were not flushed. First-use compilation, not image construction, was the
seconds-scale preparation cost in these measurements.

## Original SFX v4 and subtle pulses

The owner accepted the offline original procedural **SFX v4**. Integrated launches
explicitly pass `--intro-sfx` for `modules/animation/assets/intro/sfx-v4.wav`.
This is separate from voice/sounds: no mixed preview, extracted game recording or
runtime synthesis. Clock fracture and noisy ERROR impacts retain v2 foreground;
v3 replaces only 4.9–6.7s HDD clicks with continuous filtered noise. V4 adds
quiet original fan/air/data ambience with a 350ms entrance, background duck
6.85–7.2s to 0.20 gain and final fade 8.8–10s. Exact hash,
editable stdlib source and offline checks: [SFX provenance](../modules/animation/assets/intro/README.md).

A separate in-process AVAudioPlayer prepares off-main once after the qualified
owner begins its cover, then returns to main for one monotonic elapsed-time seek
and playback attempt. No timeline delay, retry, replay or continuous drift correction.
Preparation taking over one second, a resumed gap over one second, missing/bad
files or failed playback yield silence; visuals and welcome continue. Cancel,
lease/display loss, retirement, handled termination and cleanup invalidate
pending completion and stop only this SFX player. It stops at the next tick at
10s (`IntroSample.end`), preserving the quiet nonzero 9.3–10s tail,
and no later than finish. The visual background still finishes fading at 9.3s. SIGKILL and
hard OS/main-thread suspension cannot promise prompt cleanup. Device startup/output
latency and physical audiovisual synchronization are unmeasured; a single elapsed
seek is best effort, and slow startup can omit the effects entirely.

Welcome7 remains a separate unchanged request at 7.2s, with its original source,
gain and lifecycle. The SFX's baked ducking remains; audition voice gain 0.55 was
preview-only and is not applied. More leases/reload/grace reconnect cannot restart
SFX. Raw, animation-only, and full-without-SFX launches are silent for effects;
headless/test/offscreen diagnostic invocations reject `--intro-sfx` before any
player/device construction. Tests inject a fake backend into production ownership.

Only IntroView draws three dim-only pulses, after existing raster:
start/duration/depth = **0.55/0.18/0.06**, **3.35/0.18/0.07**, **4.85/0.20/0.08**
(seconds). Brightness is `1 - depth * sin(pi*u)^2` inside each window, otherwise 1.
No white flash, overshoot, per-error strobe or pulse after 6.7s. Source-atop black
preserves alpha. This changes no monitor gamma,
other palette windows, scanline grid, pet drawing/input, layout or timeline.
Numeric/offscreen checks are not listening, photosensitivity, physical-compositor
or fullscreen acceptance. The historical six-second mock-helper risk below remains.

## Approximate storyboard

These are editable design estimates, **not measured timings from the reference
video**. All visuals are our procedural redraws plus the existing Fairy PNGs;
no reference video/frame, screenshot, browser, movie or HDD application is used.

| Elapsed seconds | Presentation |
| --- | --- |
| 0–0.7 | Dim cold gray-blue tiled static, scan lines and horizontal tears; no black/white fullscreen strobe |
| 0.7–2.7 | `LOCAL SYSTEM` and tall HH MM SS, actually ticking from local wall time for two seconds |
| 2.7–3.4 | Rapidly changing clock digits |
| 3.4–4.9 | Retro metallic error windows cascade top-left to bottom-right with growing density; one canvas, never OS dialogs |
| 4.9–6.7 | Glowing `H.D.D. SYSTEM`, `HOLLOW DEEP DIVE SYSTEM`, outlined horizontal loading bar with reference-proportioned height; completes at 6.6 and holds briefly |
| 6.7–7.2 | Deep Fairy blue, central larger Fairy materializes |
| 7.2–7.8 | Central hold; one welcome attempt begins only after materialization |
| 7.8–10.0 | Background fades independently to the real desktop by 9.3; same Fairy smoothly moves/shrinks to saved landing (upper-right by default) |

The loading bar represents presentation progress only, not a scan or real machine
status. There is no extra INTRO/percentage/debug text on screen. Timeline and playback deadlines use monotonic
uptime; wall-clock changes affect only the displayed HH MM SS. Speech is not
stretched to fit: `modules/voice/sounds/welcome-7.wav` (7.389969 seconds) may
continue after landing. Full never chooses welcome1–6, even if welcome7 is
missing. The non-full native welcome pool is 1–6; direct voice module and
`/fairy-voice test welcome` retain their original independent behavior.

## Reference geometry, typography and palette

The approximate active-monitor crop is (24,50)–(815,344) of the local reference,
excluding the filmed bezel, movie borders and player chrome. Measured title
bounds are approximately (180,131)–(681,185), bar (103,200)–(743,235), subtitle
(184,251)–(666,268). A centered 791:294 stage preserves those relative proportions
without stretching typography differently on portrait/ultrawide screens. Impact
system glyph paths with a shear approximate heavy condensed italic outlines and
tracked subtitle; DINCondensed-Bold supplies plain oval clock zeros. Clock pairs
and HH/MM/SS labels use the same column centers. No fonts are downloaded.

Colors are fixed for the cinematic, independent of macOS appearance. Unobstructed
source patches are measured only after ICC conversion to common sRGB: the
reference PNGs embed HDTV, while native own-view PNGs embed Generic RGB. Raw
triplets from these different profiles are not comparable. Representative HDD
sRGB8 patches are approximately (49,70,98) upper-left, (58,87,123) upper-center,
(42,60,70) lower-right, and (44,63,77) left-middle. Compression and filmed
illumination remain part of those samples; these are not monitor corrections. The backdrop
approximates these with restrained gray/slate-blue fields, cold near-white/light
blue lettering and blue-white bloom, metallic error faces and dark error text.
The later deep-blue Fairy reveal is deliberately separate. These are measured
approximations, not exact source-color reproduction. Measurement alone is not
perceptual certification; the owner's offline acceptance is recorded below.
The diagonal cascade follows the user's explicit sequencing request; it is not a
frame-for-frame reproduction of the reference's disappearing/jagged windows.
Existing pet theme-specific contours remain unchanged; appearance follows macOS
automatically. The manual appearance slash command has been removed; coolblue
interaction colors and this cinematic are unchanged.
The existing very light 0.035 pale-blue global raster continues through reveal
and motion: one-point rows on the same fullscreen logical grid (at most 500),
not a pet-local grid or extra flicker. The separate pet view isolates drawing
and applies rows source-atop its graded alpha, without a rectangular halo or
painting transparent margins. Cover alpha and the pet's intro-only raster fade
with the background to zero at 9.3s; finish/cancel clears pet raster state.
Apart from the three brief cover pulses above, pre-reveal textures, final idle art and timing are unchanged.

## Ownership, handoff and input

The flock-owning helper acknowledges the first qualified FAIRY2 lease **before**
starting the opening. More leases cannot replay it. The original pet panel/view
stays hidden during signal/clock/errors/HDD, then that same panel/view appears
centrally. There is no second Fairy and no sprite transfer at landing. The
separate transparent nonkey cover draws only the background/UI, below the pet.
Idle PNG breathing continues without any speaking-state animation. Existing
ripple child panel is temporarily detached/hidden, then reattached below the
same pet. The size menu and dragging are disabled while the intro owns motion.
All finish/cancel paths restore pet input and the saved size without saving
motion frames. The landing uses saved display/position in its visible frame;
without position it is upper-right with 8–40 point margins, clamped for tiny screens.

There is no visible SKIP button, hidden hit target or click-to-dismiss action.
Covered pointer presses, releases and scrolling are swallowed, including where
the moving pet overlaps the cover. Normal closure remains at 10s; ordinary Pi
exit, final-lease loss, display invalidation and overdue cancellation remain.

No activation/focus theft, global keyboard monitor, permissions, screen capture,
login item or system lockdown is used. **This nonkey overlay does not capture
keyboard input: typing and Escape can still reach the previously focused app.**
Escape does not dismiss the opening. This is not a security barrier.

## Display and interruption limits

Only the saved (or fallback pointer-selected) display at first lease is covered by full, not all monitors.
That target is frozen during the opening. Ordinary applications, Spaces and
fullscreen are requested through AppKit collection behavior/status-bar level;
macOS can restrict these, especially protected/system UI. This does not cover
the lock screen or security UI. No acceptance of actual user Spaces, input
routing or perceived smoothness is inferred from synthetic tests.

On screen removal, resolution, layout, visible-frame or backing-scale change,
the next tick cancels to a clamped pet on the target if still present, otherwise
an actually remaining screen. With no screen, the pet and child effects stay
hidden across subsequent ticks. When a screen returns, the same pet lands once
in its visible frame and the effects are realigned/restored, without replay or
preference writes. No fullscreen cover remains. Early final-lease loss also cancels immediately to the ordinary
pet (on the next 50ms tick), stops/suppresses welcome, and retains the existing
three-second grace. Reconnect within grace does not restart the opening. After
grace or termination, retirement destroys the cover and prevents future welcome;
normal goodbye preempts any remaining welcome. Missing/failed audio never stalls
the visual timeline or causes a substitute full welcome.

The 20 FPS main loop polls IPC/player in common and event-tracking run-loop
modes, without modal animation or per-frame image encoding. Static uses a cached
128×64 tile; the slate-blue backdrop uses 64×32 cached color cells, avoiding
per-frame full-resolution gradient/image color conversion. Tears, errors and
scan lines have bounded primitive counts. Drawing
uses logical points and AppKit backing scale. A gap over one second between
intro ticks, or overdue elapsed closure, cancels on the resumed tick. This bounds
cleanup while the loop is running, **not a guarantee against a main-thread hard
hang or OS suspension**. Existing private sockets, qualified leases, flock,
retiring response, 8s player + 200ms TERM/KILL and Node 10s connection budget remain.
Shared lifecycle cues still ignore per-Pi mute; other voice notifications are
independent, not controlled by a new priority broker.

## Isolated diagnostics

From the package root, `npm test` includes real Swift state-machine, geometry,
offscreen renderer and recording-player lifetime tests. It does not show intro
covers. Existing lifecycle/menu tests may show ordinary Fairy panels. No tests
connect to or terminate a user's helper or write the user's preferences.

To save **own-view** phase PNGs (not screenshots), including portrait/ultrawide
and actual Retina-backed rasterization:

```sh
swiftc modules/animation/native/Fairy.swift -o /tmp/fairy-intro-helper
d=$(mktemp -d /tmp/fairy-intro-preview.XXXXXX)
FAIRY_SETTINGS_DIRECTORY="$d/settings" FAIRY_INTRO_PREVIEW="$d/previews" \
  /tmp/fairy-intro-helper "$d" "$PWD/modules/animation/assets" --intro-diagnostics
```

This verifies phase ordering, two-second real clock, monotonic bar, single full
welcome selection, cancellation/overdue closure, five sizes and six geometries
(16:9,16:10,21:9,portrait,tiny,4K; negative origins; 1x/2x point calculations).
A separate window-free test compiles the production placement/lifetime decisions
and simulates cancellation, two empty-screen ordinary ticks, then display return
across all five sizes; recovery lands once and does not replay the intro.
It renders 52 actual own-view phase PNGs at the current backing scale, including
a reference-aspect 791×294 canvas. It reports 39 rasters each at 3840×2160 logical
1x and 1920×1080 logical 2x (both 3840×2160 pixels), with per-phase durations
**excluding PNG encoding**, not compositor latency, afplay startup or physical
frame pacing. The cover measurements remain separate. Additional pet-only measurements cover
reveal/hold/fade/late at both scales, including the bounded transparency layer;
neither measures compositor work. Sixteen separate transparent pet PNGs exercise
two positions/sizes at 1x/2x with full/fading/zero raster, alongside the 52 phase
previews. The focused `IntroRaster` test executes finish/cancel clearing without
windows and guards the retirement/placement callers.

One optional controlled GUI lifetime, with **recording-only player**, can be run
explicitly (it also runs the offscreen/headless cases):

```sh
FAIRY_INTRO_GUI_SMOKE=1 node --experimental-strip-types --test modules/animation/tests/intro.test.ts
```

This displays exactly one ~10s intro cover and asserts real panel nonkey/input
flags, hidden pre-lease/pre-reveal pet, same-panel materialization and landing.
Physical pointer absorption, actual display unplugging and Spaces/fullscreen
remain manual checks. Native `--intro-test` requires private preference override
and explicit recording player when audio is enabled; its private test action
can simulate display invalidation. Early/late lease cancellation uses actual
socket EOF; late cancellation waits for the private recording fixture's
`player-ready` marker and bounds its actual player PID's reaping.
`--intro-test` also emits
flushed monotonic lease/grace/player/coarse-poll traces. An exit-deadline failure
remains a failure: the fixture captures only its own helper/player process state,
recordings and ready marker, observes up to eight more seconds without extending
the passing deadline, and retains diagnostic JSON under its private `/tmp` root.
Normal launches
ignore these actions. `--intro-full` without sounds is explicitly silent.

## Acceptance and known risk — 2026-09-06

Historical design acceptance of full opening V1 and procedural SFX is not current
public-package live fullscreen, input, multi-display or compositor certification.
Physical synchronization remains untested for this candidate.

The owner explicitly accepted retaining two historical six-second mock-helper
exit failures as an unresolved risk, **not a fixed defect**. Delayed helper exit
and lock release remain possible; cause, frequency and production relevance are
unknown. The affected cases were display cancellation and missing welcome7;
the latter still supplied goodbye1 and recorded a live helper with no player
recording at six seconds. Its stdout was then buffered; no failing-state stack
was captured. These observations do not identify a permanent hang, production
afplay failure or intro causation. Six seconds is the fast recording fixture's
expectation, not a hard production shutdown bound. Keep the failure evidence and assertions rather than
rerunning until green; reopen diagnosis upon a captured recurrence or new source
evidence. The original private failure evidence is not distributed; the failure remains
unresolved, not silently reclassified as a passing test.

## Upgrade / rollback

Do not replace a live helper. Release **all** desktop leases, let grace/farewell finish, then restart all
Pi instances from the accepted package. A FAIRY2 helper already alive retains its
old behavior across reload; protocol identity and saved size path intentionally
stay unchanged. To roll back, repeat the controlled all-lease shutdown and load
the previous reviewed package. Do not delete size/cache state, force-kill another
session's helper or modify global package settings as part of diagnostics. See
[LIFECYCLE-AUDIO.md](LIFECYCLE-AUDIO.md) and [INTEGRATION.md](INTEGRATION.md).
