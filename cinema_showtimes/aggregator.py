"""Fetch showtimes from every chain concurrently and filter/group them."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, time

from . import gsc, tgv
from .models import Cinema, Showtime

PROVIDERS = {"GSC": gsc, "TGV": tgv}
MAX_WORKERS = 8


@dataclass
class Result:
    showtimes: list[Showtime] = field(default_factory=list)
    cinemas: list[Cinema] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _matches(value: str, needle: str | None) -> bool:
    return not needle or needle.lower() in value.lower()


def _wanted_chains(chains: Iterable[str] | None, available: Iterable[str]) -> list[str]:
    if not chains:
        return list(available)
    wanted = {c.upper() for c in chains}
    return [c for c in available if c in wanted]


def list_cinemas(
    chains: Iterable[str] | None = None,
    region: str | None = None,
    cinema: str | None = None,
    providers: dict | None = None,
) -> Result:
    """Return cinemas for the selected chains; errors per chain are collected, not raised."""
    providers = providers or PROVIDERS
    cinemas: list[Cinema] = []
    errors: list[str] = []
    for chain in _wanted_chains(chains, providers):
        try:
            cinemas.extend(providers[chain].fetch_cinemas())
        except Exception as exc:  # noqa: BLE001 - surface any provider failure to the user
            errors.append(f"{chain}: could not load cinemas ({exc})")
    selected = [c for c in cinemas if _matches(c.region, region) and _matches(c.name, cinema)]
    return Result(cinemas=selected, errors=errors)


def collect_showtimes(
    day: date,
    chains: Iterable[str] | None = None,
    region: str | None = None,
    cinema: str | None = None,
    providers: dict | None = None,
) -> Result:
    """Fetch showtimes for ``day`` from every matching cinema of every selected chain."""
    providers = providers or PROVIDERS
    listing = list_cinemas(chains, region, cinema, providers)
    result = Result(cinemas=listing.cinemas, errors=list(listing.errors))

    def fetch(target: Cinema) -> list[Showtime]:
        return providers[target.chain].fetch_showtimes(target, day)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [(c, pool.submit(fetch, c)) for c in listing.cinemas]
        for target, future in futures:
            try:
                result.showtimes.extend(future.result())
            except Exception as exc:  # noqa: BLE001 - one cinema failing shouldn't sink the rest
                result.errors.append(f"{target.chain} {target.name}: {exc}")

    result.showtimes.sort(key=lambda s: (s.start, s.chain, s.cinema_name))
    return result


def _parse_hhmm(value: str) -> time:
    hours, _, minutes = value.partition(":")
    return time(int(hours), int(minutes or 0))


def filter_showtimes(
    showtimes: Iterable[Showtime],
    chains: Iterable[str] | None = None,
    region: str | None = None,
    cinema: str | None = None,
    movie: str | None = None,
    after: str | None = None,
) -> list[Showtime]:
    wanted = {c.upper() for c in chains} if chains else None
    earliest = _parse_hhmm(after) if after else None
    selected = [
        s
        for s in showtimes
        if (wanted is None or s.chain in wanted)
        and _matches(s.region, region)
        and _matches(s.cinema_name, cinema)
        and (_matches(s.movie_title, movie) or _matches(s.movie_key, movie))
        # Past-midnight shows belong to the previous business day, so keep them.
        and (earliest is None or s.start.date() > s.business_date or s.start.time() >= earliest)
    ]
    return sorted(selected, key=lambda s: (s.start, s.chain, s.cinema_name))


def group_by_movie(showtimes: Iterable[Showtime]) -> OrderedDict[str, list[Showtime]]:
    groups: OrderedDict[str, list[Showtime]] = OrderedDict()
    for show in sorted(showtimes, key=lambda s: (s.movie_key, s.start)):
        groups.setdefault(show.movie_key, []).append(show)
    return groups
