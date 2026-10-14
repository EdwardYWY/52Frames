# Cinema Showtimes: GSC + TGV

Check **GSC** (Golden Screen Cinemas) and **TGV Cinemas** showtimes across Malaysia in one place,
from the command line or in a small local web page.

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

## Web page

```bash
python3 -m cinema_showtimes serve            # http://127.0.0.1:8000
python3 -m cinema_showtimes serve --port 9000
```

Pick a date and region, then filter by movie, cinema or start time as you type. Each time links
to that chain's booking page. Results are cached in memory for 10 minutes.

JSON endpoints (used by the page):

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
suddenly returns nothing, its website has probably changed, so update `gsc.py` or `tgv.py`. Please
keep usage personal and light; the built-in cache helps.

```
cinema_showtimes/
  models.py      Cinema / Showtime dataclasses, title normalisation, regions
  gsc.py         GSC fetch + parse
  tgv.py         TGV fetch + parse
  aggregator.py  concurrent fetching, filtering, grouping by movie
  cli.py         command line
  web.py         local web server + /api endpoints
  static/        the web page
```

## Tests

Offline tests run against trimmed real API responses in `tests/fixtures/`:

```bash
python3 -m unittest discover -s tests -t .
# or, if you have pytest:  pytest tests
```
