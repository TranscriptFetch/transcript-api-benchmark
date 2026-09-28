# Results: results/2026-09-28

## instagram (mode: auto)

| | TranscriptFetch | Supadata |
|---|---|---|
| Transcripts returned | 118/120 | 96/120 |
| Median (both succeeded, n=95) | 5.9 s | 19.9 s |
| 90th percentile | 12.1 s | 41.2 s |
| Mean | 9.9 s | 25.1 s |
| Faster on | 84/95 | 11/95 |

By how each side produced the transcript:

| TranscriptFetch source / Supadata path | n | both ok | TF median | Supadata median |
|---|---|---|---|---|
| transcriptfetch=audio supadata=sync | 114 | 93 | 5.9 s | 19.9 s |
| transcriptfetch=audio supadata=job | 3 | 2 | 6.9 s | 160.0 s |
| transcriptfetch=none supadata=sync | 2 | 0 | n/a | n/a |
| transcriptfetch=audio supadata=none | 1 | 0 | n/a | n/a |

transcriptfetch failures: no_speech x2

supadata failures: transcript-unavailable x22, empty_transcript x1, fetch failed x1

## tiktok (mode: auto)

| | TranscriptFetch | Supadata |
|---|---|---|
| Transcripts returned | 118/120 | 108/120 |
| Median (both succeeded, n=108) | 1.3 s | 18.4 s |
| 90th percentile | 6.6 s | 29.4 s |
| Mean | 2.6 s | 19.7 s |
| Faster on | 107/108 | 1/108 |

By how each side produced the transcript:

| TranscriptFetch source / Supadata path | n | both ok | TF median | Supadata median |
|---|---|---|---|---|
| transcriptfetch=captions supadata=sync | 86 | 86 | 1.3 s | 17.9 s |
| transcriptfetch=audio supadata=none | 1 | 0 | n/a | n/a |
| transcriptfetch=audio supadata=sync | 30 | 22 | 6.6 s | 29.3 s |
| transcriptfetch=none supadata=sync | 2 | 0 | n/a | n/a |
| transcriptfetch=audio supadata=job | 1 | 0 | n/a | n/a |

transcriptfetch failures: no_speech x1, no_audio_stream x1

supadata failures: transcript-unavailable x9, fetch failed x1, empty_transcript x1, invalid-request x1

## youtube (mode: captions)

| | TranscriptFetch | Supadata |
|---|---|---|
| Transcripts returned | 120/120 | 120/120 |
| Median (both succeeded, n=120) | 1.1 s | 5.4 s |
| 90th percentile | 2.1 s | 13.7 s |
| Mean | 1.5 s | 6.8 s |
| Faster on | 116/120 | 4/120 |

By how each side produced the transcript:

| TranscriptFetch source / Supadata path | n | both ok | TF median | Supadata median |
|---|---|---|---|---|
| transcriptfetch=captions supadata=sync | 120 | 120 | 1.1 s | 5.4 s |
