#!/usr/bin/env node
// Summarize a results directory: node summarize.mjs results/2026-09-28
// Writes summary.json and summary.md next to the JSONL files and prints the
// Markdown. Latency is compared only on videos where BOTH APIs returned a
// transcript (a failure has no meaningful time); success rates count every
// attempt.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node summarize.mjs <results-dir>");
  process.exit(2);
}

const pct = (values, p) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
};
const mean = (v) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
const sec = (ms) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

function stats(rows) {
  const pairs = rows.filter((r) => r.transcriptfetch.ok && r.supadata.ok);
  const side = (key) => {
    const ms = pairs.map((r) => r[key].ms);
    return {
      succeeded: rows.filter((r) => r[key].ok).length,
      medianMs: pct(ms, 0.5),
      p90Ms: pct(ms, 0.9),
      meanMs: mean(ms),
    };
  };
  return {
    attempted: rows.length,
    pairs: pairs.length,
    transcriptfetch: side("transcriptfetch"),
    supadata: side("supadata"),
    transcriptfetchFaster: pairs.filter((r) => r.transcriptfetch.ms < r.supadata.ms).length,
  };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
const summary = {};
const md = [`# Results: ${dir}`, ""];
for (const file of files) {
  const rows = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const name = file.replace(/\.jsonl$/, "");
  const all = stats(rows);
  // Split by how each side produced the transcript, so caption fetches and
  // AI transcriptions are never averaged together.
  const bySource = {};
  for (const r of rows) {
    const k = `transcriptfetch=${r.transcriptfetch.source ?? "none"} supadata=${r.supadata.path ?? "none"}`;
    (bySource[k] ??= []).push(r);
  }
  const failures = (key) =>
    Object.entries(
      rows.filter((r) => !r[key].ok).reduce((acc, r) => ((acc[r[key].error] = (acc[r[key].error] ?? 0) + 1), acc), {}),
    ).sort((a, b) => b[1] - a[1]);
  summary[name] = {
    mode: rows[0]?.mode ?? null,
    ...all,
    bySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, stats(v)])),
    failures: { transcriptfetch: failures("transcriptfetch"), supadata: failures("supadata") },
  };

  md.push(`## ${name} (mode: ${summary[name].mode})`, "");
  md.push("| | TranscriptFetch | Supadata |", "|---|---|---|");
  md.push(`| Transcripts returned | ${all.transcriptfetch.succeeded}/${all.attempted} | ${all.supadata.succeeded}/${all.attempted} |`);
  md.push(`| Median (both succeeded, n=${all.pairs}) | ${sec(all.transcriptfetch.medianMs)} | ${sec(all.supadata.medianMs)} |`);
  md.push(`| 90th percentile | ${sec(all.transcriptfetch.p90Ms)} | ${sec(all.supadata.p90Ms)} |`);
  md.push(`| Mean | ${sec(all.transcriptfetch.meanMs)} | ${sec(all.supadata.meanMs)} |`);
  md.push(`| Faster on | ${all.transcriptfetchFaster}/${all.pairs} | ${all.pairs - all.transcriptfetchFaster}/${all.pairs} |`, "");
  md.push("By how each side produced the transcript:", "");
  md.push("| TranscriptFetch source / Supadata path | n | both ok | TF median | Supadata median |", "|---|---|---|---|---|");
  for (const [k, s] of Object.entries(summary[name].bySource)) {
    md.push(`| ${k} | ${s.attempted} | ${s.pairs} | ${sec(s.transcriptfetch.medianMs)} | ${sec(s.supadata.medianMs)} |`);
  }
  md.push("");
  for (const key of ["transcriptfetch", "supadata"]) {
    const f = summary[name].failures[key];
    if (f.length) md.push(`${key} failures: ${f.map(([e, n]) => `${e} x${n}`).join(", ")}`, "");
  }
}

writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(join(dir, "summary.md"), md.join("\n"));
console.log(md.join("\n"));
