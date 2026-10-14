"""TGV Cinemas provider.

Uses the same public JSON API as https://www.tgv.com.my (api.tgv.com.my).
"""

from __future__ import annotations

from datetime import date, datetime

from . import http
from .models import Cinema, Showtime

CHAIN = "TGV"
API_BASE = "https://api.tgv.com.my/api"
STATES_URL = f"{API_BASE}/cinemas/v1/getstatecinema"
SESSIONS_URL = f"{API_BASE}/boxoffice/v1/moviesession_get"
MOVIE_URL = "https://www.tgv.com.my/movies/details"

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
            name = _title_case(item.get("name", cinema_id))
            if not name.upper().startswith("TGV"):
                name = f"TGV {name}"
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


def parse_showtimes(payload: dict, cinema: Cinema) -> list[Showtime]:
    if not payload.get("success"):
        return []
    results = payload.get("results") or {}
    movies = {m["recid"]: m for m in results.get("movies") or []}
    shows: list[Showtime] = []
    for day_cinema in (results.get("businessday") or {}).get("cinemas") or []:
        for movie in day_cinema.get("movies") or []:
            info = movies.get(movie.get("movieid"), {})
            movieinfo = (info.get("extdata") or {}).get("movieinfo") or {}
            title = info.get("name") or "Unknown movie"
            booking_url = f"{MOVIE_URL}/{info['itemkey']}" if info.get("itemkey") else ""
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
                            booking_url=booking_url,
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
