"""Command-line interface: ``python -m cinema_showtimes --help``."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable
from datetime import date, timedelta

from .aggregator import collect_showtimes, filter_showtimes, group_by_movie, list_cinemas
from .models import REGIONS, Showtime, today_myt


def parse_date(value: str, today: date | None = None) -> date:
    today = today or today_myt()
    value = value.strip().lower()
    if value == "today":
        return today
    if value == "tomorrow":
        return today + timedelta(days=1)
    if value.startswith("+") and value[1:].isdigit():
        return today + timedelta(days=int(value[1:]))
    return date.fromisoformat(value)


def _movie_header(shows: list[Showtime]) -> str:
    # Prefer the shortest title variant ("Jailer 2" over "(IMAX) Jailer 2").
    title = min((s.movie_title for s in shows), key=len)
    duration = next((s.duration_mins for s in shows if s.duration_mins), None)
    details = [
        f"{duration} min" if duration else "",
        next((s.rating for s in shows if s.rating), ""),
        next((s.language for s in shows if s.language), ""),
    ]
    details = [d for d in details if d]
    return f"{title}  ({' · '.join(details)})" if details else title


def _format_show(show: Showtime) -> str:
    text = show.start.strftime("%H:%M")
    if show.experience:
        text += f" {show.experience}"
    if show.sold_out:
        text += " (full)"
    return text


def render_text(showtimes: Iterable[Showtime]) -> str:
    groups = group_by_movie(showtimes)
    if not groups:
        return "No showtimes found."
    lines: list[str] = []
    for shows in groups.values():
        lines.append(_movie_header(shows))
        by_cinema: dict[tuple[str, str], list[Showtime]] = {}
        for show in shows:
            by_cinema.setdefault((show.chain, show.cinema_name), []).append(show)
        width = max(len(name) for _, name in by_cinema)
        for (chain, name), cinema_shows in sorted(by_cinema.items()):
            times = ", ".join(_format_show(s) for s in sorted(cinema_shows, key=lambda s: s.start))
            lines.append(f"  {chain}  {name.ljust(width)}  {times}")
        lines.append("")
    return "\n".join(lines).rstrip()


def _add_filters(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--chain",
        action="append",
        choices=["gsc", "tgv"],
        type=str.lower,
        help="Only this chain (repeatable). Default: both.",
    )
    parser.add_argument(
        "--region", help=f"Region substring, e.g. 'klang valley'. One of: {', '.join(REGIONS)}."
    )
    parser.add_argument("--cinema", help="Cinema name substring, e.g. 'mid valley'.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cinema-showtimes",
        description="Check GSC and TGV showtimes across Malaysia in one place.",
    )
    sub = parser.add_subparsers(dest="command")

    shows = sub.add_parser("showtimes", help="List showtimes (default command).")
    shows.add_argument(
        "--date", default="today", help="today, tomorrow, +N days, or YYYY-MM-DD. Default: today."
    )
    _add_filters(shows)
    shows.add_argument("--movie", help="Movie title substring, e.g. 'jailer'.")
    shows.add_argument("--after", help="Only shows starting at/after HH:MM, e.g. 19:00.")
    shows.add_argument("--json", action="store_true", help="Print JSON instead of text.")

    cinemas = sub.add_parser("cinemas", help="List cinemas.")
    _add_filters(cinemas)
    cinemas.add_argument("--json", action="store_true", help="Print JSON instead of text.")

    serve = sub.add_parser("serve", help="Run the local web page.")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    return parser


def _print_errors(errors: list[str]) -> None:
    for error in errors:
        print(f"warning: {error}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0].startswith("-") and argv[0] not in ("-h", "--help"):
        argv.insert(0, "showtimes")
    args = build_parser().parse_args(argv)

    if args.command == "serve":
        from .web import serve

        serve(args.host, args.port)
        return 0

    if args.command == "cinemas":
        result = list_cinemas(args.chain, args.region, args.cinema)
        _print_errors(result.errors)
        if args.json:
            print(json.dumps([c.__dict__ for c in result.cinemas], indent=2))
        else:
            for c in sorted(result.cinemas, key=lambda c: (c.region, c.chain, c.name)):
                print(f"{c.region:<14} {c.chain}  {c.name}  [{c.cinema_id}]")
        return 0

    try:
        day = parse_date(args.date)
    except ValueError:
        print(f"error: invalid --date {args.date!r}", file=sys.stderr)
        return 2
    result = collect_showtimes(day, args.chain, args.region, args.cinema)
    _print_errors(result.errors)
    shows = filter_showtimes(result.showtimes, movie=args.movie, after=args.after)
    if args.json:
        print(json.dumps([s.to_dict() for s in shows], indent=2))
    else:
        print(f"Showtimes for {day:%a %d %b %Y}\n")
        print(render_text(shows))
    return 0
