#!/usr/bin/env node
// Head-to-head transcript API benchmark: TranscriptFetch vs one competitor
// (--competitor=supadata, the default, or --competitor=transcriptapi).
//
// For every URL in a corpus file, both APIs are called at the same instant.
// A side that answers with an async job is polled at the same interval as the
// other, and the clock stops when a transcript (or a final failure) arrives.
// URLs run one at a time, so neither API is load-tested and rate limits are
// not a factor. Every attempt is appended to a JSONL file as it finishes, and a
// rerun with the same --out skips URLs already recorded.
//
//   TRANSCRIPTFETCH_API_KEY=... SUPADATA_API_KEY=... \
//     node bench.mjs --corpus corpus/youtube.tsv --mode captions --out results/mine/youtube.jsonl
//   TRANSCRIPTFETCH_API_KEY=... TRANSCRIPTAPI_API_KEY=... \
//     node bench.mjs --competitor=transcriptapi --corpus corpus/transcriptapi/youtube.tsv \
//       --mode captions --max-charged=100 --out results/mine/youtube.jsonl
//
// Paid credits are protected two ways. Before each URL is sent, a line is
// appended to <out>.started; a rerun skips any URL listed there even if its
// result never got written (a crash mid-request), so no URL is ever billed
// twice. And --max-charged=N stops the run once N competitor responses that
// the competitor bills for (HTTP 200 on TranscriptAPI) have been recorded.
//
// No dependencies; Node 18 or newer (global fetch).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);

const CORPUS = args.corpus;
const OUT = args.out;
const MODE = args.mode ?? "captions"; // captions | auto
const POLL_MS = Number(args.interval ?? 1000);
const TIMEOUT_MS = Number(args.timeout ?? 300_000);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const BYPASS = args["bypass-cache"] === "true";
const TF_BASE = (args["tf-base"] ?? "https://transcriptfetch.com").replace(/\/$/, "");
const SD_BASE = (args["supadata-base"] ?? "https://api.supadata.ai/v1").replace(/\/$/, "");
const TA_BASE = (args["transcriptapi-base"] ?? "https://transcriptapi.com/api/v2").replace(/\/$/, "");
const COMPETITOR = args.competitor ?? "supadata"; // supadata | transcriptapi
const MAX_CHARGED = args["max-charged"] ? Number(args["max-charged"]) : Infinity;
// Optional: save each competitor response body here (one file per video), so
// a parsing mistake can be corrected offline instead of paying to re-fetch.
// Transcripts are third-party content: keep this directory out of git.
const RAW_DIR = args["raw-dir"] ?? null;
const TF_KEY = process.env.TRANSCRIPTFETCH_API_KEY;
const SD_KEY = process.env.SUPADATA_API_KEY;
const TA_KEY = process.env.TRANSCRIPTAPI_API_KEY;
const COMPETITOR_KEY = { supadata: SD_KEY, transcriptapi: TA_KEY }[COMPETITOR];

if (!CORPUS || !OUT || !["captions", "auto"].includes(MODE) || !["supadata", "transcriptapi"].includes(COMPETITOR)) {
  console.error("usage: node bench.mjs --corpus=<file.tsv> --out=<file.jsonl> [--competitor=supadata|transcriptapi] [--mode=captions|auto] [--interval=1000] [--timeout=300000] [--limit=N] [--max-charged=N] [--raw-dir=<dir>]");
  process.exit(2);
}
if (COMPETITOR === "transcriptapi" && MODE !== "captions") {
  console.error("TranscriptAPI returns YouTube captions only; use --mode=captions.");
  process.exit(2);
}
if (!TF_KEY || !COMPETITOR_KEY) {
  console.error(`Set TRANSCRIPTFETCH_API_KEY and ${COMPETITOR === "supadata" ? "SUPADATA_API_KEY" : "TRANSCRIPTAPI_API_KEY"}.`);
  process.exit(2);
}

