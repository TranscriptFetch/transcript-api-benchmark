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
const seen = new Set();
const lines = [`# ${PLATFORM} corpus, built ${new Date().toISOString().slice(0, 10)} from corpus/queries.json`, "# url\tquery\tduration_seconds"];
for (const q of spec.queries) {
  // Ask for extra rows so duplicates and excluded URLs can be skipped.
  const body = { query: q.query, platform: PLATFORM, limit: Math.min(50, spec.perQuery * 2), ...(spec.filters ?? {}), ...(q.filters ?? {}) };
  const res = await fetch(`${BASE}/api/v2/transcripts/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const rows = json?.data?.videos ?? json?.data?.items ?? json?.data?.results ?? [];
  let kept = 0;
  for (const row of rows) {
    if (!row?.url || seen.has(row.url) || excluded.has(row.url) || kept >= spec.perQuery) continue;
    seen.add(row.url);
    kept++;
    lines.push([row.url, q.query, row.duration ?? ""].join("\t"));
  }
  console.log(`${PLATFORM} "${q.query}": ${kept} (HTTP ${res.status})`);
}
writeFileSync(new URL(`./corpus/${PLATFORM}.tsv`, import.meta.url), lines.join("\n") + "\n");
console.log(`${PLATFORM}: ${seen.size} URLs${excluded.size ? ` (${excluded.size} excluded URLs skipped where they appeared)` : ""}`);
