// GSC and TGV: fetch + parse, run in the visitor's browser.
// Ports cinema_showtimes/gsc.py and tgv.py. If a chain changes its API, change both.
//
// Nothing here touches the page. Network and XML parsing are injectable so Node tests can
// run the parsers against tests/fixtures/ without a browser.

import { floatOrNull, intOrNull, makeShowtime, normalizeSubtitles } from "./models.js?v=7";

// ---------------------------------------------------------------------------- GSC

export const GSC = {
  chain: "GSC",
  locationsUrl: "https://epaymentapi.gsc.com.my/gsc/epay/GetEpaymentLocations",
  showtimesUrl:
    "https://epaymentapi.gsc.com.my/showtimews/service.asmx/getShowTimesByLocation_ParentChild_V2",
  bookingBase: "https://epaymentwebapp.gsc.com.my/showtime-by-movies",
};

export function parseGscCinemas(payload) {
  const locations = payload?.Response?.Body?.Locations || [];
  return locations
    .filter((loc) => !loc.IsEpayHidden)
    .map((loc) => ({
      chain: GSC.chain,
      cinema_id: String(loc.CinemaCode),
      name: loc.EpaymentName || loc.CinemaName || "",
      region: loc.Region || "",
      state: "",
      // Premium venues (Aurum, Velvet, ...) list nothing unless their hall group is sent.
      hall_group: loc.HallGroup || "",
      latitude: floatOrNull(loc.Latitude),
      longitude: floatOrNull(loc.Longitude),
    }));
}

