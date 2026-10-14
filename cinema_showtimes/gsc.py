"""GSC (Golden Screen Cinemas) provider.

Uses the same public endpoints as the GSC e-payment web app
(https://epaymentwebapp.gsc.com.my): a JSON cinema list and an XML
showtimes-by-location web service.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from urllib.parse import quote

from . import http
from .models import Cinema, Showtime, float_or_none

CHAIN = "GSC"
API_BASE = "https://epaymentapi.gsc.com.my"
LOCATIONS_URL = f"{API_BASE}/gsc/epay/GetEpaymentLocations"
SHOWTIMES_URL = f"{API_BASE}/showtimews/service.asmx/getShowTimesByLocation_ParentChild_V2"
BOOKING_BASE = "https://epaymentwebapp.gsc.com.my/showtime-by-movies"


def parse_cinemas(payload: dict) -> list[Cinema]:
    locations = payload.get("Response", {}).get("Body", {}).get("Locations") or []
    return [
        Cinema(
            chain=CHAIN,
            cinema_id=str(loc["CinemaCode"]),
            name=loc.get("EpaymentName") or loc.get("CinemaName", ""),
            region=loc.get("Region", ""),
            hall_group=loc.get("HallGroup") or "",
            latitude=float_or_none(loc.get("Latitude")),
            longitude=float_or_none(loc.get("Longitude")),
        )
        for loc in locations
        if not loc.get("IsEpayHidden")
    ]


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value else None
    except ValueError:
        return None


def _booking_url(parent_code: str, title: str) -> str:
    slug = re.sub(r"\s+", "-", title.strip().lower())
    return f"{BOOKING_BASE}/{parent_code}/{quote(slug, safe='')}"


def parse_showtimes(xml_text: str, cinema: Cinema) -> list[Showtime]:
    root = ET.fromstring(xml_text)
    shows: list[Showtime] = []
    for oprn in root.iter("oprn"):
        business_date = date.fromisoformat(oprn.get("date"))
        for parent in oprn.iter("parent"):
            title = parent.get("title", "")
            booking_url = _booking_url(parent.get("code", ""), title)
            for child in parent.iter("child"):
                for show in child.iter("show"):
                    start = datetime.strptime(
                        f"{show.get('date')} {show.get('time')}", "%Y-%m-%d %H%M"
                    )
                    hall = show.get("hname", "")
                    shows.append(
                        Showtime(
                            chain=CHAIN,
                            cinema_id=cinema.cinema_id,
                            cinema_name=cinema.name,
                            region=cinema.region,
                            movie_title=title,
                            start=start,
                            business_date=business_date,
                            experience=show.get("type", ""),
                            hall=f"Hall {hall}" if hall.isdigit() else hall,
                            duration_mins=_int_or_none(child.get("duration")),
                            rating=child.get("rating", ""),
                            language=child.get("lang", ""),
                            sold_out=show.get("hallfull") == "1",
                            booking_url=booking_url,
                            poster_url=child.get("thumb_big", ""),
                            poster_small_url=child.get("thumb_medium", ""),
                            latitude=cinema.latitude,
                            longitude=cinema.longitude,
                        )
                    )
    return shows


def fetch_cinemas() -> list[Cinema]:
    return parse_cinemas(http.get_json(LOCATIONS_URL))


def fetch_showtimes(cinema: Cinema, day: date) -> list[Showtime]:
    xml_text = http.get_text(
        SHOWTIMES_URL,
        {
            "locationid": cinema.cinema_id,
            "oprndate": day.isoformat(),
            "hallGroup": cinema.hall_group,
        },
    )
    return parse_showtimes(xml_text, cinema)
