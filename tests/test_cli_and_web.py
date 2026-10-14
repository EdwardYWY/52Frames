"""Tests for the CLI rendering helpers and the web API handler."""

from __future__ import annotations

import unittest
from datetime import date, datetime

from cinema_showtimes import cli, web
from cinema_showtimes.aggregator import Result
from cinema_showtimes.models import Showtime


def _show(chain, cinema, title, hour, minute=0, **kwargs):
    return Showtime(
        chain=chain,
        cinema_id=cinema,
        cinema_name=cinema,
        region="Klang Valley",
        movie_title=title,
        start=datetime(2026, 10, 15, hour, minute),
        business_date=date(2026, 10, 15),
        **kwargs,
    )


class ParseDateTest(unittest.TestCase):
    def test_relative_and_iso_dates(self):
        base = date(2026, 10, 14)
        self.assertEqual(cli.parse_date("today", base), base)
        self.assertEqual(cli.parse_date("tomorrow", base), date(2026, 10, 15))
        self.assertEqual(cli.parse_date("+3", base), date(2026, 10, 17))
        self.assertEqual(cli.parse_date("2026-10-20", base), date(2026, 10, 20))

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            cli.parse_date("someday", date(2026, 10, 14))


class RenderTextTest(unittest.TestCase):
    def test_groups_movie_then_cinema_with_chain_labels(self):
        shows = [
            _show(
                "GSC",
                "Mid Valley",
                "(IMAX) Jailer 2",
                21,
                30,
                experience="IMAX",
                duration_mins=170,
                rating="16",
                language="TAM",
            ),
            _show("TGV", "TGV Pavilion", "Jailer 2", 13, 45, experience="DELUXE"),
            _show("TGV", "TGV Pavilion", "Jailer 2", 18, 0, experience="INDULGE", sold_out=True),
        ]
        text = cli.render_text(shows)
        lines = text.splitlines()

        self.assertIn("Jailer 2", lines[0])
        self.assertIn("170 min", lines[0])
        gsc_line = next(line for line in lines if "Mid Valley" in line)
        tgv_line = next(line for line in lines if "TGV Pavilion" in line)
        self.assertTrue(gsc_line.strip().startswith("GSC"))
        self.assertIn("21:30 IMAX", gsc_line)
        self.assertIn("13:45 DELUXE", tgv_line)
        self.assertIn("18:00 INDULGE (full)", tgv_line)
        self.assertLess(tgv_line.index("13:45"), tgv_line.index("18:00"))

    def test_empty(self):
        self.assertEqual(cli.render_text([]), "No showtimes found.")


class WebApiTest(unittest.TestCase):
    def test_showtimes_endpoint_applies_filters_and_reports_errors(self):
        calls = []

        def fake_collect(day, chains=None, region=None, cinema=None):
            calls.append((day, chains, region))
            return Result(
                showtimes=[
                    _show("GSC", "Mid Valley", "Jailer 2", 20),
                    _show("TGV", "TGV Pavilion", "Other Mommy", 21),
                ],
                errors=["GSC Somewhere: timed out"],
            )

        status, body = web.handle_api(
            "/api/showtimes",
            {"date": ["2026-10-15"], "region": ["Klang Valley"], "movie": ["jailer"]},
            collect=fake_collect,
        )

        self.assertEqual(status, 200)
        self.assertEqual(calls, [(date(2026, 10, 15), None, "Klang Valley")])
        self.assertEqual(body["date"], "2026-10-15")
        self.assertEqual([s["movie_title"] for s in body["showtimes"]], ["Jailer 2"])
        self.assertEqual(body["showtimes"][0]["start"], "2026-10-15T20:00")
        self.assertEqual(body["errors"], ["GSC Somewhere: timed out"])

    def test_bad_date_is_a_400(self):
        status, body = web.handle_api("/api/showtimes", {"date": ["nope"]}, collect=None)
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_unknown_path_is_a_404(self):
        status, _ = web.handle_api("/api/nothing", {}, collect=None)
        self.assertEqual(status, 404)


class StaticFilesTest(unittest.TestCase):
    def test_serves_the_browser_site_when_present(self):
        self.assertEqual(web.resolve_static("/"), web.SITE_DIR / "index.html")
        self.assertEqual(web.resolve_static("/js/providers.js"), web.SITE_DIR / "js" / "providers.js")

    def test_refuses_paths_outside_the_site(self):
        self.assertIsNone(web.resolve_static("/../README.md"))
        self.assertIsNone(web.resolve_static("/%2e%2e/cinema_showtimes/web.py"))
        self.assertIsNone(web.resolve_static("/missing.js"))

    def test_falls_back_to_the_packaged_page(self):
        missing = web.SITE_DIR / "does-not-exist"
        self.assertEqual(web.resolve_static("/", missing), web.STATIC_DIR / "index.html")
        self.assertIsNone(web.resolve_static("/js/app.js", missing))


if __name__ == "__main__":
    unittest.main()