// Python's urllib.parse.quote(s, safe=""): like encodeURIComponent, but also escapes !'()*
function pyQuote(text) {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function gscBookingUrl(parentCode, title) {
  const slug = title.trim().toLowerCase().replace(/\s+/g, "-");
  return `${GSC.bookingBase}/${parentCode}/${pyQuote(slug)}`;
}

const attr = (node, name) => node.getAttribute(name) ?? "";

function gscStart(day, hhmm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}$/.test(hhmm)) {
    throw new Error(`unexpected GSC show time ${day} ${hhmm}`);
  }
  return `${day}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

/** Browser XML adapter. Tests pass their own `parseXml` with the same tiny interface. */
export function domParseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("GSC sent invalid XML");
  return doc;
}

/**
 * Parse GSC's showtimes XML. `parseXml(text)` must return a node with
 * getElementsByTagName(name) (descendants, document order) and getAttribute(name).
 */
export function parseGscShowtimes(xmlText, cinema, parseXml = domParseXml) {
  const root = parseXml(xmlText);
  const shows = [];
  for (const oprn of root.getElementsByTagName("oprn")) {
    const businessDate = attr(oprn, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new Error(`unexpected GSC business date ${businessDate}`);
    }
    for (const parent of oprn.getElementsByTagName("parent")) {
      const title = attr(parent, "title");
      const bookingUrl = gscBookingUrl(attr(parent, "code"), title);
      for (const child of parent.getElementsByTagName("child")) {
        for (const show of child.getElementsByTagName("show")) {
          const hall = attr(show, "hname");
          shows.push(
            makeShowtime({
              chain: GSC.chain,
              cinema_id: cinema.cinema_id,
              cinema_name: cinema.name,
              region: cinema.region,
              movie_title: title,
              start: gscStart(attr(show, "date"), attr(show, "time")),
              business_date: businessDate,
              experience: attr(show, "type"),
              hall: /^\d+$/.test(hall) ? `Hall ${hall}` : hall,
              duration_mins: intOrNull(attr(child, "duration")),
              rating: attr(child, "rating"),
              language: attr(child, "lang"),
              genres: attr(child, "genre") ? [attr(child, "genre")] : [],
              sold_out: attr(show, "hallfull") === "1",
              booking_url: bookingUrl,
              poster_url: attr(child, "thumb_big"),
              poster_small_url: attr(child, "thumb_medium"),
              latitude: cinema.latitude ?? null,
              longitude: cinema.longitude ?? null,
            }),
          );
        }
      }
    }
  }
  return shows;
}

// GSC's showtime data has no subtitles; its public movie pages (www.gsc.com.my/movie/<slug>/) do.
// Those pages are server-rendered HTML with no data feed, so only the snapshot job reads them
// (once per movie per run), never the visitor's browser.

GSC.siteUrl = "https://www.gsc.com.my";

/** Movie page slugs linked from the GSC homepage. */
export function gscMovieSlugs(html) {
  return [...new Set([...String(html).matchAll(/href="\/movie\/([a-z0-9-]+)\/?"/g)].map((m) => m[1]))];
}

const squash = (text) => String(text).toLowerCase().replace(/&amp;/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * The slug of a GSC title: its letters and digits match the slug's, with or without a leading
 * "(RERUN)"-style tag. GSC cuts slugs at 50 characters, so a long slug may match a title's start.
 */
export function findGscSlug(title, slugs) {
  for (const candidate of [title, String(title).replace(/[([][^)\]]*[)\]]/g, " ")]) {
    const want = squash(candidate);
    if (!want) continue;
    const exact = slugs.find((slug) => squash(slug) === want);
    if (exact) return exact;
    const cut = slugs.find((slug) => slug.length >= 45 && want.startsWith(squash(slug)));
    if (cut) return cut;
  }
  return null;
}

/** Subtitles from a GSC movie page ("BM / CHI / ENG"), or null when the page doesn't say. */
export function parseGscSubtitles(html) {
  const match = />Subtitles<\/span>\s*<span[^>]*>\s*:?\s*([^<]*)<\/span>/.exec(String(html));
  return match ? normalizeSubtitles(match[1].split("/")) : null;
}

// ---------------------------------------------------------------------------- TGV

export const TGV = {
  chain: "TGV",
  statesUrl: "https://api.tgv.com.my/api/cinemas/v1/getstatecinema",
  sessionsUrl: "https://api.tgv.com.my/api/boxoffice/v1/moviesession_get",
  movieUrl: "https://www.tgv.com.my/movies/details",
  infoUrl: "https://www.tgv.com.my/movie",
};

// TGV groups cinemas by state; map them onto the shared regions GSC uses.
export const TGV_STATE_TO_REGION = {
  klangvalley: "Klang Valley",
  selangor: "Klang Valley",
  kualalumpur: "Klang Valley",
  pinang: "Northern",
  perak: "Northern",
  kedah: "Northern",
  perlis: "Northern",
  johor: "Southern",
  melaka: "Southern",
  negerisembilan: "Southern",
  pahang: "East Coast",
  terengganu: "East Coast",
  kelantan: "East Coast",
  sabah: "East Malaysia",
  sarawak: "East Malaysia",
};

// "PAVILION KUALA LUMPUR (NEW)" -> "Pavilion Kuala Lumpur (New)"; skips leading punctuation.
function titleCase(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const i = word.search(/\p{L}/u);
      if (i < 0) return word;
      const ch = String.fromCodePoint(word.codePointAt(i));
      return word.slice(0, i) + ch.toUpperCase() + word.slice(i + ch.length).toLowerCase();
    })
    .join(" ");
}

export function parseTgvCinemas(payload) {
  const cinemas = [];
  const seen = new Set();
  for (const state of payload?.results || []) {
    if (state.value === "all") continue;
    const region = TGV_STATE_TO_REGION[state.value ?? ""] ?? state.label ?? "";
    for (const item of state.cinemas || []) {
      const id = item.cinemaid;
      if (seen.has(id)) continue;
      seen.add(id);
      let name = titleCase(item.name ?? id);
      if (!name.toUpperCase().startsWith("TGV")) name = `TGV ${name}`;
      cinemas.push({
        chain: TGV.chain,
        cinema_id: id,
        name,
        region,
        state: state.label ?? "",
        hall_group: "",
        latitude: null,
        longitude: null,
      });
    }
  }
  return cinemas;
}

function tgvStart(value) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value ?? "");
  if (!match) throw new Error(`unexpected TGV show time ${value}`);
  return `${match[1]}T${match[2]}`;
}

function tgvPosterUrl(info) {
  const poster = (info.assets || []).find((asset) => asset?.assetkey === "poster");
  return poster?.extdata?.fileinfo?.fileurl || "";
}

// Google Maps embed links carry the point as "!2d<longitude>!3d<latitude>".
const MAP_POINT_RE = /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/;

function tgvMapPoint(dayCinema) {
  const match = MAP_POINT_RE.exec(dayCinema.extdata?.cinema?.mapurl || "");
  return match ? [floatOrNull(match[2]), floatOrNull(match[1])] : [null, null];
}

export function parseTgvShowtimes(payload, cinema) {
  if (!payload?.success) return [];
  const results = payload.results || {};
  const movies = new Map((results.movies || []).map((m) => [m.recid, m]));
  const shows = [];
  for (const dayCinema of results.businessday?.cinemas || []) {
    const [latitude, longitude] = tgvMapPoint(dayCinema);
    for (const movie of dayCinema.movies || []) {
      const info = movies.get(movie.movieid) || {};
      const movieinfo = info.extdata?.movieinfo || {};
      const title = info.name || "Unknown movie";
      const bookingUrl = info.itemkey ? `${TGV.movieUrl}/${info.itemkey}` : "";
      const posterUrl = tgvPosterUrl(info);
      const infoUrl = info.itemkey ? `${TGV.infoUrl}/${info.itemkey}` : "";
      const subtitles = "subtitlelang" in movieinfo ? normalizeSubtitles(movieinfo.subtitlelang) : null;
      for (const experience of movie.experiences || []) {
        for (const session of experience.sessions || []) {
          shows.push(
            makeShowtime({
              chain: TGV.chain,
              cinema_id: cinema.cinema_id,
              cinema_name: cinema.name,
              region: cinema.region,
              movie_title: title,
              start: tgvStart(session.showtimemy),
              business_date: String(session.businessdate).slice(0, 10),
              experience: (session.experience || "").toUpperCase(),
              hall: session.screenname || "",
              duration_mins: intOrNull(movieinfo.runtimemins),
              rating: String(movieinfo.rating || ""),
              language: movieinfo.lang || "",
              genres: movieinfo.genre || [],
              tags: Array.isArray(info.extdata?.tags) ? info.extdata.tags : info.extdata?.tags ? [info.extdata.tags] : [],
              booking_url: bookingUrl,
              poster_url: posterUrl,
              subtitles,
              info_url: infoUrl,
              latitude,
              longitude,
            }),
          );
        }
      }
    }
  }
  return shows;
}

// ---------------------------------------------------------------------------- network

export const REQUEST_TIMEOUT_MS = 20000;

async function request(fetchImpl, url, init = {}, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err?.name === "AbortError") throw new Error("timed out");
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The two chains, each with fetchCinemas() and fetchShowtimes(cinema, isoDate). */
export function createProviders({
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  parseXml = domParseXml,
} = {}) {
  return {
    GSC: {
      async fetchCinemas(signal) {
        const res = await request(fetchImpl, GSC.locationsUrl, {}, signal);
        return parseGscCinemas(await res.json());
      },
      async fetchShowtimes(cinema, day, signal) {
        const params = new URLSearchParams({
          locationid: cinema.cinema_id,
          oprndate: day,
          hallGroup: cinema.hall_group || "",
        });
        const res = await request(fetchImpl, `${GSC.showtimesUrl}?${params}`, {}, signal);
        return parseGscShowtimes(await res.text(), cinema, parseXml);
      },
    },
    TGV: {
      async fetchCinemas(signal) {
        const res = await request(fetchImpl, TGV.statesUrl, {}, signal);
        return parseTgvCinemas(await res.json());
      },
      async fetchShowtimes(cinema, day, signal) {
        const res = await request(
          fetchImpl,
          TGV.sessionsUrl,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cinemaid: cinema.cinema_id, businessdate: day }),
          },
          signal,
        );
        return parseTgvShowtimes(await res.json(), cinema);
      },
    },
  };
}
