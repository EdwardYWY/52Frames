"""Tiny stdlib HTTP helpers (no third-party dependencies)."""

from __future__ import annotations

import json
import urllib.request
from urllib.parse import urlencode

USER_AGENT = "Mozilla/5.0 (compatible; cinema-showtimes/0.1)"
TIMEOUT_SECONDS = 20


def get_text(url: str, params: dict | None = None) -> str:
    if params:
        url = f"{url}?{urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


def get_json(url: str, params: dict | None = None):
    return json.loads(get_text(url, params))


def post_json(url: str, payload: dict):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))
