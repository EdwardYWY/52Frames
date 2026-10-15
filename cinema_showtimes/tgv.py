"""TGV Cinemas provider.

Uses the same public JSON API as https://www.tgv.com.my (api.tgv.com.my).
"""

from __future__ import annotations

import re
from datetime import date, datetime

from . import http
from .models import Cinema, Showtime, float_or_none, normalize_subtitles

CHAIN = "TGV"
API_BASE = "https://api.tgv.com.my/api"
STATES_URL = f"{API_BASE}/cinemas/v1/getstatecinema"
SESSIONS_URL = f"{API_BASE}/boxoffice/v1/moviesession_get"
MOVIE_URL = "https://www.tgv.com.my/movies/details"
INFO_URL = "https://www.tgv.com.my/movie"


# TGV cinema names in GSC's "Town - Mall" style, by cinema id. Same table as TGV_NAMES in
# site/js/places.js (tests/js/parity.test.mjs checks they match).
NAMES = {
    "1SM": "Kuala Lumpur - 1 Shamelin",
    "BU0": "Petaling Jaya - 1 Utama",
    "1AV": "Penang - 1st Avenue",
    "ALM": "Putrajaya - Alamanda",
    "AMP": "Ampang - Ampang Point",
    "AU2": "Kuala Lumpur - AEON AU2 Setiawangsa",
    "BIN": "Bintulu - Boulevard",
    "BI0": "Johor Bahru - AEON Bukit Indah",
    "BKM": "Bukit Mertajam - AEON Bukit Mertajam",
    "BR0": "Klang - AEON Bukit Raja",
    "BBT": "Klang - AEON Bukit Tinggi",
    "ICT": "Shah Alam - Central i-City",
    "CHR": "Cheras - AEON Cheras Selatan",
    "CTR": "Kuala Lumpur - Cheras Sentral",
    "CYB": "Cyberjaya - DPulze",
    "GUR": "Penang - Gurney Paragon",
    "JAY": "Petaling Jaya - Jaya Shopping Centre",
    "KP0": "Kepong - AEON Metro Prima",
    "IP0": "Ipoh - AEON Kinta City",
    "KUL": "Kulai - AEON Kulaijaya",
    "MSR": "Kemaman - Mesra Mall",
    "MN0": "Seri Kembangan - The Mines",
    "IMP": "Miri - Imperial Mall",
    "PBJ": "Kuala Lumpur - Pavilion Bukit Jalil",
    "PDH": "Kuala Lumpur - Pavilion Damansara Heights",
    "PKL": "Kuala Lumpur - Pavilion Kuala Lumpur",
    "RWK": "Rawang - AEON Rawang Anggun",
    "KLE": "Ipoh - Sentra Mall Klebang",
    "S20": "Seremban - AEON Seremban 2",
    "MAN": "Seri Manjung - AEON Seri Manjung",
    "STW": "Puchong - SetiaWalk",
    "S18": "Ipoh - AEON Station 18",
    "STR": "Petaling Jaya - The Strand Kota Damansara",
    "SWP": "Kuala Lumpur - Sunway Putra",
    "SW0": "Subang Jaya - Sunway Pyramid",
    "SWS": "Subang Jaya - Sunway Square",
    "SWV": "Kuala Lumpur - Sunway Velocity",
    "WWM": "Kuala Lumpur - Sunway Wangsa Walk",
    "KLC": "Kuala Lumpur - Suria KLCC",
    "TAI": "Taiping - AEON Taiping",
    "TSC": "Johor Bahru - Tasek Central",
    "TBR": "Johor Bahru - AEON Tebrau City",
    "KSL": "Klang - KSL Esplanade",
    "TOP": "Johor Bahru - Toppen",
    "VIV": "Kuching - Vivacity Megamall",
}


def cinema_name(cinema_id: str, raw_name: str, state_label: str = "") -> str:
    """The table name, else TGV's own name without the "TGV" prefix and "(New)", led by the state."""
    if cinema_id in NAMES:
        return NAMES[cinema_id]
    name = re.sub(r"^tgv\s+", "", raw_name or cinema_id, flags=re.I)
    name = re.sub(r"\s*\(new\)\s*$", "", name, flags=re.I).strip() or cinema_id
    return f"{state_label} - {name}" if state_label and " - " not in name else name


# TGV groups cinemas by state; map them onto the shared regions GSC uses.
STATE_TO_REGION = {
    "klangvalley": "Klang Valley",
    "selangor": "Klang Valley",
    "kualalumpur": "Klang Valley",
    "pinang": "Northern",
    "perak": "Northern",
    "kedah": "Northern",
    "perlis": "Northern",
    "johor": "Southern",
    "melaka": "Southern",
    "negerisembilan": "Southern",
    "pahang": "East Coast",
    "terengganu": "East Coast",
    "kelantan": "East Coast",
    "sabah": "East Malaysia",
    "sarawak": "East Malaysia",
}


