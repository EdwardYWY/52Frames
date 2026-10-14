// Page code: a poster grid of what's showing, a movie sheet with its schedule, and a panel to
// manage starred cinemas. Fetching and parsing live in providers.js; grouping and caching in
// aggregator.js.

import { collectShowtimes, createCache, filterShowtimes, summarizeMovies } from "./aggregator.js";
import { REGIONS, addDays, distanceKm, todayMyt } from "./models.js";
import { TGV_LOCATIONS } from "./places.js";
import { createProviders } from "./providers.js";
import { loadSnapshot } from "./snapshot.js";

const $ = (id) => document.getElementById(id);
const providers = createProviders();
const STARRED = "*starred"; // cinema <select> value for "starred cinemas only"

function storage(kind) {
  try {
    return window[kind];
  } catch {
    return null; // Storage blocked: run without it.
  }
}
const cache = createCache(storage("sessionStorage"));
cache.prune();

function readLocal(key, fallback) {
  try {
    const raw = storage("localStorage")?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    storage("localStorage")?.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; that's fine.
  }
}

const state = {
  shows: [],
  cinemas: [],
  errors: [],
  progress: { done: 0, total: 0 },
  loading: false,
  controller: null,
  movieKey: null, // open movie, or null for the grid
  openVenues: new Set(),
  lastSummary: new Map(), // movie key -> last summary, so the sheet keeps its header between dates
  // Starred cinemas: venue key "CHAIN|Name" -> {chain, name, region}. Kept in localStorage.
  starred: new Map(Object.entries(readLocal("showtimes:starred", {}))),
  here: null, // {latitude, longitude} once the visitor shares their location
  locating: false,
  locationError: "",
  places: new Map(), // venue key -> {latitude, longitude}
  date: todayMyt(),
  // "date|region" combos that loaded fine but had no shows: not published yet.
  emptyDates: new Set(),
};

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (start) => start.slice(11, 16);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const venueKey = (s) => `${s.chain}|${s.cinema_name}`;
const splitKey = (key) => [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
const isStarred = (key) => state.starred.has(key);

function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.toISOString().slice(0, 10)}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function runtime(mins) {
  if (!mins) return "";
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${pad2(mins % 60)}m` : `${mins}m`;
}

function dateParts(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const fmt = (opts) => d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return {
    weekday: fmt({ weekday: "short" }),
    day: d.getUTCDate(),
    month: fmt({ month: "short" }),
    long: fmt({ weekday: "long", day: "numeric", month: "long" }),
  };
}

function savePrefs() {
  writeLocal("showtimes:prefs", {
    region: $("region").value,
    chains: selectedChains(),
    group: selectedGroup(),
    location: Boolean(state.here),
  });
}

const selectedChains = () => [...document.querySelectorAll("input[name=chain]:checked")].map((c) => c.value);
const selectedGroup = () => document.querySelector("input[name=group]:checked")?.value || "cinema";
const selectedDate = () => state.date;
const regionLabel = () => $("region").selectedOptions[0].text;

// ---------------------------------------------------------------- distance

/** A cinema's location: the TGV table first (TGV's own links are patchy), then the chain's data. */
function placeOf(item) {
  const known = item.chain === "TGV" ? TGV_LOCATIONS[item.cinema_id] : null;
  if (known) return { latitude: known[0], longitude: known[1] };
  if (item.latitude != null && item.longitude != null) return { latitude: item.latitude, longitude: item.longitude };
  return null;
}

function rememberPlace(key, item) {
  if (state.places.has(key)) return;
  const place = placeOf(item);
  if (place) state.places.set(key, place);
}

const rememberPlaces = (shows) => shows.forEach((s) => rememberPlace(venueKey(s), s));
const rememberCinemaPlaces = (cinemas) => cinemas.forEach((c) => rememberPlace(`${c.chain}|${c.name}`, c));

/** km from the visitor to a venue, or null when either is unknown. */
const kmTo = (key) => (state.here ? distanceKm(state.here, state.places.get(key)) : null);

function kmLabel(km) {
  if (km == null) return "";
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function locate() {
  if (!navigator.geolocation) {
    state.locationError = "This browser can't share a location.";
    renderTools();
    return;
  }
  state.locating = true;
  state.locationError = "";
  renderTools();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.locating = false;
      state.here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      if ($("m-sort").value === "time") $("m-sort").value = "near";
      savePrefs();
      render();
    },
    (err) => {
      state.locating = false;
      state.here = null;
      state.locationError =
        err.code === err.PERMISSION_DENIED ? "Location is blocked for this site in your browser settings." : "Couldn't get your location.";
      savePrefs();
      render();
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
}

function toggleLocation() {
  if (state.here) {
    state.here = null;
    if ($("m-sort").value === "near") $("m-sort").value = "time";
    savePrefs();
    render();
  } else {
    locate();
  }
}

// ---------------------------------------------------------------- stars

function saveStars() {
  writeLocal("showtimes:starred", Object.fromEntries(state.starred));
}

function toggleStar(key, region = "") {
  if (state.starred.has(key)) state.starred.delete(key);
  else {
    const [chain, name] = splitKey(key);
    state.starred.set(key, { chain, name, region });
  }
  saveStars();
  render();
}

function starButton(key, region) {
  const on = isStarred(key);
  return el(
    "button",
    {
      type: "button",
      class: `star${on ? " on" : ""}`,
      "aria-pressed": String(on),
      "aria-label": on ? "Unstar this cinema" : "Star this cinema",
      title: on ? "Starred: listed first. Click to unstar." : "Star: always list this cinema first",
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleStar(key, region);
      },
    },
    on ? "★" : "☆",
  );
}

/** Every cinema of both chains (cached lists), for the starred-cinemas panel. */
async function allCinemas() {
  const lists = await Promise.all(
    Object.keys(providers).map(async (chain) => {
      const key = `cinemas:${chain}`; // same cache key as collectShowtimes
      try {
        let list = cache.get(key);
        if (!list) {
          list = await providers[chain].fetchCinemas();
          cache.set(key, list);
        }
        return list;
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

let starsCinemas = null;

async function openStars() {
  $("stars").hidden = false;
  document.body.classList.add("locked");
  $("stars").querySelector(".close").focus({ preventScroll: true });
  if (!$("stars-region").options.length) {
    $("stars-region").replaceChildren(...REGIONS.map((r) => new Option(r, r)), new Option("All Malaysia", ""));
  }
  $("stars-region").value = $("region").value;
  renderStars();
  if (!starsCinemas) {
    starsCinemas = await allCinemas();
    rememberCinemaPlaces(starsCinemas);
    renderStars();
  }
}

function closeStars() {
  $("stars").hidden = true;
  document.body.classList.toggle("locked", Boolean(state.movieKey));
  $("open-stars").focus({ preventScroll: true });
}

function starRow(key, region, extra) {
  const [chain, name] = splitKey(key);
  const km = kmTo(key);
  return el(
    "div",
    { class: `star-row${isStarred(key) ? " on" : ""}` },
    starButton(key, region),
    el("span", { class: `chain ${chain}` }, chain),
    el("span", { class: "star-name" }, name),
    el("span", { class: "mono star-meta" }, [extra, kmLabel(km)].filter(Boolean).join(" · ")),
  );
}

function renderStars() {
  if ($("stars").hidden) return;
  const mine = [...state.starred].sort(([a], [b]) => a.localeCompare(b));
  $("stars-clear").hidden = !mine.length;
  $("stars-mine").replaceChildren(
    mine.length
      ? el("div", { class: "star-list" }, mine.map(([key, info]) => starRow(key, info.region, info.region)))
      : el("p", { class: "empty" }, "No starred cinemas yet. Tap ☆ next to a cinema below, or in any movie's schedule."),
  );

  if (!starsCinemas) {
    $("stars-all").replaceChildren(el("p", { class: "empty" }, "Loading cinemas…"));
    return;
  }
  const region = $("stars-region").value.toLowerCase();
  const chain = $("stars-chain").value;
  const list = starsCinemas
    .filter((c) => (!region || c.region.toLowerCase().includes(region)) && (!chain || c.chain === chain))
    .map((c) => ({ key: `${c.chain}|${c.name}`, region: c.region }))
    .sort((a, b) => {
      const da = kmTo(a.key);
      const db = kmTo(b.key);
      if (da != null && db != null && da !== db) return da - db;
      return a.key.localeCompare(b.key);
    });
  $("stars-all").replaceChildren(
    list.length
      ? el("div", { class: "star-list" }, list.map((c) => starRow(c.key, c.region, region ? "" : c.region)))
      : el("p", { class: "empty" }, "No cinemas here."),
  );
}

// ---------------------------------------------------------------- posters

function posterImage(candidates, sizes, alt) {
  if (!candidates.length) return null;
  const img = el("img", { alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", sizes });
  setPoster(img, candidates);
  return img;
}

/** Every chain's poster in srcset; the browser picks the sharpest it needs. */
function setPoster(img, candidates) {
  const sig = candidates.map((c) => c.url).join(" ");
  if (img.dataset.sig === sig) return;
  img.dataset.sig = sig;
  const remaining = [...candidates];
  img.onerror = () => {
    // A broken poster: drop srcset and walk down the list, then show the title instead.
    img.removeAttribute("srcset");
    remaining.shift();
    if (remaining.length) img.src = remaining[0].url;
    else img.closest(".poster")?.classList.add("no-img");
  };
  img.srcset = candidates.map((c) => `${c.url} ${c.width}w`).join(", ");
  img.src = candidates[0].url;
  img.closest(".poster")?.classList.remove("no-img");
}

function posterFrame(summary, sizes) {
  const frame = el("div", { class: "poster" }, el("span", { class: "poster-fallback", "aria-hidden": "true" }, summary.title));
  const img = posterImage(summary.posters, sizes, `${summary.title} poster`);
  if (img) frame.prepend(img);
  else frame.classList.add("no-img");
  return frame;
}


// ---------------------------------------------------------------- controls

const DAYS = 7;
const emptyKey = (date) => `${date}|${$("region").value}`;

/** Build or refresh a 7-day strip (today + 6). Days with no schedule yet are marked. */
function renderDateStrip(strip, name) {
  if (!strip.childElementCount) {
    for (let i = 0; i < DAYS; i++) {
      const iso = addDays(todayMyt(), i);
      const p = dateParts(iso);
      strip.append(
        el(
          "label",
          { class: "day", title: p.long },
          el("input", { type: "radio", name, value: iso }),
          el("span", {}, el("small", {}, i === 0 ? "Today" : p.weekday), el("b", {}, String(p.day)), el("small", { class: "day-month" }, p.month)),
        ),
      );
    }
  }
  for (const label of strip.children) {
    const input = label.querySelector("input");
    input.checked = input.value === selectedDate();
    const empty = state.emptyDates.has(emptyKey(input.value));
    label.classList.toggle("nodata", empty);
    label.title = `${dateParts(input.value).long}${empty ? " · schedule not published yet" : ""}`;
  }
}

function setDate(iso) {
  if (iso === state.date) return;
  state.date = iso;
  load();
}

function fillAfterOptions() {
  const select = $("m-after");
  const keep = select.value;
  const options = [["", "Any time"]];
  if (selectedDate() === todayMyt()) options.push(["now", "From now"]);
  for (const t of ["12:00", "15:00", "18:00", "21:00"]) options.push([t, `From ${t}`]);
  select.replaceChildren(...options.map(([v, label]) => new Option(label, v)));
  select.value = options.some(([v]) => v === keep) ? keep : "";
}

/**
 * Cinema <select>: "All", "Starred only", then starred cinemas, then the rest by chain
 * (nearest first when the location is known). Keeps the current choice if it's still listed.
 */
function fillCinemaSelect(select, keys, allLabel) {
  const keep = select.value;
  const label = (key) => {
    const km = kmLabel(kmTo(key));
    return km ? `${splitKey(key)[1]} · ${km}` : splitKey(key)[1];
  };
  const order = (a, b) => {
    const da = kmTo(a);
    const db = kmTo(b);
    if (da != null && db != null && da !== db) return da - db;
    return splitKey(a)[1].localeCompare(splitKey(b)[1]);
  };
  const starred = keys.filter(isStarred).sort(order);
  const rest = keys.filter((k) => !isStarred(k));
  const chains = [...new Set(rest.map((k) => splitKey(k)[0]))].sort();
  const options = [
    new Option(allLabel, ""),
    starred.length ? new Option("★ Starred", STARRED) : null,
    starred.length ? el("optgroup", { label: "★ Starred" }, starred.map((k) => new Option(`★ ${label(k)}`, k))) : null,
    ...chains.map((chain) =>
      el(
        "optgroup",
        { label: state.here ? `${chain} · nearest first` : chain },
        rest
          .filter((k) => splitKey(k)[0] === chain)
          .sort(order)
          .map((k) => new Option(label(k), k)),
      ),
    ),
  ].filter(Boolean);
  const sig = `${allLabel}::${options.map((o) => o.label || o.text).join("|")}::${starred.join(",")}::${rest.length}`;
  if (select.dataset.sig !== sig) {
    select.dataset.sig = sig;
    select.replaceChildren(...options);
  }
  const valid = keep === "" || (keep === STARRED && starred.length) || keys.includes(keep);
  select.value = valid ? keep : "";
}

function matchesCinema(choice) {
  if (!choice) return () => true;
  if (choice === STARRED) return (s) => isStarred(venueKey(s));
  return (s) => venueKey(s) === choice;
}

function tickClock() {
  $("clock").textContent = `MYT ${nowMyt().slice(11)}`;
}

function renderTools() {
  const button = $("locate");
  button.setAttribute("aria-pressed", String(Boolean(state.here)));
  button.classList.toggle("on", Boolean(state.here));
  button.disabled = state.locating;
  $("locate-text").textContent = state.locating ? "Locating…" : state.here ? "Location on" : "Location";
  button.title = state.locationError || (state.here ? "Distances shown. Click to turn off." : "Show distance from where you are");
  button.classList.toggle("err", Boolean(state.locationError));
  $("star-count").textContent = state.starred.size ? String(state.starred.size) : "";
  const near = $("m-sort").querySelector("option[value=near]");
  near.disabled = !state.here;
  near.textContent = state.here ? "Nearest" : "Nearest (turn on location)";
}

// ---------------------------------------------------------------- loading

async function load() {
  state.controller?.abort();
  const controller = new AbortController();
  const current = () => state.controller === controller;
  Object.assign(state, { controller, shows: [], cinemas: [], errors: [], progress: { done: 0, total: 0 }, loading: true });
  savePrefs();
  fillAfterOptions();

  const chains = selectedChains();
  if (!chains.length) {
    state.loading = false;
    state.errors.push("Pick at least one chain.");
    render();
    return;
  }
  render();

  // The shared snapshot (one file, refreshed every 6 h) covers most visits with no calls to the
  // chains at all; fetch live only for a day it doesn't have, or when it's missing or stale.
  const snap = await snapshotOnce();
  if (!current()) return;
  if (snap?.days.includes(selectedDate())) {
    const region = $("region").value.toLowerCase();
    const wanted = (chain, r) => chains.includes(chain) && (!region || String(r).toLowerCase().includes(region));
    state.cinemas = snap.cinemas.filter((c) => wanted(c.chain, c.region));
    state.shows = snap.showtimes.filter((s) => s.business_date === selectedDate() && wanted(s.chain, s.region));
    state.errors = (snap.errors[selectedDate()] || []).filter(
      (e) => /could not load cinemas/.test(e) ? chains.some((c) => e.startsWith(c)) : state.cinemas.some((c) => e.startsWith(`${c.chain} ${c.name}:`)),
    );
    rememberCinemaPlaces(state.cinemas);
    rememberPlaces(state.shows);
    state.progress = { done: state.cinemas.length, total: state.cinemas.length };
    state.source = snap.generatedAt;
    finishLoad();
    return;
  }
  state.source = null;

  try {
    await collectShowtimes(selectedDate(), {
      providers,
      chains,
      region: $("region").value,
      cache,
      signal: controller.signal,
      onCinemas: (cinemas) => {
        if (!current()) return;
        state.cinemas = cinemas;
        rememberCinemaPlaces(cinemas);
      },
      onShowtimes: (shows) => {
        if (!current()) return;
        state.shows.push(...shows);
        rememberPlaces(shows);
        scheduleRender();
      },
      onProgress: (progress) => {
        if (!current()) return;
        state.progress = progress;
        scheduleRender();
      },
      onError: (message) => {
        if (!current()) return;
        state.errors.push(message);
        scheduleRender();
      },
    });
  } catch (err) {
    if (!current() || controller.signal.aborted) return;
    state.errors.push(`Could not load showtimes: ${err.message || err}`);
  }
  if (!current()) return;
  finishLoad();
}

function finishLoad() {
  state.loading = false;
  // Every cinema answered (or most did) and none has a show: that day isn't published yet.
  const answered = state.progress.done - state.errors.filter((e) => !e.includes("could not load cinemas")).length;
  if (!state.shows.length && answered > 0) state.emptyDates.add(emptyKey(selectedDate()));
  else if (state.shows.length) state.emptyDates.delete(emptyKey(selectedDate()));
  render();
}

let snapshotPromise = null;
const snapshotOnce = () => (snapshotPromise ??= loadSnapshot());

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------------------------------------------------------------- grid

function progressLabel() {
  if (state.source && !state.loading) {
    const d = new Date(Date.parse(state.source) + 8 * 3600 * 1000);
    const when = `${d.getUTCDate()} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    return `${state.cinemas.length} cinemas · updated ${when} MYT`;
  }
  const { done, total } = state.progress;
  if (!total) return state.loading ? "Finding cinemas…" : "";
  return state.loading ? `Loaded ${done}/${total} cinemas` : `Loaded ${done}/${total} cinemas · done`;
}

