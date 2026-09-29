#!/usr/bin/env node
// Idle round-trip baseline from the machine running the benchmark: five
// requests each to a cheap authenticated/health endpoint on both APIs, so a
// reader can see how much of any latency gap is just the network path.
//   TRANSCRIPTFETCH_API_KEY=... SUPADATA_API_KEY=... node network.mjs results/<run>/network.json
//   node network.mjs results/<run>/network.json transcriptapi
//
// TranscriptAPI has no health endpoint, so its baseline is an UNAUTHENTICATED
// call to its API, which the API rejects immediately: a network-and-front-door
// round trip that never reaches YouTube and never touches a credit.

import { writeFileSync } from "node:fs";

const out = process.argv[2];
const competitor = process.argv[3] ?? "supadata";
const competitors = {
  supadata: { url: "https://api.supadata.ai/v1/me", headers: { "x-api-key": process.env.SUPADATA_API_KEY ?? "" } },
  transcriptapi: { url: "https://transcriptapi.com/api/v2/youtube/info?video_url=dQw4w9WgXcQ", headers: {} },
};
const targets = {
  transcriptfetch: { url: "https://transcriptfetch.com/api/v2/health", headers: {} },
  [competitor]: competitors[competitor],
};
const result = { measuredAt: new Date().toISOString(), samples: 5 };
for (const [name, t] of Object.entries(targets)) {
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(t.url, { headers: t.headers }).then((r) => r.arrayBuffer());
    ms.push(Math.round(performance.now() - t0));
  }
  result[name] = { url: t.url, ms, min: Math.min(...ms), max: Math.max(...ms) };
}
const json = JSON.stringify(result, null, 2);
if (out) writeFileSync(out, json + "\n");
console.log(json);
