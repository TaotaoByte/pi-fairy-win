# Original intro SFX v4 — provenance and reproduction

Owner-accepted offline procedural sound design, integrated without changing its bytes.
No game/video audio was ripped, sampled or recreated as dialogue. Artistic event
estimates follow the existing opening, not measured reference-audio transcription.

- `sfx-v4.wav`: SHA256 `fedff073eedfd00b039447dc885d71466538ec185618f7e6c0a65c6e0a5c83bc`.
- Stereo PCM16, 48 kHz, 480000 frames / exactly 10 seconds. Peak −14.902270 dBFS,
  whole-file RMS −33.567475 dBFS; smooth zero endpoints, nonzero quiet 9.3–10s tail.
- V2 static/ticks/clock fractures/ERROR/reveal/movement remain the foreground
  outside HDD. V3 replaces only [4.9,6.7) with continuous filtered noise,
  220ms attack / 320ms release, replacing individual loading clicks.
- V4 adds original low fan/air/data textures, not recorded/ripped game audio:
  350ms fade-in, background duck 6.85–7.2s to 0.20, final fade 8.8–10s.
  Pre-welcome background RMS −42.500292 dBFS; under-welcome −56.326066 dBFS.
  The foreground's original duck 6.85–7.18s to 0.06 is unchanged.
- No runtime mixing, voice attenuation or voice source dependency. The audition's
  welcome gain 0.55 was preview-only; no mixed preview is packaged.
- `../../scripts/generate-intro-sfx.py` is editable Python stdlib source,
  consolidated from v1/v2 and the accepted smooth-HDD v3 / ambience v4 drafts.
  Seeds 505007/505008/505009/505010. Preserve arithmetic and intermediate PCM16
  quantization: v3 RMS/replacement operates on quantized v2, then v4 integer-adds
  separately quantized ambience. Do not float-mix or renormalize the final output.
  No archived WAV input, absolute/user/temp source dependency or download.
- Earlier v2/v3 designs are not distributed here. Only the effects-only v4 is bundled.
  Native SFX ends at 10s; the independent visual background fade still ends at 9.3s.

From the package root (no playback):

```sh
python3 modules/animation/scripts/generate-intro-sfx.py --check
python3 modules/animation/tests/check-intro-sfx.py
# To edit synthesis, write explicitly to a chosen output, not over the accepted asset:
python3 modules/animation/scripts/generate-intro-sfx.py --output ./edited-sfx.wav
```

`--check` regenerates in a temporary directory, requiring both the accepted SHA256
and byte equality with the packaged asset. The independent test also copies only
source + asset into an isolated package layout and runs from another working
directory. Floating-point library differences across platforms/Python versions
may affect byte determinism; a mismatch fails, never silently replaces the asset.
These digital checks do not establish perceived loudness, speech intelligibility,
listening quality, physical timing or photosensitivity safety.

## License scope

This original procedural generator and its generated `sfx-v4.wav` are within the
local animation MIT scope. This applies **only** to this original source/effects,
not unofficial voice/audio, game characters/marks or Apache visual derivatives.
Retain the module [LICENSES.md](../../LICENSES.md) and root license restrictions.
This SFX attribution does not license synthesized character voice assets; original
voice code/docs have their own MIT grant in the root LICENSE.
