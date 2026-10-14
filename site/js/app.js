// Page code: controls, loading, rendering. Fetching and parsing live in providers.js.

import { collectShowtimes, createCache, filterShowtimes } from "./aggregator.js";
import { addDays, todayMyt } from "./models.js";
import { createProviders } from "./providers.js";

const $ = (id) => document.getElementById(id);
const providers = createProviders();

let sessionStore = null;
try {
  sessionStore = window.sessionStorage;
} catch {
  // Storage blocked: run without a cache.
}
const cache = createCache(sessionStore);
cache.prune();

const state = {
  shows: [],
  errors: [],
  progress: { done: 0, total: 0 },
  loading: false,
  controller: null,
};

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pad2 = (n) => String(n).padStart(2, "0");

function prefs(read) {
  try {
    if (read) return JSON.parse(localStorage.getItem("showtimes:prefs") || "{}");
    localStorage.setItem(
      "showtimes:prefs",
      JSON.stringify({ region: $("region").value, chains: selectedChains() }),
    );
  } catch {
    // Not remembered; that's fine.
  }
  return {};
}

// ---------------------------------------------------------------- controls

function fillDates() {
  const today = todayMyt();
  const strip = $("dates");
  for (let i = 0; i < 7; i++) {
    const iso = addDays(today, i);
    const d = new Date(`${iso}T00:00:00Z`);
    const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const month = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const top = i === 0 ? "Today" : weekday;
    const input = el("input", { type: "radio", name: "date", value: iso, checked: i === 0 });
    strip.append(
      el(
        "label",
        { class: "day", title: d.toLocaleDateString("en-GB", { dateStyle: "full", timeZone: "UTC" }) },
        input,
        el("span", {}, el("small", {}, top), el("b", {}, String(d.getUTCDate())), el("small", {}, month)),
      ),
    );
  }
}

const selectedDate = () => document.querySelector("input[name=date]:checked")?.value || todayMyt();
const selectedChains = () =>
  [...document.querySelectorAll("input[name=chain]:checked")].map((c) => c.value);

