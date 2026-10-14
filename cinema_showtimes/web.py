"""A tiny local web page for browsing GSC + TGV showtimes (stdlib http.server)."""

from __future__ import annotations

import json
import threading
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .aggregator import Result, collect_showtimes, filter_showtimes, list_cinemas
from .models import REGIONS, today_myt

STATIC_DIR = Path(__file__).parent / "static"
# The browser-only site (also deployed to GitHub Pages). Present in a repo checkout, not when
# installed with pip; then the older page in static/ (which uses /api/showtimes) is served.
SITE_DIR = Path(__file__).resolve().parent.parent / "site"
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}
CACHE_TTL_SECONDS = 10 * 60

_cache: dict[tuple, tuple[float, Result]] = {}
_cache_lock = threading.Lock()


def cached_collect(day: date, chains=None, region=None, cinema=None) -> Result:
    """collect_showtimes with a short in-memory cache, to go easy on the cinema APIs."""
    key = (day, tuple(sorted(chains or ())), (region or "").lower(), (cinema or "").lower())
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    result = collect_showtimes(day, chains, region, cinema)
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
    return result


def _first(params: dict[str, list[str]], name: str) -> str | None:
    values = params.get(name)
    return values[0] if values and values[0] else None


def handle_api(path: str, params: dict[str, list[str]], collect=cached_collect) -> tuple[int, dict]:
    """Route an /api/* request to a (status, JSON body) pair."""
    chains = params.get("chain") or None
    region = _first(params, "region")
    cinema = _first(params, "cinema")

    if path == "/api/regions":
        return 200, {"regions": list(REGIONS)}

    if path == "/api/cinemas":
        result = list_cinemas(chains, region, cinema)
        return 200, {"cinemas": [c.__dict__ for c in result.cinemas], "errors": result.errors}

    if path == "/api/showtimes":
        raw_date = _first(params, "date")
        try:
            day = date.fromisoformat(raw_date) if raw_date else today_myt()
        except ValueError:
            return 400, {"error": f"invalid date {raw_date!r}, expected YYYY-MM-DD"}
        result = collect(day, chains=chains, region=region, cinema=cinema)
        shows = filter_showtimes(
            result.showtimes,
            chains=chains,
            movie=_first(params, "movie"),
            after=_first(params, "after"),
        )
        return 200, {
            "date": day.isoformat(),
            "showtimes": [s.to_dict() for s in shows],
            "errors": result.errors,
        }

    return 404, {"error": "not found"}


def resolve_static(url_path: str, site_dir: Path = SITE_DIR) -> Path | None:
    """Map a URL path to a file to serve, refusing anything outside the site folder."""
    if not (site_dir / "index.html").is_file():
        return STATIC_DIR / "index.html" if url_path in ("/", "/index.html") else None
    relative = unquote(url_path).lstrip("/") or "index.html"
    root = site_dir.resolve()
    target = (root / relative).resolve()
    if target.is_dir():
        target = target / "index.html"
    if not target.is_relative_to(root) or not target.is_file():
        return None
    if target.suffix.lower() not in CONTENT_TYPES:
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            status, body = handle_api(url.path, parse_qs(url.query))
            self._send(status, json.dumps(body).encode("utf-8"), "application/json")
            return
        target = resolve_static(url.path)
        if target is None:
            self._send(404, b"Not found", "text/plain")
            return
        self._send(200, target.read_bytes(), CONTENT_TYPES[target.suffix.lower()])


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Cinema showtimes running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
