// Parser tests for site/js/providers.js, mirroring tests/test_providers.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  createProviders,
  parseGscCinemas,
  parseGscShowtimes,
  parseTgvCinemas,
  parseTgvShowtimes,
} from "../../site/js/providers.js";
import { parseXml } from "../../scripts/xml.mjs";

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const json = (name) => JSON.parse(fixture(name));

const gscCinema = () => parseGscCinemas(json("gsc_locations.json"))[0];
const gscShows = () => parseGscShowtimes(fixture("gsc_showtimes_120.xml"), gscCinema(), parseXml);
const tgvCinema = () => parseTgvCinemas(json("tgv_states.json"))[0];
const tgvShows = () => parseTgvShowtimes(json("tgv_sessions_PKL.json"), tgvCinema());

test("GSC: parses locations with region and hall group", () => {
  const cinemas = parseGscCinemas(json("gsc_locations.json"));
  assert.equal(cinemas.length, 2);
  const [queensbay, aurum] = cinemas;
  assert.equal(queensbay.chain, "GSC");
  assert.equal(queensbay.cinema_id, "120");
  assert.equal(queensbay.name, "Penang - Queensbay Mall");
  assert.equal(queensbay.region, "Northern");
  assert.equal(queensbay.hall_group, "");
  assert.equal(aurum.region, "Klang Valley");
  assert.equal(aurum.hall_group, "AURUMTRX");
  assert.deepEqual([queensbay.latitude, queensbay.longitude], [5.33306, 100.30667]);
});

test("GSC: parses every show", () => {
  assert.equal(gscShows().length, 5);
});

test("GSC: show fields", () => {
  const first = gscShows()[0];
  assert.equal(first.chain, "GSC");
  assert.equal(first.cinema_name, "Penang - Queensbay Mall");
  assert.equal(first.region, "Northern");
  assert.equal(first.movie_title, "Go For Broke 2");
  assert.equal(first.start, "2026-10-15T17:15");
  assert.equal(first.business_date, "2026-10-15");
  assert.equal(first.experience, "2D");
  assert.equal(first.hall, "Hall 5");
  assert.equal(first.duration_mins, 132);
  assert.equal(first.rating, "18");
  assert.equal(first.language, "MAN");
  assert.equal(first.sold_out, false);
  assert.match(first.booking_url, /showtime-by-movies\/6495/);
});

test("GSC: posters come from the child film", () => {
  const first = gscShows()[0];
  assert.equal(first.poster_url, "https://poster.gsc.com.my/2026/261012_GoForBroke2_big.jpg");
  assert.equal(first.poster_small_url, "https://poster.gsc.com.my/2026/261012_GoForBroke2_med.jpg");
});

test("GSC: after-midnight show keeps its business date", () => {
  const late = gscShows().filter((s) => s.start.startsWith("2026-10-16"));
  assert.equal(late.length, 1);
  assert.equal(late[0].start, "2026-10-16T00:15");
  assert.equal(late[0].business_date, "2026-10-15");
  assert.equal(late[0].experience, "IMAX");
  assert.equal(late[0].sold_out, true);
});

test("GSC: title tags are stripped for matching", () => {
  const special = gscShows().filter((s) => s.movie_title.includes("Good Trip"));
  assert.equal(special[0].movie_title, "(SPECIAL) Good Trip");
  assert.equal(special[0].movie_key, "good trip");
});

test("GSC: empty response returns no shows", () => {
  const empty = '<?xml version="1.0" encoding="utf-8"?><films><filters /></films>';
  assert.deepEqual(parseGscShowtimes(empty, gscCinema(), parseXml), []);
});

test("TGV: parses states, skipping the 'all' bucket", () => {
  const cinemas = parseTgvCinemas(json("tgv_states.json"));
  assert.deepEqual(
    cinemas.map((c) => c.cinema_id),
    ["PKL", "BI0"],
  );
  const [pkl, bukitIndah] = cinemas;
  assert.equal(pkl.chain, "TGV");
  assert.equal(pkl.name, "TGV Pavilion Kuala Lumpur (New)");
  assert.equal(pkl.region, "Klang Valley");
  assert.equal(pkl.state, "Klang Valley");
  assert.equal(bukitIndah.name, "TGV Bukit Indah");
  assert.equal(bukitIndah.region, "Southern");
  assert.equal(bukitIndah.state, "Johor");
});

test("TGV: parses every session", () => {
  assert.equal(tgvShows().length, 9);
});

