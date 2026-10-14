// Chain-neutral helpers shared by the GSC and TGV parsers.
// Mirrors cinema_showtimes/models.py: keep the two in sync.

// Common regions both chains are mapped onto.
export const REGIONS = ["Klang Valley", "Northern", "Southern", "East Coast", "East Malaysia"];

const TAG_RE = /[([][^)\]]*[)\]]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
// The characters Python's str.split() treats as whitespace.
const PY_WHITESPACE_RE = new RegExp(
  "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+",
);

const isLatinWord = (word) => [...word].every((ch) => ch.codePointAt(0) <= 0x24f);

/**
 * Reduce a movie title to a key that matches across chains.
 * Drops "(IMAX)" / "[BED]" tags, non-Latin words (TGV appends Chinese and Tamil titles),
 * case and punctuation, so "(IMAX) Jailer 2" (GSC) and "Jailer 2" (TGV) group together.
 */
export function normalizeTitle(title) {
  const withoutTags = String(title).replace(TAG_RE, " ").toLowerCase();
  const latinWords = withoutTags.split(PY_WHITESPACE_RE).filter((w) => w && isLatinWord(w));
  return latinWords.join(" ").replace(NON_ALNUM_RE, " ").trim();
}

/** Same field names as Showtime.to_dict() in Python. `start` is "YYYY-MM-DDTHH:MM" (MYT). */
export function makeShowtime(fields) {
  const show = {
    chain: "",
    cinema_id: "",
    cinema_name: "",
    region: "",
    movie_title: "",
    start: "",
    business_date: "",
    experience: "",
    hall: "",
    duration_mins: null,
    rating: "",
    language: "",
    sold_out: false,
    booking_url: "",
    movie_key: "",
    ...fields,
  };
  if (!show.movie_key) show.movie_key = normalizeTitle(show.movie_title);
  return show;
}

/** Python's int(value) for strings/numbers, or null when it would fail or be empty. */
export function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && /^\s*[+-]?\d+(_\d+)*\s*$/.test(value)) {
    return parseInt(value.replace(/_/g, ""), 10);
  }
  return null;
}

/** Today's date in Malaysia (UTC+8) as YYYY-MM-DD, whatever the visitor's own time zone. */
export function todayMyt(now = new Date()) {
  return addDays(new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10), 0);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