function renderStatus() {
  const { done, total } = state.progress;
  const box = $("progress");
  box.hidden = !state.loading && total === 0;
  box.classList.toggle("done", !state.loading);
  $("bar").style.width = total ? `${(done / total) * 100}%` : state.loading ? "4%" : "0";
  $("progress-text").textContent = progressLabel();

  const errors = state.locationError ? [...state.errors, state.locationError] : state.errors;
  if (!errors.length) {
    $("warnings").replaceChildren();
    return;
  }
  const list = el("ul", {}, errors.map((e) => el("li", {}, e)));
  $("warnings").replaceChildren(
    errors.length <= 2
      ? el("div", { class: "warn" }, el("strong", {}, state.errors.length ? "Some data is missing. " : ""), list)
      : el("details", { class: "warn" }, el("summary", {}, `${plural(errors.length, "source")} did not respond. The rest are shown.`), list),
  );
}

const cards = new Map(); // movie key -> card element, reused so posters don't reload
const GRID_SIZES = "(max-width: 560px) 46vw, (max-width: 1100px) 24vw, 220px";

function movieCard(summary, index) {
  let card = cards.get(summary.key);
  if (!card) {
    card = el(
      "a",
      { class: "card", href: `#/movie/${encodeURIComponent(summary.key)}` },
      posterFrame(summary, GRID_SIZES),
      el("span", { class: "card-no mono", "aria-hidden": "true" }),
      el("span", { class: "card-count mono" }),
      el("div", { class: "card-body" }, el("h3"), el("div", { class: "card-meta mono" })),
    );
    cards.set(summary.key, card);
  }
  const img = card.querySelector("img");
  if (img) setPoster(img, summary.posters);
  else if (summary.posters.length) {
    const frame = card.querySelector(".poster");
    frame.classList.remove("no-img");
    frame.prepend(posterImage(summary.posters, GRID_SIZES, `${summary.title} poster`));
  }
  card.querySelector(".card-no").textContent = pad2(index + 1);
  card.querySelector(".card-count").textContent = plural(summary.showCount, "show");
  card.querySelector("h3").textContent = summary.title;
  card.querySelector(".card-meta").textContent = [runtime(summary.duration_mins), summary.rating, summary.language]
    .filter(Boolean)
    .join(" · ");
  return card;
}