test("TGV: show fields", () => {
  const indulge = tgvShows().find((s) => s.experience === "INDULGE");
  assert.equal(indulge.chain, "TGV");
  assert.equal(indulge.movie_title, "Other Mommy");
  assert.equal(indulge.movie_key, "other mommy");
  assert.equal(indulge.start, "2026-10-14T13:45");
  assert.equal(indulge.business_date, "2026-10-14");
  assert.equal(indulge.hall, "INDULGE 2");
  assert.equal(indulge.duration_mins, 93);
  assert.equal(indulge.rating, "16");
  assert.equal(indulge.language, "English");
  assert.equal(indulge.booking_url, "https://www.tgv.com.my/movies/details/other-mommy");
});

test("TGV: the poster asset is used, missing ones are blank", () => {
  const mommy = tgvShows().find((s) => s.movie_title === "Other Mommy");
  assert.ok(mommy.poster_url.endsWith("d1d22010-1a21-4f66-b272-39d8727fed90.jpg"));
  assert.equal(mommy.poster_small_url, "");
  assert.equal(tgvShows().find((s) => s.movie_title === "Digger").poster_url, "");
});

test("TGV: cinema location comes from the map link", () => {
  const first = tgvShows()[0];
  assert.ok(Math.abs(first.latitude - 3.1489607) < 1e-6);
  assert.ok(Math.abs(first.longitude - 101.7134125) < 1e-6);
});

test("TGV: blank runtime becomes null", () => {
  const digger = tgvShows().find((s) => s.movie_title === "Digger");
  assert.equal(digger.duration_mins, null);
});

test("TGV: failed response returns no shows", () => {
  const failed = { success: false, error: { code: "x", message: "nope" } };
  assert.deepEqual(parseTgvShowtimes(failed, tgvCinema()), []);
});

test("fetchers call the same endpoints as the Python code", async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    const isGsc = String(url).includes("gsc");
    const body = isGsc ? fixture("gsc_showtimes_120.xml") : fixture("tgv_sessions_PKL.json");
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  const providers = createProviders({ fetch: fakeFetch, parseXml });
  const aurum = parseGscCinemas(json("gsc_locations.json"))[1];

  assert.equal((await providers.GSC.fetchShowtimes(aurum, "2026-10-15")).length, 5);
  assert.equal((await providers.TGV.fetchShowtimes(tgvCinema(), "2026-10-14")).length, 9);

  assert.equal(
    calls[0].url,
    "https://epaymentapi.gsc.com.my/showtimews/service.asmx/getShowTimesByLocation_ParentChild_V2" +
      "?locationid=236&oprndate=2026-10-15&hallGroup=AURUMTRX",
  );
  assert.equal(calls[1].url, "https://api.tgv.com.my/api/boxoffice/v1/moviesession_get");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body), { cinemaid: "PKL", businessdate: "2026-10-14" });
});

test("an HTTP error is reported, not parsed", async () => {
  const providers = createProviders({
    fetch: async () => ({ ok: false, status: 503 }),
    parseXml,
  });
  await assert.rejects(providers.TGV.fetchCinemas(), /HTTP 503/);
});

test("GSC movie pages: slugs, title matching and subtitles", async () => {
  const { gscMovieSlugs, findGscSlug, parseGscSubtitles } = await import("../../site/js/providers.js");
  const slugs = gscMovieSlugs(fixture("gsc_home_links.html"));
  assert.ok(slugs.includes("rerun-la-la-land") && slugs.includes("digger"));
  assert.equal(findGscSlug("(RERUN) La La Land", slugs), "rerun-la-la-land");
  assert.equal(findGscSlug("(InfinityVision) Avengers:Endgame Encore", slugs), "infinityvision-avengersendgame-encore");
  assert.equal(findGscSlug("Spider-Man: Brand New Day ", slugs), "spiderman-brand-new-day");
  assert.equal(
    findGscSlug("Chiikawa the Movie: The Secret of the Mermaid Island", slugs),
    "chiikawa-the-movie-the-secret-of-the-mermaid-isla",
    "GSC cuts slugs at 50 characters",
  );
  assert.equal(findGscSlug("A Movie GSC Does Not List", slugs), null);
  assert.deepEqual(parseGscSubtitles(fixture("gsc_movie_rerun-la-la-land.html")), ["BM"]);
  assert.deepEqual(parseGscSubtitles('<span class="spec-label">Subtitles</span> <span class="spec-value">: BM / CHI / ENG</span>'), ["BM", "Chinese", "English"]);
  assert.equal(parseGscSubtitles("<p>no spec rows</p>"), null);
});

test("TGV: subtitles and the movie page link", () => {
  const mommy = tgvShows().find((s) => s.movie_title === "Other Mommy");
  assert.deepEqual(mommy.subtitles, ["BM", "Chinese"]);
  assert.equal(mommy.info_url, "https://www.tgv.com.my/movie/other-mommy");
  assert.deepEqual(tgvShows().find((s) => s.movie_title === "Digger").subtitles, [], "empty list = none listed");
});
