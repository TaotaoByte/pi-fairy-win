# Desktop idle signal / ripple

Desktop-only amendment to ANIMATION-CONTRACT.md: the eye remains in the same
idle state while speaking or silent. No task, permission or voice subscription.
Terminal/pixel animations and all baked art are unchanged.

## Observed versus approximated

User-supplied 3.0 Fairy video, 46–75s: near59.45/64s the outlines of **all**
eye layers develop fine horizontal displacement/jagged edges and recover;
near71s there are wider displaced strips. Near51s there is a broad low-contrast
blue-white annular front on an already glowing blue game background. Ring count
and cadence cannot be reliably measured from these frames. No game background,
UI, character or reference bitmap/video is distributed here. No new DSH source
was copied; existing Apache artwork attribution remains unchanged.

Editable original approximations are in `IdleEffects` in `native/Fairy.swift`:

- Deterministic seed `0xFA17`; integer mixing, stateless sampling of uptime since
  helper start, independent of the existing120-frame/6s breathing/corner loop.
- Glitch starts `4 + 5.5*n + 1.4*noise(n)` seconds: successive intervals4.1–6.9s.
  Duration150 or200ms.75% fine180 horizontal strips,25% coarse13 strips.
  Maximum displacement±0.9% / ±2.5% body side, decays to35% over the burst.
  At20fps this is3–4 drawn frames; no flashes, static, RGB separation or bob.
  Each strip translates the full source image under a complete row clip;
  ordinary NSImageView drawing resumes afterwards with no retained glitch layer.
- Ripple starts at1s, repeats every6.4s:3 waves separated260ms, each1.8s long.
  Front radius grows linearly .32→.74 body side (last radius≈1.76× SVG disc
  radius68/162). Translucent radial band half-width .065 body side with
  alpha stops0/.25/1/.3/0, pale white `(0.88,.95,1)`.
  Peak envelope `.20*min(1,p/.12)*(1-p)^1.3`: quick soft onset then fade.
  Outermost zero-alpha tail≤.805 body side; no opaque backdrop/hard circle.
  White waves intentionally have lower contrast on near-white surfaces, never
  replaced by a black halo. Final perceptual strength remains user acceptance.

## Bounds, input, lifecycle

Original body canvas stays238pt standard and the saved .70/.85/1/1.20/1.45 presets.
A1.8× transparent child panel is centered below it, ignores all mouse input,
shares level/Spaces behavior and follows native dragging; move/resize observers
realign bounds. AppKit rounds panel frames (tested within1pt). The child never
forces repositioning: halos may naturally clip at screen edges. The original
body drag rectangle is not expanded. The size menu remains above both panels.

One existing20fps timer drives both; leases/theme/grace/single-instance IPC and
pendingSave retry are preserved. On shutdown invalidate timer, remove geometry
observers and detach/close child before existing socket cleanup. No persisted
new settings, no external runtime dependency, no joint-LCM asset explosion.

## Reproducible checks (isolated preferences/socket; no screenshots)

```
npm test
python3 tests/check-assets.py
FAIRY_EFFECTS_PREVIEW=/tmp/fairy-effects-previews node --experimental-strip-types tests/smoke-desktop.ts
python3 tests/check-desktop-effects.py /tmp/fairy-effects-previews
swiftc -O native/Fairy.swift -o /tmp/fairy-effects-helper
```

GUI smoke runs seeded timing/radius/fade bounds, native child move/resize and
clickthrough/nonkey checks along with all five menu presets/pendingSave tests.
Optional preview path exports60 own-view transparent PNGs (fixed base frame to
isolate effects); Python checks exact rest/recovery, changed glitch pixels,
solid-disc source coverage, transparent boundaries, unchanged central geometry,
and expanding alpha bounds, then creates `contact.jpg` on dark/light backdrops.
These previews inherit the existing artwork's Apache scope; retain NOTICE and
licenses when distributing them. They are diagnostics, not bundled assets.
Physical drag, Spaces/fullscreen/window-order and visual motion acceptance remain
manual; programmatic movement and panel properties are not an OS hit-test audit.