function renderGrid() {
  const keys = state.cinemas.length
    ? state.cinemas.map((c) => `${c.chain}|${c.name}`)
    : [...new Set(state.shows.map(venueKey))];
  fillCinemaSelect($("cinema"), keys, "All cinemas");

  const visible = state.shows.filter(matchesCinema($("cinema").value));
  const movies = summarizeMovies(visible);
  for (const m of summarizeMovies(state.shows)) state.lastSummary.set(m.key, m);

  const sort = $("sort").value;
  movies.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "time"
        ? cmp(a.firstStart, b.firstStart) || a.title.localeCompare(b.title)
        : b.showCount - a.showCount || a.title.localeCompare(b.title),
  );

  $("count").textContent = state.shows.length
    ? `${plural(movies.length, "movie")} · ${plural(new Set(visible.map(venueKey)).size, "cinema")}`
    : "";
  $("intro-date").textContent = `${dateParts(selectedDate()).long} · ${regionLabel()}`;
  renderDateStrip($("dates"), "date");

  if (!movies.length) {
    const text = state.loading
      ? "Loading what's on…"
      : state.shows.length
        ? $("cinema").value === STARRED
          ? "Nothing at your starred cinemas on this day."
          : "Nothing at this cinema on this day."
        : notPublishedText();
    $("grid").replaceChildren(el("p", { class: "empty" }, text));
    return;
  }
  $("grid").replaceChildren(...movies.map(movieCard));
}