function tickClock() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  $("clock").textContent = `MYT ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
}

function showDateLine() {
  const d = new Date(`${selectedDate()}T00:00:00Z`);
  $("mast-date").textContent = d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------- loading

async function load() {
  state.controller?.abort();
  const controller = new AbortController();
  const current = () => state.controller === controller;
  Object.assign(state, {
    controller,
    shows: [],
    errors: [],
    progress: { done: 0, total: 0 },
    loading: true,
  });
  showDateLine();
  prefs(false);

  const chains = selectedChains();
  if (!chains.length) {
    state.loading = false;
    state.errors.push("Pick at least one chain.");
    render();
    return;
  }
  render();

  try {
    await collectShowtimes(selectedDate(), {
      providers,
      chains,
      region: $("region").value,
      cache,
      signal: controller.signal,
      onShowtimes: (shows) => {
        if (!current()) return;
        state.shows.push(...shows);
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
  state.loading = false;
  render();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------------------------------------------------------------- rendering

function renderProgress() {
  const { done, total } = state.progress;
  const box = $("progress");
  box.hidden = !state.loading && total === 0;
  box.classList.toggle("done", !state.loading);
  $("bar").style.width = total ? `${(done / total) * 100}%` : state.loading ? "4%" : "0";
  $("progress-text").textContent = !total
    ? state.loading
      ? "Finding cinemas…"
      : ""
    : state.loading
      ? `Loaded ${done}/${total} cinemas`
      : `Loaded ${done}/${total} cinemas · done`;
}

function renderWarnings() {
  const errors = state.errors;
  if (!errors.length) return $("warnings").replaceChildren();
  const list = el("ul", {}, ...errors.map((e) => el("li", {}, e)));
  const box =
    errors.length <= 2
      ? el("div", { class: "warn" }, el("strong", {}, "Some data is missing. "), list)
      : el(
          "details",
          { class: "warn" },
          el("summary", {}, `${plural(errors.length, "source")} did not respond. The rest are shown.`),
          list,
        );
  $("warnings").replaceChildren(box);
}

function timeChip(show) {
  const overnight = show.start.slice(0, 10) > show.business_date;
  const label = `${show.start.slice(11, 16)} ${show.experience} · ${show.hall}${
    overnight ? " · after midnight" : ""
  }${show.sold_out ? " · sold out" : ""}`;
  const chip = el(
    show.booking_url ? "a" : "span",
    { class: `time${show.sold_out ? " full" : ""}`, title: label, "aria-label": label },
    el("b", {}, show.start.slice(11, 16)),
    overnight ? el("sup", {}, "+1") : null,
    show.experience ? el("i", {}, show.experience) : null,
  );
  if (show.booking_url) {
    chip.href = show.booking_url;
    chip.target = "_blank";
    chip.rel = "noopener";
  }
  return chip;
}

function filmCard(list, index) {
  const title = list.map((s) => s.movie_title).sort((a, b) => a.length - b.length)[0];
  const first = list.find((s) => s.duration_mins) || list[0];
  const chains = [...new Set(list.map((s) => s.chain))].sort();
  const meta = [
    first.duration_mins && `${first.duration_mins} min`,
    first.rating && `Rated ${first.rating}`,
    first.language,
  ].filter(Boolean);

  const byVenue = new Map();
  for (const s of list) {
    const key = `${s.chain}|${s.cinema_name}`;
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key).push(s);
  }
  const venues = [...byVenue.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, shows]) => {
      const [chain, name] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
      shows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      return el(
        "div",
        { class: "venue" },
        el("div", { class: "venue-name" }, el("span", { class: `chain ${chain}` }, chain), el("span", {}, name)),
        el("div", { class: "times" }, ...shows.map(timeChip)),
      );
    });

  return el(
    "article",
    { class: "film" },
    el(
      "header",
      { class: "film-head" },
      el("div", { class: "film-no", "aria-hidden": "true" }, pad2(index + 1)),
      el(
        "div",
        {},
        el("h3", {}, title),
        el(
          "div",
          { class: "film-meta mono" },
          el("span", {}, el("span", { class: "film-chains" }, ...chains.map((c) => el("span", { class: `chain ${c}` }, c)))),
          ...meta.map((m) => el("span", {}, m)),
        ),
      ),
      el(
        "div",
        { class: "film-count mono" },
        el("b", {}, String(list.length)),
        list.length === 1 ? "show" : "shows",
      ),
    ),
    ...venues,
  );
}

function render() {
  renderProgress();
  renderWarnings();

  const visible = filterShowtimes(state.shows, {
    movie: $("movie").value.trim(),
    cinema: $("cinema").value.trim(),
    after: $("after").value || undefined,
  });

  const byMovie = new Map();
  for (const s of visible) {
    if (!byMovie.has(s.movie_key)) byMovie.set(s.movie_key, []);
    byMovie.get(s.movie_key).push(s);
  }
  const movies = [...byMovie.values()].sort(
    (a, b) => b.length - a.length || a[0].movie_key.localeCompare(b[0].movie_key),
  );

  const cinemaCount = new Set(visible.map((s) => `${s.chain}|${s.cinema_name}`)).size;
  $("summary").textContent = state.shows.length
    ? [plural(movies.length, "movie"), plural(visible.length, "show"), plural(cinemaCount, "cinema")].join(" · ")
    : "";

  if (!movies.length) {
    const text = state.loading
      ? "Loading showtimes…"
      : state.shows.length
        ? "No showtimes match these filters."
        : "No showtimes found for this day and region.";
    $("films").replaceChildren(el("p", { class: "empty" }, text));
    return;
  }
  $("films").replaceChildren(...movies.map(filmCard));
}

// ---------------------------------------------------------------- wiring

function init() {
  fillDates();
  const saved = prefs(true);
  if (typeof saved.region === "string" && [...$("region").options].some((o) => o.value === saved.region)) {
    $("region").value = saved.region;
  }
  if (Array.isArray(saved.chains) && saved.chains.length) {
    for (const box of document.querySelectorAll("input[name=chain]")) box.checked = saved.chains.includes(box.value);
  }
  tickClock();
  setInterval(tickClock, 15000);

  $("controls").addEventListener("submit", (e) => {
    e.preventDefault();
    load();
  });
  $("dates").addEventListener("change", load);
  $("region").addEventListener("change", load);
  for (const box of document.querySelectorAll("input[name=chain]")) box.addEventListener("change", load);
  for (const id of ["movie", "cinema", "after"]) $(id).addEventListener("input", render);
  load();
}

init();
