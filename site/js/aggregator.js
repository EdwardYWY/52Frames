// Load cinemas from both chains, fetch showtimes with a concurrency limit, filter and group.
// Ports cinema_showtimes/aggregator.py, plus a sessionStorage cache for the browser.

export const CONCURRENCY = 6;
export const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = "showtimes:v1:";

const matches = (value, needle) => !needle || String(value).toLowerCase().includes(needle.toLowerCase());

const byStartChainCinema = (a, b) =>
  cmp(a.start, b.start) || cmp(a.chain, b.chain) || cmp(a.cinema_name, b.cinema_name);

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "9:5" / "09:05" -> "09:05", so it compares correctly with "HH:MM" strings. */
function hhmm(value) {
  const [h, m = "0"] = String(value).split(":");
  const hours = Number(h);
  const minutes = Number(m || 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new Error(`bad time ${value}`);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function filterShowtimes(showtimes, { chains, region, cinema, movie, after } = {}) {
  const wanted = chains?.length ? new Set(chains.map((c) => c.toUpperCase())) : null;
  const earliest = after ? hhmm(after) : null;
  return showtimes
    .filter(
      (s) =>
        (!wanted || wanted.has(s.chain)) &&
        matches(s.region, region) &&
        matches(s.cinema_name, cinema) &&
        (matches(s.movie_title, movie) || matches(s.movie_key, movie)) &&
        // Past-midnight shows belong to the previous business day, so keep them.
        (!earliest ||
          s.start.slice(0, 10) > s.business_date ||
          s.start.slice(11, 16) >= earliest),
    )
    .sort(byStartChainCinema);
}

/** Map of movie_key -> shows, keys in sorted order, shows by start time. */
export function groupByMovie(showtimes) {
  const groups = new Map();
  const sorted = [...showtimes].sort((a, b) => cmp(a.movie_key, b.movie_key) || cmp(a.start, b.start));
  for (const show of sorted) {
    if (!groups.has(show.movie_key)) groups.set(show.movie_key, []);
    groups.get(show.movie_key).push(show);
  }
  return groups;
}

// ---------------------------------------------------------------------------- cache

/** A tiny TTL cache over Web Storage. Every storage access may throw (private mode, quota). */
export function createCache(storage, { ttlMs = CACHE_TTL_MS, now = () => Date.now() } = {}) {
  const store = storage ?? null;

  function get(key) {
    try {
      const raw = store?.getItem(CACHE_PREFIX + key);
      if (!raw) return undefined;
      const { t, v } = JSON.parse(raw);
      if (now() - t < ttlMs) return v;
      store.removeItem(CACHE_PREFIX + key);
    } catch {
      // Unreadable or corrupt entry: treat as a miss.
    }
    return undefined;
  }

  function set(key, value) {
    try {
      store?.setItem(CACHE_PREFIX + key, JSON.stringify({ t: now(), v: value }));
    } catch {
      // Quota exceeded: drop expired entries and try once more, else give up quietly.
      prune();
      try {
        store?.setItem(CACHE_PREFIX + key, JSON.stringify({ t: now(), v: value }));
      } catch {
        /* not cached */
      }
    }
  }

  function prune() {
    try {
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i);
        if (!key?.startsWith(CACHE_PREFIX)) continue;
        try {
          if (now() - JSON.parse(store.getItem(key)).t >= ttlMs) store.removeItem(key);
        } catch {
          store.removeItem(key);
        }
      }
    } catch {
      /* storage unavailable */
    }
  }

  return { get, set, prune };
}

const noCache = { get: () => undefined, set: () => {}, prune: () => {} };

// ---------------------------------------------------------------------------- collect

/** Run `worker` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const errorText = (err) => (err && err.message) || String(err);

/**
 * Fetch every matching cinema's showtimes for `day` (YYYY-MM-DD).
 *
 * Calls back as data arrives:
 *   onCinemas(cinemas)                    once the cinema lists are in
 *   onShowtimes(shows, cinema)            per cinema that loaded
 *   onProgress({done, total})             after each cinema, loaded or failed
 *   onError(message)                      per chain or cinema that failed
 * Resolves to { showtimes, cinemas, errors } like the Python Result.
 */
export async function collectShowtimes(
  day,
  {
    providers,
    chains,
    region,
    cinema,
    cache = noCache,
    concurrency = CONCURRENCY,
    signal,
    onCinemas = () => {},
    onShowtimes = () => {},
    onProgress = () => {},
    onError = () => {},
  },
) {
  const result = { showtimes: [], cinemas: [], errors: [] };
  const fail = (message) => {
    result.errors.push(message);
    onError(message);
  };
  const wantedChains = chains?.length
    ? Object.keys(providers).filter((c) => chains.map((x) => x.toUpperCase()).includes(c))
    : Object.keys(providers);

  const lists = await Promise.all(
    wantedChains.map(async (chain) => {
      const key = `cinemas:${chain}`;
      try {
        let list = cache.get(key);
        if (!list) {
          list = await providers[chain].fetchCinemas(signal);
          cache.set(key, list);
        }
        return list;
      } catch (err) {
        if (signal?.aborted) throw err;
        fail(`${chain}: could not load cinemas (${errorText(err)})`);
        return [];
      }
    }),
  );
  result.cinemas = lists.flat().filter((c) => matches(c.region, region) && matches(c.name, cinema));
  onCinemas(result.cinemas);

  let done = 0;
  onProgress({ done, total: result.cinemas.length });
  await mapLimit(result.cinemas, concurrency, async (target) => {
    if (signal?.aborted) return;
    const key = `shows:${day}:${target.chain}:${target.cinema_id}:${target.hall_group || ""}`;
    try {
      let shows = cache.get(key);
      if (!shows) {
        shows = await providers[target.chain].fetchShowtimes(target, day, signal);
        cache.set(key, shows);
      }
      if (signal?.aborted) return;
      result.showtimes.push(...shows);
      onShowtimes(shows, target);
    } catch (err) {
      if (signal?.aborted) return;
      fail(`${target.chain} ${target.name}: ${errorText(err)}`);
    }
    done++;
    onProgress({ done, total: result.cinemas.length });
  });

  result.showtimes.sort(byStartChainCinema);
  return result;
}