/** Text for a day with nothing loaded: unpublished schedule, or a real failure. */
function notPublishedText() {
  const p = dateParts(selectedDate());
  if (state.emptyDates.has(emptyKey(selectedDate()))) {
    return `${p.weekday} ${p.day} ${p.month}: no schedule yet. Malaysian cinemas publish the next week's showtimes on Wednesdays, so later days fill in then.`;
  }
  return state.errors.length ? "Couldn't load showtimes. See the warning above." : "No showtimes found for this day and region.";
}

// ---------------------------------------------------------------- movie sheet

function timeChip(show, now) {
  const overnight = show.start.slice(0, 10) > show.business_date;
  const past = show.start < now;
  const label = `${hhmm(show.start)} ${show.experience} · ${show.cinema_name} · ${show.hall}${overnight ? " · after midnight" : ""}${
    show.sold_out ? " · sold out" : ""
  }${past ? " · started" : ""}`;
  const chip = el(
    show.booking_url ? "a" : "span",
    { class: `time${show.sold_out ? " full" : ""}${past ? " past" : ""}`, title: label, "aria-label": label },
    el("b", {}, hhmm(show.start)),
    overnight ? el("sup", {}, "+1") : null,
    show.experience ? el("i", {}, show.experience) : null,
  );
  if (show.booking_url) Object.assign(chip, { href: show.booking_url, target: "_blank", rel: "noopener" });
  return chip;
}

