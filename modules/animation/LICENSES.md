# License scope

This package contains **MIT AND Apache-2.0** components, not a choice of two
licenses for every file. No blanket relicensing of the original MIT plugin.

- **Existing MIT scope retained:** `native/Fairy.swift` (original AppKit/IPC runtime),
  `src/`, tests, Pi integration and offline build/preview glue, and local
  documentation other than reproduced upstream legal notices.
- **Original procedural SFX (MIT):** `assets/intro/sfx-v4.wav` and editable
  `scripts/generate-intro-sfx.py`; provenance and exact regeneration are documented
  in `assets/intro/README.md`. No sampled game audio, voice or mixed preview is
  included in this grant. Integrated `modules/voice/` remains separately scoped.
- **Apache-2.0 adaptations:** `assets/fairy.svg`, `assets/idle-motion.json`,
  `scripts/frame-svg.mjs`. Each carries a prominent source and modification
  notice. Copyright 2026 Chengzhibense. Source commit and exact derivations
  are recorded in [NOTICE](NOTICE).
- **Generated Apache-2.0 visual derivatives:** all PNGs in
  `assets/frames/{dark,light}/` and `docs/vector-preview.png`,
  `docs/vector-idle.gif`. Their source/modification attribution is in NOTICE
  rather than per-image metadata. Distribute those assets with this notice
  and the Apache license, even when extracted from the plugin.
- Dependency licenses remain separate (including the existing offline resvg
  devDependency); no Fairy-DSH dependencies have been vendored or installed.

Full [Apache-2.0 license](licenses/Apache-2.0.txt), verbatim upstream
[NOTICE](licenses/Fairy-DSH-NOTICE.txt) and
[trademark/content disclaimer](licenses/Fairy-DSH-TRADEMARKS.md) are included.
The source license does **not** grant rights to official Fairy/game images,
characters, names or marks. No official bitmap/audio is included here.