def _title_case(name: str) -> str:
    # "PAVILION KUALA LUMPUR (NEW)" -> "Pavilion Kuala Lumpur (New)"; skips leading punctuation.
    def cap(word: str) -> str:
        for i, ch in enumerate(word):
            if ch.isalpha():
                return word[:i] + ch.upper() + word[i + 1 :].lower()
        return word

    return " ".join(cap(word) for word in name.split())


def parse_cinemas(payload: dict) -> list[Cinema]:
    cinemas: list[Cinema] = []
    seen: set[str] = set()
    for state in payload.get("results") or []:
        if state.get("value") == "all":
            continue
        region = STATE_TO_REGION.get(state.get("value", ""), state.get("label", ""))
        for item in state.get("cinemas") or []:
            cinema_id = item["cinemaid"]
            if cinema_id in seen:
                continue
            seen.add(cinema_id)
            name = cinema_name(cinema_id, _title_case(item.get("name", cinema_id)), state.get("label", ""))
            cinemas.append(
                Cinema(
                    chain=CHAIN,
                    cinema_id=cinema_id,
                    name=name,
                    region=region,
                    state=state.get("label", ""),
                )
            )
    return cinemas


def _int_or_none(value) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _poster_url(info: dict) -> str:
    for asset in info.get("assets") or []:
        if asset.get("assetkey") == "poster":
            return ((asset.get("extdata") or {}).get("fileinfo") or {}).get("fileurl") or ""
    return ""


# Google Maps embed links carry the point as "!2d<longitude>!3d<latitude>".
_MAP_POINT_RE = re.compile(r"!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)")


def _map_point(day_cinema: dict) -> tuple[float | None, float | None]:
    mapurl = ((day_cinema.get("extdata") or {}).get("cinema") or {}).get("mapurl") or ""
    match = _MAP_POINT_RE.search(mapurl)
    if not match:
        return None, None
    return float_or_none(match.group(2)), float_or_none(match.group(1))


def parse_showtimes(payload: dict, cinema: Cinema) -> list[Showtime]:
    if not payload.get("success"):
        return []
    results = payload.get("results") or {}
    movies = {m["recid"]: m for m in results.get("movies") or []}
    shows: list[Showtime] = []
    for day_cinema in (results.get("businessday") or {}).get("cinemas") or []:
        latitude, longitude = _map_point(day_cinema)
        for movie in day_cinema.get("movies") or []:
            # TGV sometimes lists sessions for a film it sends no details for (no name, poster
            # or booking page); there is nothing to show or book, so skip them.
            info = movies.get(movie.get("movieid")) or {}
            if not info.get("name"):
                continue
            movieinfo = (info.get("extdata") or {}).get("movieinfo") or {}
            raw_tags = (info.get("extdata") or {}).get("tags") or ()
            tags = tuple(raw_tags) if isinstance(raw_tags, (list, tuple)) else (raw_tags,)
            title = info["name"]
            booking_url = f"{MOVIE_URL}/{info['itemkey']}" if info.get("itemkey") else ""
            poster_url = _poster_url(info)
            info_url = f"{INFO_URL}/{info['itemkey']}" if info.get("itemkey") else ""
            subtitles = (
                normalize_subtitles(movieinfo["subtitlelang"]) if "subtitlelang" in movieinfo else None
            )
            for experience in movie.get("experiences") or []:
                for session in experience.get("sessions") or []:
                    shows.append(
                        Showtime(
                            chain=CHAIN,
                            cinema_id=cinema.cinema_id,
                            cinema_name=cinema.name,
                            region=cinema.region,
                            movie_title=title,
                            start=datetime.fromisoformat(session["showtimemy"]),
                            business_date=date.fromisoformat(session["businessdate"]),
                            experience=(session.get("experience") or "").upper(),
                            hall=session.get("screenname") or "",
                            duration_mins=_int_or_none(movieinfo.get("runtimemins")),
                            rating=str(movieinfo.get("rating") or ""),
                            language=movieinfo.get("lang") or "",
                            genres=tuple(movieinfo.get("genre") or ()),
                            tags=tags,
                            booking_url=booking_url,
                            poster_url=poster_url,
                            subtitles=subtitles,
                            info_url=info_url,
                            latitude=latitude,
                            longitude=longitude,
                        )
                    )
    return shows


def fetch_cinemas() -> list[Cinema]:
    return parse_cinemas(http.get_json(STATES_URL))


def fetch_showtimes(cinema: Cinema, day: date) -> list[Showtime]:
    payload = http.post_json(
        SESSIONS_URL, {"cinemaid": cinema.cinema_id, "businessdate": day.isoformat()}
    )
    return parse_showtimes(payload, cinema)