function venueBlock(key, shows, now, forceOpen) {
  const [chain, name] = splitKey(key);
  const ahead = shows.filter((s) => s.start >= now);
  const previewFrom = ahead.length ? ahead : shows;
  const preview = previewFrom.slice(0, 4).map((s) => hhmm(s.start)).join("  ");
  const upcoming = shows.find((s) => s.start >= now && !s.sold_out);
  const km = kmLabel(kmTo(key));
  return el(
    "details",
    {
      class: `venue${isStarred(key) ? " starred" : ""}`,
      open: forceOpen || state.openVenues.has(key),
      ontoggle: (e) => {
        if (e.currentTarget.open) state.openVenues.add(key);
        else state.openVenues.delete(key);
      },
    },
    el(
      "summary",
      {},
      starButton(key, shows[0].region),
      el(
        "span",
        { class: "venue-id" },
        el("span", { class: `chain ${chain}` }, chain),
        el("span", { class: "venue-name" }, name),
        km ? el("span", { class: "venue-km mono" }, km) : null,
      ),
      el(
        "span",
        { class: "venue-sum mono" },
        el("span", { class: "venue-preview" }, preview + (previewFrom.length > 4 ? "  …" : "")),
        el("span", {}, upcoming ? `${plural(shows.length, "show")} · next ${hhmm(upcoming.start)}` : plural(shows.length, "show")),
      ),
      el("span", { class: "chev", "aria-hidden": "true" }),
    ),
    el("div", { class: "times" }, shows.map((s) => timeChip(s, now))),
  );
}