// Corpus: one URL per line, optional tab-separated columns after it
// (query, duration). Lines starting with # are comments.
const corpus = readFileSync(CORPUS, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [url, query = null, duration = null] = line.split("\t");
    return { url, query, durationSec: duration ? Number(duration) : null };
  })
  .slice(0, LIMIT);

const recorded = existsSync(OUT)
  ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const STARTED = `${OUT}.started`;
const started = new Set(
  existsSync(STARTED) ? readFileSync(STARTED, "utf8").split("\n").filter(Boolean) : [],
);
const done = new Set([...recorded.map((r) => r.url), ...started]);
const billed = (side) => (COMPETITOR === "transcriptapi" ? side?.status === 200 : side?.ok === true);
let charged = recorded.filter((r) => billed(r[COMPETITOR])).length;
const lost = [...started].filter((u) => !recorded.some((r) => r.url === u));
if (lost.length) console.log(`skipping ${lost.length} URL(s) sent before an interruption with no recorded result: ${lost.join(" ")}`);
mkdirSync(dirname(OUT), { recursive: true });
if (RAW_DIR) mkdirSync(RAW_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function call(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { non_json: text.slice(0, 200) };
  }
  return { status: res.status, body, text, headers: res.headers };
}

const textLength = (value) => {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((n, seg) => n + (seg?.text?.length ?? 0), 0);
  return null;
};

