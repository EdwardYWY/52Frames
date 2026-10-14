#!/usr/bin/env node
// Benchmark the movie view in a real browser: open a movie, switch dates, close it.
// Needs Playwright (not a project dependency): `npm i -g playwright` or NODE_PATH to one.
//
//   node scripts/bench-movie-view.mjs --snapshot showtimes.json [--site site] [--cpu 4] [--runs 3]
//
// --group time|cinema picks the schedule layout. --snapshot is a published data/showtimes.json (its generated_at is moved to now so it isn't
// stale). --cpu slows the CPU down like a phone (Chrome DevTools throttling). Reports, per action,
// the time until the next frame and where the main thread spent it: our own functions (inclusive,
// from a CPU profile), style recalculation and layout.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const siteDir = resolve(args.site || "site");
const cpu = Number(args.cpu || 1);
const runs = Number(args.runs || 3);
const group = args.group || "time";
// The profiler's sampling slows the page a little; --profile 0 gives clean timings without the breakdown.
const profiling = args.profile !== "0";
if (!args.snapshot) throw new Error("--snapshot <showtimes.json> is required");
const snapshot = JSON.parse(readFileSync(args.snapshot, "utf8"));
snapshot.generated_at = new Date().toISOString();
const snapshotBody = JSON.stringify(snapshot);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const require = createRequire(join(process.execPath, "../../lib/node_modules/"));
  ({ chromium } = require("playwright"));
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/data/showtimes.json")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(snapshotBody);
  }
  const file = join(siteDir, path === "/" ? "index.html" : path);
  if (!file.startsWith(siteDir) || !existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Only our own server: posters and the chains' APIs would add network noise.
await page.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
await page.addInitScript((g) => localStorage.setItem("showtimes:prefs", JSON.stringify({ area: "", group: g, hideConcerts: true })), group);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 50 });

await page.goto(origin + "/");
await page.waitForFunction(() => document.querySelectorAll("#grid a.card").length > 5 && /updated/.test(document.querySelector("#progress-text").textContent));
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

/** Inclusive self+children time per named function, from a CPU profile. */
function byFunction(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const totals = new Map();
  const deltas = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (deltas[i + 1] ?? 0) / 1000;
    const seen = new Set();
    for (let id = profile.samples[i]; id != null; id = parent.get(id)) {
      const f = nodes.get(id).callFrame;
      if (!f.url.startsWith(origin) || !f.functionName) continue;
      const name = `${f.functionName} (${f.url.split("/").pop().split("?")[0]})`;
      if (seen.has(name)) continue;
      seen.add(name);
      totals.set(name, (totals.get(name) || 0) + dt);
    }
  }
  return totals;
}

/** Run an action, wait for the next frame after it, and break the time down. */
async function measure(label, action) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
  const before = await metrics();
  if (profiling) await cdp.send("Profiler.start");
  const t0 = Date.now();
  await action();
  // The work is synchronous plus microtasks; two frames later it has been painted.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wall = Date.now() - t0;
  const profile = profiling ? (await cdp.send("Profiler.stop")).profile : { nodes: [], samples: [], timeDeltas: [] };
  const after = await metrics();
  const d = (k) => (after[k] - before[k]) * 1000;
  return { label, wall, script: d("ScriptDuration"), style: d("RecalcStyleDuration"), layout: d("LayoutDuration"), fns: byFunction(profile) };
}

const results = [];
for (let run = 0; run < runs; run++) {
  // The movie with the most shows: the worst case for the schedule.
  results.push(await measure("open movie", () => page.locator("#grid a.card").first().click()));
  await page.waitForSelector("#sheet:not([hidden]) #m-dates input");
  const dates = await page.$$eval("#m-dates input", (inputs) => inputs.map((i) => i.value));
  for (const date of dates.slice(1, 6).concat(dates[0])) {
    results.push(await measure("switch date", () => page.locator(`#m-dates input[value="${date}"]`).dispatchEvent("click")));
  }
  results.push(await measure("close movie", () => page.locator("#sheet .sheet-backdrop").dispatchEvent("click")));
  await page.waitForSelector("#sheet[hidden]", { state: "attached" });
}

await browser.close();
server.close();

const fmt = (n) => n.toFixed(1).padStart(7);
console.log(`site=${siteDir} cpu=${cpu}x group=${group} runs=${runs} shows=${snapshot.shows.length}\n`);
for (const label of ["open movie", "switch date", "close movie"]) {
  const rows = results.filter((r) => r.label === label);
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const wall = avg("wall");
  console.log(`== ${label} (n=${rows.length})  next frame ${wall.toFixed(0)} ms  |  script ${avg("script").toFixed(0)}  style ${avg("style").toFixed(0)}  layout ${avg("layout").toFixed(0)} ms`);
  const fns = new Map();
  for (const r of rows) for (const [k, v] of r.fns) fns.set(k, (fns.get(k) || 0) + v / rows.length);
  const top = [...fns].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top || 14));
  for (const [name, ms] of top) console.log(`  ${fmt(ms)} ms ${fmt((ms / wall) * 100)}%  ${name}`);
  console.log();
}