function timeRow(show, now) {
  const overnight = show.start.slice(0, 10) > show.business_date;
  const past = show.start < now;
  const key = venueKey(show);
  const km = kmLabel(kmTo(key));
  const row = el(
    show.booking_url ? "a" : "div",
    { class: `trow${show.sold_out ? " full" : ""}${past ? " past" : ""}` },
    el("span", { class: "trow-time" }, hhmm(show.start), overnight ? el("sup", {}, "+1") : null),
    el(
      "span",
      { class: "trow-where" },
      isStarred(key) ? el("span", { class: "card-star", title: "Starred cinema" }, "★") : null,
      el("span", { class: `chain ${show.chain}` }, show.chain),
      el("span", {}, show.cinema_name),
    ),
    el("span", { class: "trow-what mono" }, [show.experience, show.hall, km].filter(Boolean).join(" · ")),
    el("span", { class: "trow-go mono" }, show.sold_out ? "Sold out" : past ? "Started" : show.booking_url ? "Book ↗" : ""),
  );
  if (show.booking_url) Object.assign(row, { href: show.booking_url, target: "_blank", rel: "noopener" });
  return row;
}

let sheetKey = null;
// Large enough that the browser takes the highest-resolution poster for the movie view.
const HERO_SIZES = "500px";

function renderSheet() {
  const key = state.movieKey;
  const all = state.shows.filter((s) => s.movie_key === key);
  const summary = summarizeMovies(all)[0] || state.lastSummary.get(key);

  if (sheetKey !== key) {
    sheetKey = key;
    state.openVenues.clear();
    $("m-sort").value = state.here ? "near" : "time";
    $("m-poster").replaceChildren(summary ? posterFrame(summary, HERO_SIZES) : el("div", { class: "poster no-img" }));
    $("m-cinema").dataset.sig = "";
    $("m-cinema").replaceChildren(new Option("", $("cinema").value));
    $("m-cinema").value = $("cinema").value;
  } else if (summary) {
    const img = $("m-poster").querySelector("img");
    if (img) setPoster(img, summary.posters);
    else if (summary.posters.length) $("m-poster").replaceChildren(posterFrame(summary, HERO_SIZES));
  }

  $("m-title").textContent = summary?.title || (state.loading ? "Loading…" : "Movie not found");
  document.title = summary ? `${summary.title} · 52 Frames` : "52 Frames · Showtimes";
  const facts = summary
    ? [
        ["Runtime", runtime(summary.duration_mins)],
        ["Rating", summary.rating],
        ["Language", summary.language],
        ["Region", regionLabel()],
      ].filter(([, v]) => v)
    : [];
  $("m-facts").replaceChildren(...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  renderDateStrip($("m-dates"), "m-date");

  const keys = [...new Set(all.map(venueKey))];
  fillCinemaSelect($("m-cinema"), keys, `All cinemas (${keys.length})`);

  const now = nowMyt();
  let after = $("m-after").value;
  if (after === "now") after = now.slice(11);
  const shows = filterShowtimes(all, { after: after || undefined }).filter(matchesCinema($("m-cinema").value));

  const group = selectedGroup();
  $("m-sort-field").hidden = group !== "cinema";
  $("m-count").textContent = all.length
    ? `${plural(shows.length, "show")} · ${plural(new Set(shows.map(venueKey)).size, "cinema")}`
    : "";
  $("m-status").textContent = state.loading ? progressLabel() : "";
  $("m-status").classList.toggle("on", state.loading);

  if (!shows.length) {
    const p = dateParts(selectedDate());
    const text = state.loading
      ? "Loading showtimes…"
      : all.length
        ? $("m-cinema").value === STARRED
          ? "Not showing at your starred cinemas on this day."
          : "No shows match these filters."
        : state.emptyDates.has(emptyKey(selectedDate()))
          ? notPublishedText()
          : `Not showing on ${p.weekday} ${p.day} ${p.month} in ${regionLabel()}. Try another date.`;
    $("m-schedule").replaceChildren(el("p", { class: "empty" }, text));
    return;
  }

  if (group === "time") {
    $("m-schedule").replaceChildren(el("div", { class: "trows" }, shows.map((s) => timeRow(s, now))));
    return;
  }

  const byVenue = new Map();
  for (const s of shows) {
    if (!byVenue.has(venueKey(s))) byVenue.set(venueKey(s), []);
    byVenue.get(venueKey(s)).push(s);
  }
  const sort = $("m-sort").value;
  const nextStart = (list) => (list.find((s) => s.start >= now) || list[0]).start;
  const far = (k) => kmTo(k) ?? Infinity;
  const entries = [...byVenue].sort(
    ([ka, a], [kb, b]) =>
      // Starred cinemas always come first.
      Number(isStarred(kb)) - Number(isStarred(ka)) ||
      (sort === "name"
        ? splitKey(ka)[1].localeCompare(splitKey(kb)[1])
        : sort === "shows"
          ? b.length - a.length
          : sort === "near"
            ? far(ka) - far(kb)
            : cmp(nextStart(a), nextStart(b))) ||
      ka.localeCompare(kb),
  );
  const forceOpen = entries.length === 1;
  $("m-schedule").replaceChildren(...entries.map(([k, list]) => venueBlock(k, list, now, forceOpen)));
}

// ---------------------------------------------------------------- routing

let returnFocus = null;
let cameFromGrid = false;

function route() {
  const match = /^#\/movie\/(.+)$/.exec(location.hash);
  const key = match ? decodeURIComponent(match[1]) : null;
  const opening = key && !state.movieKey;
  state.movieKey = key;
  $("sheet").hidden = !key;
  document.body.classList.toggle("locked", Boolean(key) || !$("stars").hidden);
  if (opening) {
    returnFocus = document.activeElement;
    $("sheet").querySelector(".sheet-panel").scrollTop = 0;
    requestAnimationFrame(() => $("sheet").querySelector(".close").focus({ preventScroll: true }));
  }
  if (!key) {
    sheetKey = null;
    document.title = "52 Frames · Showtimes";
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
  render();
}

function closeSheet() {
  if (cameFromGrid) history.back();
  else location.hash = "#/";
  cameFromGrid = false;
}

function render() {
  renderTools();
  renderStatus();
  renderGrid();
  if (state.movieKey) renderSheet();
  renderStars();
}

// ---------------------------------------------------------------- wiring

async function init() {
  const saved = readLocal("showtimes:prefs", {});
  if (typeof saved.region === "string" && [...$("region").options].some((o) => o.value === saved.region)) {
    $("region").value = saved.region;
  }
  if (Array.isArray(saved.chains) && saved.chains.length) {
    for (const box of document.querySelectorAll("input[name=chain]")) box.checked = saved.chains.includes(box.value);
  }
  if (saved.group === "time") document.querySelector("input[name=group][value=time]").checked = true;
  fillAfterOptions();
  tickClock();
  setInterval(tickClock, 15000);

  $("toolbar").addEventListener("submit", (e) => e.preventDefault());
  $("region").addEventListener("change", load);
  for (const strip of [$("dates"), $("m-dates")]) strip.addEventListener("change", (e) => setDate(e.target.value));
  for (const box of document.querySelectorAll("input[name=chain]")) box.addEventListener("change", load);
  for (const id of ["cinema", "sort"]) $(id).addEventListener("change", render);

  $("grid").addEventListener("click", (e) => {
    if (e.target.closest("a.card") && !e.metaKey && !e.ctrlKey && !e.shiftKey) cameFromGrid = true;
  });
  for (const id of ["m-cinema", "m-after", "m-sort"]) $(id).addEventListener("change", render);
  for (const radio of document.querySelectorAll("input[name=group]")) {
    radio.addEventListener("change", () => {
      savePrefs();
      render();
    });
  }
  $("sheet").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSheet();
  });

  $("locate").addEventListener("click", toggleLocation);
  $("open-stars").addEventListener("click", openStars);
  $("stars").addEventListener("click", (e) => {
    if (e.target.closest("[data-close-stars]")) closeStars();
  });
  for (const id of ["stars-region", "stars-chain"]) $(id).addEventListener("change", renderStars);
  $("stars-clear").addEventListener("click", () => {
    if (!confirm(`Unstar all ${plural(state.starred.size, "cinema")}?`)) return;
    state.starred.clear();
    saveStars();
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("stars").hidden) closeStars();
    else if (state.movieKey) closeSheet();
  });
  window.addEventListener("hashchange", route);
  // The poster column pins just below the movie header, whatever height the header has.
  new ResizeObserver(([entry]) => {
    $("sheet").style.setProperty("--head-h", `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
  }).observe(document.querySelector(".m-head"));
  // Another tab changed the stars: pick them up.
  window.addEventListener("storage", (e) => {
    if (e.key !== "showtimes:starred") return;
    state.starred = new Map(Object.entries(readLocal("showtimes:starred", {})));
    render();
  });

  load();
  route();

  // Turn location back on without a prompt if the visitor already allowed it.
  if (saved.location) {
    try {
      const status = await navigator.permissions?.query({ name: "geolocation" });
      if (status?.state === "granted") locate();
    } catch {
      // Permissions API unavailable: wait for the button.
    }
  }
}

init();
