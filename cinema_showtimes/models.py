"""Chain-neutral data models shared by the GSC and TGV providers."""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone

MYT = timezone(timedelta(hours=8), "MYT")

# Common regions both chains are mapped onto.
REGIONS = ("Klang Valley", "Northern", "Southern", "East Coast", "East Malaysia")

_TAG_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_title(title: str) -> str:
    """Reduce a movie title to a key that matches across chains.

    Drops format/promo tags such as ``(IMAX)`` or ``[BED]``, non-Latin words, case and punctuation,
    so "(IMAX) Jailer 2" (GSC) and "Jailer 2" (TGV) group together.
    """
    without_tags = _TAG_RE.sub(" ", title).lower()
    # TGV appends Chinese/Tamil titles ("Go for Broke 2 重生2"); keep Latin-script words only.
    latin_words = [w for w in without_tags.split() if all(ord(ch) <= 0x24F for ch in w)]
    return _NON_ALNUM_RE.sub(" ", " ".join(latin_words)).strip()


def float_or_none(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# Both chains name subtitle languages differently ("Bahasa Melayu" vs "BM", "Chinese" vs "CHI").
_SUBTITLE_NAMES = {
    "bm": "BM",
    "bahasa melayu": "BM",
    "malay": "BM",
    "chi": "Chinese",
    "chinese": "Chinese",
    "eng": "English",
    "english": "English",
    "tam": "Tamil",
    "tamil": "Tamil",
}


def normalize_subtitles(names) -> tuple[str, ...]:
    out: list[str] = []
    for name in names or ():
        name = str(name).strip()
        if not name or name in {"-", "NA", "N/A"}:
            continue
        label = _SUBTITLE_NAMES.get(name.lower(), name)
        if label not in out:
            out.append(label)
    return tuple(out)


def today_myt() -> date:
    return datetime.now(MYT).date()


@dataclass(frozen=True)
class Cinema:
    chain: str
    cinema_id: str
    name: str
    region: str
    state: str = ""
    # GSC premium venues (Aurum, Velvet, ...) need their hall group to list shows.
    hall_group: str = ""
    latitude: float | None = None
    longitude: float | None = None


@dataclass(frozen=True)
class Showtime:
    chain: str
    cinema_id: str
    cinema_name: str
    region: str
    movie_title: str
    start: datetime
    business_date: date
    experience: str = ""
    hall: str = ""
    duration_mins: int | None = None
    rating: str = ""
    language: str = ""
    sold_out: bool = False
    booking_url: str = ""
    # Largest poster this chain offers, and a smaller one if it has one.
    poster_url: str = ""
    poster_small_url: str = ""
    # Subtitle languages as the chain lists them ("BM", "Chinese", ...); None when unknown.
    subtitles: tuple[str, ...] | None = None
    # The chain's page about the movie (not the booking page).
    info_url: str = ""
    # Where the cinema is, when the chain says (GSC: cinema list; TGV: map link per cinema).
    latitude: float | None = None
    longitude: float | None = None
    movie_key: str = field(default="", compare=False)

    def __post_init__(self):
        if not self.movie_key:
            object.__setattr__(self, "movie_key", normalize_title(self.movie_title))

    def to_dict(self) -> dict:
        data = asdict(self)
        data["start"] = self.start.isoformat(timespec="minutes")
        data["business_date"] = self.business_date.isoformat()
        return data