// ── TranscriptFetch: POST /api/v2/transcripts/video, 202 => poll the job ──
async function transcriptfetch(url) {
  const t0 = now();
  let polls = 0;
  const headers = { authorization: `Bearer ${TF_KEY}`, "content-type": "application/json" };
  try {
    const body = { video: url, timestamps: false, ...(MODE === "captions" ? { mode: "captions" } : {}) };
    let r = await call(`${TF_BASE}/api/v2/transcripts/video`, {
      method: "POST",
      headers: { ...headers, ...(BYPASS ? { "x-tf-bypass-cache": "1" } : {}) },
      body: JSON.stringify(body),
    });
    const path = r.status === 202 ? "job" : "sync";
    if (r.status === 202 && r.body?.poll_url) {
      const pollUrl = new URL(r.body.poll_url, TF_BASE).toString();
      while (now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        polls++;
        r = await call(pollUrl, { headers });
        if (r.body?.status === "completed" || r.body?.status === "failed") break;
      }
    }
    const data = r.body?.data ?? {};
    const chars = textLength(data.text ?? data.segments);
    const ok = r.status === 200 && r.body?.ok !== false && r.body?.status !== "failed" && !!chars;
    return {
      ok,
      status: r.status,
      ms: Math.round(now() - t0),
      path,
      polls,
      source: data.source ?? null,
      language: data.language ?? null,
      chars,
      error: ok ? null : r.body?.error?.code ?? r.body?.error?.message ?? (r.status === 200 && !chars ? "empty_transcript" : r.body?.status ?? `HTTP ${r.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(now() - t0), path: null, polls, source: null, language: null, chars: null, error: String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e) };
  }
}

// ── Supadata: GET /v1/transcript, 202 {jobId} => poll /v1/transcript/{jobId} ──
async function supadata(url) {
  const t0 = now();
  let polls = 0;
  const headers = { "x-api-key": SD_KEY };
  try {
    const q = new URL(`${SD_BASE}/transcript`);
    q.searchParams.set("url", url);
    q.searchParams.set("text", "true");
    q.searchParams.set("mode", MODE === "captions" ? "native" : "auto");
    let r = await call(q.toString(), { headers });
    const path = r.status === 202 ? "job" : "sync";
    const jobId = r.status === 202 ? r.body?.jobId : null;
    if (jobId) {
      while (now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        polls++;
        r = await call(`${SD_BASE}/transcript/${jobId}`, { headers });
        if (r.body?.status === "completed" || r.body?.status === "failed") break;
        if (r.status !== 200 && r.status !== 202) break;
      }
    }
    const chars = textLength(r.body?.content);
    const ok = r.status === 200 && r.body?.status !== "failed" && !!chars;
    return {
      ok,
      status: r.status,
      ms: Math.round(now() - t0),
      path,
      polls,
      source: path === "job" ? "generated" : MODE === "captions" ? "native" : null,
      language: r.body?.lang ?? null,
      chars,
      error: ok ? null : r.body?.error ?? r.body?.message ?? (r.status === 200 && !chars ? "empty_transcript" : r.body?.status ?? `HTTP ${r.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(now() - t0), path: null, polls, source: null, language: null, chars: null, error: String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e) };
  }
}

// ── TranscriptAPI: GET /api/v2/youtube/transcript, synchronous ──
// Billing (their docs, 2026-09-29): 1 credit per HTTP 200, cached answers
// included; 4xx/5xx and 429 cost nothing. X-Cache-Status says whether the
// answer came from their cache (HIT, PARTIAL-HIT, MISS).
async function transcriptapi(url) {
  const t0 = now();
  try {
    const q = new URL(`${TA_BASE}/youtube/transcript`);
    q.searchParams.set("video_url", url);
    q.searchParams.set("format", "json");
    q.searchParams.set("include_timestamp", "false");
    const r = await call(q.toString(), { headers: { authorization: `Bearer ${TA_KEY}` } });
    const ms = Math.round(now() - t0);
    if (RAW_DIR) {
      const id = new URL(url).searchParams.get("v") ?? url.replace(/\W+/g, "_").slice(-40);
      writeFileSync(`${RAW_DIR}/${id}.json`, JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: r.text }) + "\n");
    }
    const chars = textLength(r.body?.transcript) ?? (r.status === 200 && r.body?.non_json ? r.text.length : null);
    const ok = r.status === 200 && !!chars;
    const detail = r.body?.detail;
    return {
      ok,
      status: r.status,
      ms,
      path: "sync",
      polls: 0,
      source: r.body?.language ? (String(r.body.language).startsWith("asr") ? "auto_captions" : "captions") : null,
      language: r.body?.language ?? null,
      chars,
      cache: r.headers.get("x-cache-status"),
      error: ok ? null : typeof detail === "string" ? detail : detail?.reason ?? detail?.message ?? (r.status === 200 ? "empty_transcript" : `HTTP ${r.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(now() - t0), path: null, polls: 0, source: null, language: null, chars: null, cache: null, error: String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e) };
  }
}

const competitor = { supadata, transcriptapi }[COMPETITOR];
const short = COMPETITOR === "supadata" ? "sd" : "ta";
let i = 0;
for (const item of corpus) {
  i++;
  if (done.has(item.url)) continue;
  if (charged >= MAX_CHARGED) {
    console.log(`stopping: ${charged} billed ${COMPETITOR} responses recorded (--max-charged=${MAX_CHARGED})`);
    break;
  }
  appendFileSync(STARTED, item.url + "\n");
  const startedAt = new Date().toISOString();
  const [tf, other] = await Promise.all([transcriptfetch(item.url), competitor(item.url)]);
  // 402 is "out of credits / no plan" on either side: an account problem, not
  // a result. Stop without recording the row and un-journal the URL (a 402 is
  // never billed), so a top-up and a rerun measure it properly.
  if (tf.status === 402 || other.status === 402) {
    writeFileSync(STARTED, readFileSync(STARTED, "utf8").split("\n").filter((u) => u && u !== item.url).join("\n") + "\n");
    console.log(`stopping: HTTP 402 from ${tf.status === 402 ? "TranscriptFetch" : COMPETITOR} (${tf.status === 402 ? tf.error : other.error}) at ${item.url}; nothing recorded for it`);
    process.exit(3);
  }
  const row = { ...item, mode: MODE, startedAt, competitor: COMPETITOR, transcriptfetch: tf, [COMPETITOR]: other };
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  if (billed(other)) charged++;
  const fmt = (s) => (s.ok ? `${(s.ms / 1000).toFixed(1)}s` : `FAIL(${s.error})`);
  console.log(`[${i}/${corpus.length}] tf ${fmt(tf)}  ${short} ${fmt(other)}${other.cache ? ` cache=${other.cache}` : ""}  billed=${charged}  ${item.url}`);
}
