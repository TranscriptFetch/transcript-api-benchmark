#!/usr/bin/env node
// Build a corpus from keyword searches: for every query in corpus/queries.json,
// take the first N results in the platform's own relevance order, drop
// duplicates, and write corpus/<platform>.tsv (url, query, duration seconds).
// Nothing is filtered by how either API performs on it.
//
// Search goes through TranscriptFetch's search endpoint because it covers all
// three platforms with one key. Any other source of URLs works just as well:
// a corpus file is only a list of URLs, one per line.
//
//   TRANSCRIPTFETCH_API_KEY=... node build-corpus.mjs --platform=youtube
//
// Options: --exclude=<file> (URLs to leave out), --out=<file> (default
// corpus/<platform>.tsv), --max=N (take results round-robin across the
// queries until N, so every query contributes evenly), --search-limit=N
// (results requested per query, default 2 x perQuery).

import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const PLATFORM = args.platform;
const KEY = process.env.TRANSCRIPTFETCH_API_KEY;
const BASE = (args["tf-base"] ?? "https://transcriptfetch.com").replace(/\/$/, "");
const spec = JSON.parse(readFileSync(new URL("./corpus/queries.json", import.meta.url), "utf8"))[PLATFORM];
if (!spec || !KEY) {
  console.error("usage: TRANSCRIPTFETCH_API_KEY=... node build-corpus.mjs --platform=youtube|tiktok|instagram");
  process.exit(2);
}

// --exclude=<file>: URLs to leave out (one per line), e.g. ones already sent to
// either API earlier, which could now be served from a cache.
const excluded = new Set(
  args.exclude ? readFileSync(args.exclude, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [],
);
const MAX = args.max ? Number(args.max) : null;
const SEARCH_LIMIT = Math.min(50, Number(args["search-limit"] ?? spec.perQuery * 2));
const OUT_FILE = args.out ? new URL(args.out, `file://${process.cwd()}/`) : new URL(`./corpus/${PLATFORM}.tsv`, import.meta.url);
const seen = new Set();
const perQuery = []; // [{ query, rows: [[url, query, duration], ...] }]
const lines = [`# ${PLATFORM} corpus, built ${new Date().toISOString().slice(0, 10)} from corpus/queries.json${MAX ? `, ${MAX} URLs taken round-robin across the queries` : ""}`, "# url\tquery\tduration_seconds"];
for (const q of spec.queries) {
  // Ask for extra rows so duplicates and excluded URLs can be skipped.
  const body = { query: q.query, platform: PLATFORM, limit: SEARCH_LIMIT, ...(spec.filters ?? {}), ...(q.filters ?? {}) };
  const res = await fetch(`${BASE}/api/v2/transcripts/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const rows = json?.data?.videos ?? json?.data?.items ?? json?.data?.results ?? [];
  const kept = [];
  for (const row of rows) {
    if (!row?.url || seen.has(row.url) || excluded.has(row.url) || kept.length >= spec.perQuery) continue;
    seen.add(row.url);
    kept.push([row.url, q.query, row.duration ?? ""]);
  }
  perQuery.push({ query: q.query, rows: kept });
  console.log(`${PLATFORM} "${q.query}": ${kept.length} (HTTP ${res.status})`);
}
// Without --max: every query's first perQuery results, query by query.
// With --max: first result of every query, then the second of every query,
// and so on, so no topic is cut off when N is not a multiple of the query count.
const picked = [];
if (MAX) {
  for (let round = 0; picked.length < MAX && perQuery.some((q) => q.rows[round]); round++) {
    for (const q of perQuery) if (q.rows[round] && picked.length < MAX) picked.push(q.rows[round]);
  }
} else {
  for (const q of perQuery) picked.push(...q.rows);
}
for (const row of picked) lines.push(row.join("\t"));
writeFileSync(OUT_FILE, lines.join("\n") + "\n");
console.log(`${PLATFORM}: ${picked.length} URLs -> ${OUT_FILE.pathname}${excluded.size ? ` (${excluded.size} excluded URLs skipped where they appeared)` : ""}`);
