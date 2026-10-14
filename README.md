# Cinema Showtimes: GSC + TGV

Check **GSC** (Golden Screen Cinemas) and **TGV Cinemas** showtimes across Malaysia in one place,
on the web, from the command line or in a small local web page.

**Website: <https://edwardywy.github.io/52Frames/>** (no server: your browser calls GSC and TGV
directly).

- Pure Python 3.10+ standard library, so there is nothing to `pip install`.
- Same movie from both chains is grouped together (e.g. GSC "(IMAX) Jailer 2" and TGV
  "Jailer 2 (Tamil)").
- Both chains are mapped onto the same regions: Klang Valley, Northern, Southern, East Coast,
  East Malaysia.
- If one chain or cinema fails to respond, the rest still load, and you get a warning.

## Command line

Run from the repository root (or `pip install .` to get a `cinema-showtimes` command):

```bash
# Today, every cinema in Klang Valley, both chains
python3 -m cinema_showtimes --region "klang valley"

# Tomorrow, one movie, evening shows only
python3 -m cinema_showtimes --date tomorrow --region "klang valley" --movie jailer --after 19:00

# A specific mall, TGV only, a specific date
python3 -m cinema_showtimes --date 2026-10-18 --cinema pavilion --chain tgv

# JSON output (for scripts)
python3 -m cinema_showtimes --cinema "1 utama" --json

# List cinemas
python3 -m cinema_showtimes cinemas --region southern
```

Example output:

```
Showtimes for Thu 15 Oct 2026

Go For Broke 2  (132 min · 18 · MAN)
  GSC  Petaling Jaya - 1 Utama (New Wing)  15:00 2D, 22:15 2D
  TGV  TGV 1 Utama                         18:00 JUNIOR-HOTWHEEL
```

| Option | Meaning |
|---|---|
| `--date` | `today` (default), `tomorrow`, `+N` days, or `YYYY-MM-DD` |
| `--region` | Region substring: `klang valley`, `northern`, `southern`, `east coast`, `east malaysia` |
| `--cinema` | Cinema name substring, e.g. `mid valley`, `pavilion` |
| `--movie` | Movie title substring |
| `--chain` | `gsc` or `tgv` (repeatable; default both) |
| `--after` | Only shows starting at/after `HH:MM` (after-midnight shows are kept) |
| `--json` | Machine-readable output |

Tip: narrow by `--region` or `--cinema`. Fetching all ~100 cinemas nationwide takes noticeably
longer than one region (about 10 s for Klang Valley).

## Website (GitHub Pages)

<https://edwardywy.github.io/52Frames/> is a static page in [`site/`](site/): plain ES modules, no
build step, no dependencies. Pick a date (today + 6 days) and region, then filter by movie, cinema or
start time as you type. Each time links to that chain's booking page; sold-out times are struck
through, and shows after midnight are marked `+1` under the day they belong to.

How it works:

1. The browser loads the cinema lists of both chains and keeps the ones in the chosen region.
2. It fetches each cinema's showtimes for the day, at most 6 requests at a time, and draws results
   as they arrive ("Loaded 23/51 cinemas").
3. If a chain or cinema fails, the page says so and shows the rest.
4. Responses are cached in `sessionStorage` for 10 minutes per date and cinema, so switching
   filters or reloading doesn't hit the chains again.

This works because both APIs send CORS headers: GSC allows the `edwardywy.github.io` origin, TGV
allows any origin. No other endpoints are used.

```
site/
  index.html        the page
  css/style.css
  js/models.js      normalizeTitle, showtime shape (port of models.py)
  js/providers.js   GSC + TGV fetch and parse (port of gsc.py / tgv.py); no DOM access
  js/aggregator.js  concurrency limit, sessionStorage cache, filter, group (port of aggregator.py)
  js/app.js         page code
```

`.github/workflows/pages.yml` runs the Python and JavaScript tests on every push and pull request,
and deploys `site/` to Pages on pushes to `main`. In the repository settings, **Settings → Pages →
Source** must be **GitHub Actions**.

## Local web page

```bash
python3 -m cinema_showtimes serve            # http://127.0.0.1:8000
python3 -m cinema_showtimes serve --port 9000
```

From a repository checkout this serves the same `site/` page as GitHub Pages (both chains also
accept `localhost` as an origin). When installed with `pip`, `site/` isn't included, so it serves
the older page in `cinema_showtimes/static/`, which uses the server-side API below (cached in
memory for 10 minutes).

JSON endpoints:

- `GET /api/showtimes?date=YYYY-MM-DD&region=...&chain=GSC&chain=TGV&cinema=...&movie=...&after=HH:MM`
- `GET /api/cinemas?region=...&chain=...`
- `GET /api/regions`

## How it works

Both chains' own websites load showtimes from public JSON/XML endpoints, and this tool calls the
same ones:

| Chain | Cinemas | Showtimes |
|---|---|---|
| GSC | `epaymentapi.gsc.com.my/gsc/epay/GetEpaymentLocations` | `.../showtimews/service.asmx/getShowTimesByLocation_ParentChild_V2` (XML, one call per cinema per day) |
| TGV | `api.tgv.com.my/api/cinemas/v1/getstatecinema` | `.../api/boxoffice/v1/moviesession_get` (JSON, one call per cinema per day) |

These are **unofficial, undocumented** endpoints. They can change without notice. If a chain
suddenly returns nothing, its website has probably changed. **There are two parsers for each chain,
and both must be updated:** the Python one (`cinema_showtimes/gsc.py`, `tgv.py`) and the JavaScript
one (`site/js/providers.js`). `tests/js/parity.test.mjs` fails if the two give different results
for the fixtures. Please keep usage personal and light; the caches and the concurrency limit help.

```
cinema_showtimes/
  models.py      Cinema / Showtime dataclasses, title normalisation, regions
  gsc.py         GSC fetch + parse
  tgv.py         TGV fetch + parse
  aggregator.py  concurrent fetching, filtering, grouping by movie
  cli.py         command line
  web.py         local web server + /api endpoints
  static/        fallback web page for pip installs (uses /api/showtimes)
site/            the browser-only web page (GitHub Pages)
tests/           Python tests; tests/js/ has the Node tests for site/js/
```

## Tests

Offline tests run against trimmed real API responses in `tests/fixtures/`:

```bash
python3 -m unittest discover -s tests -t .
# or, if you have pytest:  pytest tests

# JavaScript (Node 22+, built-in test runner, no npm install needed)
node --test "tests/js/*.test.mjs"     # or: npm test
```

The JavaScript tests check the same counts, fields, after-midnight handling and title
normalisation as the Python tests, and `parity.test.mjs` runs the Python parsers on the same fixtures
and compares the output field by field. Node has no `DOMParser`, so the tests pass a small XML reader
(`tests/js/xml.mjs`) to the GSC parser.
