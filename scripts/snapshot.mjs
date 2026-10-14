#!/usr/bin/env node
// Build the shared snapshot (site/js/snapshot.js): every GSC and TGV cinema, today + 6 days,
// in one compact file. Run by .github/workflows/pages.yml every 6 hours.
//
//   node scripts/snapshot.mjs --out _site/data/showtimes.json [--days 7]
//   node scripts/snapshot.mjs --out ... --reuse https://edwardywy.github.io/52Frames/data/showtimes.json
//
// --reuse copies the published snapshot instead of fetching (used when a push redeploys the site,
// so code changes don't add load on the chains); it fetches only if that copy is missing or stale.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { collectShowtimes, createCache } from "../site/js/aggregator.js";
import { addDays, todayMyt } from "../site/js/models.js";
import { createProviders } from "../site/js/providers.js";
import { SNAPSHOT_MAX_AGE_MS, decodeSnapshot, encodeSnapshot } from "../site/js/snapshot.js";
import { parseXml } from "./xml.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const out = args.out || "_site/data/showtimes.json";
const dayCount = Number(args.days || 7);
const CONCURRENCY = 4; // gentler than the browser's 6; nobody is waiting on this

const USER_AGENT = "Mozilla/5.0 (compatible; 52frames-showtimes/1.0; +https://edwardywy.github.io/52Frames/)";
const politeFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, "user-agent": USER_AGENT } });

function write(json) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`wrote ${out} (${(json.length / 1024).toFixed(0)} KB)`);
}

async function reuse(url) {
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const snap = JSON.parse(text);
    decodeSnapshot(snap); // must be readable by this version of the site
    const age = Date.now() - Date.parse(snap.generated_at);
    if (age > SNAPSHOT_MAX_AGE_MS) throw new Error(`too old (${Math.round(age / 3600000)} h)`);
    write(text);
    console.log(`reused published snapshot from ${snap.generated_at}`);
    return true;
  } catch (err) {
    console.log(`can't reuse ${url}: ${err.message}; fetching instead`);
    return false;
  }
}

async function build() {
  const providers = createProviders({ fetch: politeFetch, parseXml });
  const cache = createCache(null); // memory only: the cinema lists are fetched once per run
  const today = todayMyt();
  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(today, i);
    const started = Date.now();
    const result = await collectShowtimes(date, { providers, cache, concurrency: CONCURRENCY });
    console.log(
      `${date}: ${result.showtimes.length} shows, ${result.cinemas.length} cinemas, ` +
        `${result.errors.length} errors, ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    for (const e of result.errors) console.log(`  ! ${e}`);
    days.push({ date, ...result });
  }
  const total = days.reduce((n, d) => n + d.showtimes.length, 0);
  // Every cinema failing (e.g. an API change) must not replace a good snapshot with an empty one.
  if (!total && days.every((d) => d.errors.length)) throw new Error("no showtimes at all, every day had errors");
  write(JSON.stringify(encodeSnapshot(days, new Date().toISOString())));
}

if (!(args.reuse && (await reuse(args.reuse)))) await build();
