# Voice module maintenance

Original implementation by ymd-physics; not a pi-jingle fork. Original code, tests
and documentation use the root MIT LICENSE (2026 ymd-physics). Historical source
metadata 0.2.29 lacks a license field; the current grant is explicit, not inferred.

This module observes Pi events without injecting context, calling models or
changing tool execution. The integrated root delegates automatic welcome/goodbye
and rest reminders to the shared native desktop; direct-module defaults differ.
Only the root entry is installed. Keep process-local mute, category-local variant
memory, retry cancellation and compaction ordering rules; see the root voice audit.

All 44 voice WAVs are bundled by explicit owner instruction. No model, reference
recording, generation runtime or automatic downloader is shipped. Character voice
and model rights are not covered by code MIT; see ../../docs/AUDIO-PROVENANCE.md.
Public tests verify exact resource hashes, not perceived playback.
