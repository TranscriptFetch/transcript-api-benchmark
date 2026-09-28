#!/usr/bin/env node
// Head-to-head transcript API benchmark: TranscriptFetch vs Supadata.
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
//
// No dependencies; Node 18 or newer (global fetch).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
const TF_KEY = process.env.TRANSCRIPTFETCH_API_KEY;
const SD_KEY = process.env.SUPADATA_API_KEY;

if (!CORPUS || !OUT || !["captions", "auto"].includes(MODE)) {
  console.error("usage: node bench.mjs --corpus=<file.tsv> --out=<file.jsonl> [--mode=captions|auto] [--interval=1000] [--timeout=300000] [--limit=N]");
  process.exit(2);
}
if (!TF_KEY || !SD_KEY) {
  console.error("Set TRANSCRIPTFETCH_API_KEY and SUPADATA_API_KEY.");
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

const done = new Set(
  existsSync(OUT)
    ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).url)
    : [],
);
mkdirSync(dirname(OUT), { recursive: true });

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
  return { status: res.status, body };
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

let i = 0;
for (const item of corpus) {
  i++;
  if (done.has(item.url)) continue;
  const startedAt = new Date().toISOString();
  const [tf, sd] = await Promise.all([transcriptfetch(item.url), supadata(item.url)]);
  const row = { ...item, mode: MODE, startedAt, transcriptfetch: tf, supadata: sd };
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  const fmt = (s) => (s.ok ? `${(s.ms / 1000).toFixed(1)}s` : `FAIL(${s.error})`);
  console.log(`[${i}/${corpus.length}] tf ${fmt(tf)}  sd ${fmt(sd)}  ${item.url}`);
}
