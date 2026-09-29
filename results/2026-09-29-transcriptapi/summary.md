# Results: results/2026-09-29-transcriptapi

## youtube (mode: captions)

| | TranscriptFetch | TranscriptAPI |
|---|---|---|
| Transcripts returned | 500/500 | 463/500 |
| Median (both succeeded, n=463) | 0.7 s | 0.4 s |
| 90th percentile | 1.1 s | 3.0 s |
| Mean | 0.9 s | 1.1 s |
| Faster on | 151/463 | 312/463 |

By how each side produced the transcript:

| TranscriptFetch source / TranscriptAPI cache status | n | both ok | TF median | TranscriptAPI median |
|---|---|---|---|---|
| transcriptfetch=captions transcriptapi=cache:HIT | 326 | 326 | 0.7 s | 0.3 s |
| transcriptfetch=captions transcriptapi=cache:MISS | 137 | 137 | 0.8 s | 2.6 s |
| transcriptfetch=captions transcriptapi=cache:none | 37 | 0 | n/a | n/a |

transcriptapi failures: Request failed, please retry x31, Video KcDDRmG66Uo not found or unavailable x1, Video 7Ssw5fMmPz0 not found or unavailable x1, Video A7qDPZMtr_E not found or unavailable x1, Video eChiW3coNcY not found or unavailable x1, Video euscHDHEmJM not found or unavailable x1, Video dVv-mGYoWTQ not found or unavailable x1
