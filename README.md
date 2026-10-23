<p align="center">
  <img src="https://raw.githubusercontent.com/TranscriptFetch/transcript-api-benchmark/main/assets/logo.png" alt="TranscriptFetch" width="84" height="84" />
</p>

# Transcript API benchmark: TranscriptFetch vs Supadata and TranscriptAPI

Reproducible head-to-heads of hosted transcript APIs:
[TranscriptFetch](https://transcriptfetch.com) against
[Supadata](https://supadata.ai) on YouTube, TikTok and Instagram, and against
[TranscriptAPI](https://transcriptapi.com) on YouTube (the only platform it
serves). Each measures what a client sees: how long it takes from sending the
request until the full transcript text is in hand, and how often a transcript
comes back at all.

> **Disclosure.** TranscriptFetch built this benchmark and ran the published
> results. Everything needed to check them is in this repository: the code,
> the exact URLs, and every raw measurement. The script runs with your own API
> keys, so you do not have to take our numbers on trust.

## Results: 28 September 2026

Run from an OVH server in Warrenton, Virginia (US) between 12:58 and 15:20 UTC, against Supadata's paid **Pro** plan. 120 URLs per platform, 360 in total.

| Platform | Asked for | TranscriptFetch returned | Supadata returned | TranscriptFetch median | Supadata median | TranscriptFetch p90 | Supadata p90 | TranscriptFetch faster on |
|---|---|---|---|---|---|---|---|---|
| YouTube | existing captions only | **120**/120 | 120/120 | **1.1 s** | 5.4 s | **2.1 s** | 13.7 s | 116/120 |
| TikTok | any transcript (captions or AI) | **118**/120 | 108/120 | **1.3 s** | 18.4 s | **6.6 s** | 29.4 s | 107/108 |
| Instagram | any transcript (captions or AI) | **118**/120 | 96/120 | **5.9 s** | 19.9 s | **12.1 s** | 41.2 s | 84/95 |

Median and 90th percentile are over the URLs where **both** APIs returned a transcript (the last column's denominator). Supadata was faster on 11 of the 95 Instagram pairs and on 4 of the YouTube ones. The network baseline favoured Supadata: idle round trips of 94-174 ms to Supadata against 142-448 ms to TranscriptFetch.

- The full breakdown, including how each side produced each transcript (captions or AI, synchronous or async job) and every failure reason, is in [`results/2026-09-28/summary.md`](results/2026-09-28/summary.md).
- Every raw measurement is in [`results/2026-09-28/`](results/2026-09-28/): one JSON line per URL per platform, plus `run.json` and `network.json`.
- The run used 527 Supadata credits, including a short smoke test beforehand (8 requests).

**Two things that happened during this run:**

1. **Instagram was paused for 30 minutes.** After 23 Instagram URLs, the run exposed a bug in TranscriptFetch's own scraper: a failed fast-path audio download was being counted as a block against every one of our download IPs. We stopped the run, fixed and deployed the scraper, and resumed with the same script (it skips URLs already recorded). The first 23 Instagram rows ran before the fix, when some of our downloads took a slower fallback path.
2. **One Instagram URL (#24) was answered from cache by both APIs.** It was in flight when the run was paused, so both services had just processed it, and both answered in under a second on resume. It is left in the data as measured.

`fetch failed` in Supadata's failure list is a network-level error on the request from our server to Supadata; the script does not retry, so it counts as a failure.

## Results: TranscriptAPI, 29 September 2026

Run from the same OVH server in Warrenton, Virginia (US) between 01:43 and 01:59 UTC, against TranscriptAPI's entry paid plan. 500 YouTube URLs, captions only, none of them used in any earlier run.

| | TranscriptFetch | TranscriptAPI |
|---|---|---|
| Transcripts returned | **500**/500 | 463/500 |
| Median, both returned (n=463) | 0.7 s | **0.4 s** |
| 90th percentile, both returned | **1.1 s** | 3.0 s |
| Faster on | 151/463 | 312/463 |

TranscriptAPI labels every answer with `X-Cache-Status`, so the pairs split cleanly by whether its answer came from its cache:

| TranscriptAPI answer | Pairs | TranscriptFetch median / p90 | TranscriptAPI median / p90 | TranscriptFetch faster on |
|---|---|---|---|---|
| From its cache (`HIT`) | 326 | 0.7 s / 1.2 s | **0.3 s / 0.6 s** | 21/326 |
| Fetched fresh (`MISS`) | 137 | **0.8 s / 1.1 s** | 2.6 s / 4.4 s | 130/137 |

- TranscriptFetch's side sent `x-tf-bypass-cache: 1`, as in the Supadata run, so all 500 of its answers were fresh fetches from YouTube. TranscriptAPI answered 326 of its 463 transcripts (70%) from its cache. The first table therefore compares TranscriptFetch fetching fresh against TranscriptAPI's mix; the `MISS` row is the fresh-against-fresh comparison.
- TranscriptAPI's 37 failures: 31 were HTTP 408 "Request failed, please retry" (its docs call these temporary, bot detection or network, and safe to retry), spread across the whole run rather than one outage; 6 were HTTP 404 "not found or unavailable" on videos TranscriptFetch returned. Neither API is retried (see methodology), so both count as failures.
- The two APIs returned the same transcripts: TranscriptAPI's text was a median 2.4% shorter (formatting), and the default caption language differed on 17 of the 463 pairs.
- TranscriptAPI charged 463 credits, one per successful answer; failures are free under its billing rules. Idle round trips from the same server: 119-145 ms to TranscriptAPI, 63-235 ms to TranscriptFetch (`network.json`).
- Raw measurements: [`results/2026-09-29-transcriptapi/`](results/2026-09-29-transcriptapi/) (`youtube.jsonl`, `run.json`, `network.json`, `summary.md`).


## Methodology

**What is timed.** Wall-clock time from sending the first request until the
transcript text is received, measured on the client with `performance.now()`.
When an API answers with an asynchronous job instead of the transcript, the
job is polled every second (the same interval for both APIs) and the clock
stops when the finished transcript arrives. A request counts as a success
only if it returns non-empty transcript text.

**Pairing.** For every URL, both APIs are called at the same instant
(`Promise.all`), so both see the same video, the same network conditions and
the same moment in time. URLs run one after another, never in parallel, so
neither API is load-tested and rate limits play no part. There are no retries:
each API gets one attempt per URL, with a 5-minute limit.

**What is compared.** Success rate counts every attempt. Latency (median and
90th percentile, linear interpolation) is compared only on URLs where both
APIs returned a transcript: a failure has no meaningful time, and comparing
each API over its own successes would compare different sets of videos.

**What each API is asked for.**

| Platform | Mode | TranscriptFetch request | Supadata request |
|---|---|---|---|
| YouTube | existing captions only | `POST /api/v2/transcripts/video` with `"mode": "captions"` | `GET /v1/transcript?mode=native` |
| TikTok | any transcript | `POST /api/v2/transcripts/video` (default auto mode) | `GET /v1/transcript?mode=auto` |
| Instagram | any transcript | `POST /api/v2/transcripts/video` (default auto mode) | `GET /v1/transcript?mode=auto` |

TranscriptAPI (YouTube only) is asked with `GET /api/v2/youtube/transcript?video_url=<url>&format=json&include_timestamp=false`, no `language`, so it returns English or the video's first language, as TranscriptFetch does by default. It answers synchronously.

YouTube runs caption-only because nearly every video in the corpus has
captions, so this isolates retrieval speed. TikTok and Instagram run in auto
mode (existing captions when there are any, otherwise AI transcription of the
audio) because most short-form videos have no caption track, and a caption-only
test there would mostly measure two failures.

**The corpus.** [`corpus/queries.json`](corpus/queries.json) lists 12 or 13
keyword searches per platform (tutorials, podcasts, lectures, news, reviews,
cooking, finance, languages and more, in English, French and Spanish). For each
query, [`build-corpus.mjs`](build-corpus.mjs) keeps the first 10 results in the
platform's own relevance order, skipping duplicates. YouTube searches ask for
videos with captions. Nothing is chosen or dropped based on how either API
handles it. The resulting 120 URLs per platform are in
[`corpus/`](corpus/), with the query each came from and its length.

The corpus search used TranscriptFetch's search endpoint because it covers all
three platforms with one key. A corpus is only a list of URLs, so you can build
yours with any tool.

**Caching.** Both services cache transcripts, and a cached answer is much
faster than a fresh one. So:

- URLs that either API had been sent earlier the same day (an earlier run and
  a smoke test of this script) were excluded when the corpus was built
  ([`corpus/excluded.txt`](corpus/excluded.txt)), so neither side could answer
  from a cache we had just warmed.
- For YouTube, TranscriptFetch's side sent `x-tf-bypass-cache: 1`, an internal
  header honored only for TranscriptFetch staff accounts, so every
  TranscriptFetch YouTube answer was a fresh fetch from YouTube. Supadata has
  no public cache control; any of its answers may have come from its cache.
- TikTok and Instagram ran without that header, as a normal client would. On
  the audio path the header also skips writing the result to the cache the job
  endpoint reads from, so it cannot be used there. The corpus exclusion above
  is what keeps those runs cold.

**Network.** [`network.mjs`](network.mjs) records idle round trips from the
benchmark machine to a cheap endpoint on each API (`network.json` in each
results folder), so you can see how much of any gap is just the network path.

**Language.** When no language is requested, each API picks its own default
caption track, and the two sometimes pick different ones. This benchmark
compares time and success, not which language came back.

**Limitations.** One origin machine, one day, requests in sequence (no
concurrency), and run by one of the two vendors. Results for other regions,
times of day, plans or concurrency levels may differ; that is what the rest of
this README is for.

## Reproduce it

Requires Node.js 18 or newer. No dependencies.

```bash
git clone https://github.com/TranscriptFetch/transcript-api-benchmark
cd transcript-api-benchmark
export TRANSCRIPTFETCH_API_KEY=...   # https://transcriptfetch.com/app/keys
export SUPADATA_API_KEY=...          # https://dash.supadata.ai

node network.mjs results/mine/network.json
node bench.mjs --corpus=corpus/youtube.tsv   --mode=captions --out=results/mine/youtube.jsonl
node bench.mjs --corpus=corpus/tiktok.tsv    --mode=auto     --out=results/mine/tiktok.jsonl
node bench.mjs --corpus=corpus/instagram.tsv --mode=auto     --out=results/mine/instagram.jsonl
node summarize.mjs results/mine
```

`bench.mjs` appends each result as it finishes, so an interrupted run resumes
where it stopped. `--limit=N` runs only the first N URLs, `--interval` and
`--timeout` (milliseconds) change the poll interval and per-request limit.

To run the TranscriptAPI comparison instead, set `TRANSCRIPTAPI_API_KEY` and
add `--competitor=transcriptapi` (it needs `--mode=captions`):

```bash
export TRANSCRIPTAPI_API_KEY=...     # https://transcriptapi.com (API access needs a paid plan)
node network.mjs results/mine-ta/network.json transcriptapi
node bench.mjs --competitor=transcriptapi --corpus=corpus/transcriptapi/youtube.tsv \
  --mode=captions --max-charged=100 --out=results/mine-ta/youtube.jsonl
node summarize.mjs results/mine-ta
```

Paid credits are protected: each URL is written to `<out>.started` before it
is sent and is never sent again on a rerun, `--max-charged=N` stops after N
billed answers, and an HTTP 402 (out of credits) on either side stops the run
without recording that URL.

**Use a fresh corpus for a cold test.** The URLs in `corpus/` were sent to
both APIs when we ran the benchmark, so both services may now answer them from
cache. To measure cold performance, build a new corpus first:

```bash
node build-corpus.mjs --platform=youtube --exclude=corpus/excluded.txt
```

or put any list of URLs you care about in a file, one per line.

**What it costs.** The TranscriptAPI run is 500 YouTube captions per API: 1
credit per successful answer on TranscriptAPI (cached answers included,
failures free) and 1 credit per transcript on TranscriptFetch. The Supadata run is 360 transcripts per API. Caption fetches are
1 credit each on both services. When a TikTok or Instagram video has no
captions, TranscriptFetch charges 1 credit per started 5 minutes of audio and
Supadata charges 2 credits per minute. Our run used the Supadata credits
recorded in `run.json`. Free tiers (50 credits a month on TranscriptFetch, 100
on Supadata) cover a sample: add `--limit=25`.

## Files

| Path | What it is |
|---|---|
| `bench.mjs` | Runs a corpus against both APIs and appends one JSON line per URL |
| `summarize.mjs` | Turns a results folder into `summary.md` and `summary.json` |
| `build-corpus.mjs` | Builds a corpus from the searches in `corpus/queries.json` |
| `network.mjs` | Idle round-trip baseline to both APIs |
| `corpus/` | The queries, the 120 URLs per platform, and the excluded URLs (Supadata run) |
| `corpus/transcriptapi/` | 20 queries, the 500 YouTube URLs (25 per query) and the 171 excluded URLs (TranscriptAPI run) |
| `results/<date>/` | Raw JSONL per platform, `run.json`, `network.json`, summaries |

Each JSONL line holds the URL, the query it came from, the mode, and for each
API: `ok`, `status`, `ms`, `path` (`sync`, or `job` when it went through an
async job), `polls`, `source`, `language`, `chars` and `error`. TranscriptAPI
rows also carry `cache` (its `X-Cache-Status`). API keys never appear in
results, and the competitor's raw response bodies (third-party transcripts)
are kept out of the repository.

## License

MIT
