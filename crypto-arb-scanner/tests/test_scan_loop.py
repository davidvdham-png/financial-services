"""End-to-end wiring: discovery -> multi-venue poll loop -> JSONL -> report.

Exchanges are stubbed, so this exercises everything except the HTTP calls
and runs without network access.
"""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from scanner import report as report_module
from scanner import scan as scan_module
from scanner.types import BookTop, Market, Venue, VenueError

MARKETS = [
    Market("BTC-EUR", "BTC", "EUR", "trading", 5.0, 0.0001),
    Market("ETH-EUR", "ETH", "EUR", "trading", 5.0, 0.001),
    Market("ETH-BTC", "ETH", "BTC", "trading", 0.0001, 0.001),
    Market("DEAD-EUR", "DEAD", "EUR", "halted", 5.0, 0.001),
]


class FakeVenue(Venue):
    """Replays a fixed sequence of order books, one per poll."""

    def __init__(self, name, eth_eur_bids, markets=MARKETS, fail_polls=0):
        self.name = name
        self.default_taker_fee = 0.0025
        self.eth_eur_bids = list(eth_eur_bids)
        self._markets = markets
        self.fail_polls = fail_polls
        self.polls = 0
        self.book_calls = []

    def markets(self):
        return self._markets

    def ticker_book(self):
        if self.polls < self.fail_polls:
            self.polls += 1
            raise VenueError("stubbed outage")
        bid = self.eth_eur_bids[min(self.polls, len(self.eth_eur_bids) - 1)]
        self.polls += 1
        return {
            "BTC-EUR": BookTop("BTC-EUR", 99_990.0, 1.0, 100_000.0, 0.5),
            "ETH-EUR": BookTop("ETH-EUR", bid, 4.0, bid + 10, 5.0),
            "ETH-BTC": BookTop("ETH-BTC", 0.0499, 20.0, 0.05, 10.0),
        }

    def book(self, market, depth=25):
        self.book_calls.append(market)
        return {"bids": [(99_000.0, 100.0)], "asks": [(0.001, 1_000_000.0)]}


class ScanTestCase(unittest.TestCase):
    def run_scan(self, argv, venues):
        """venues: {name: FakeVenue}. Returns (exit code, stdout, venues)."""
        buffer = io.StringIO()
        with mock.patch.object(scan_module, "build", side_effect=lambda name, **kw: venues[name]):
            with redirect_stdout(buffer), redirect_stderr(io.StringIO()):
                code = scan_module.main(argv)
        return code, buffer.getvalue(), venues


class TestSingleVenue(ScanTestCase):
    def test_scan_writes_episodes_and_report_reads_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            code, output, _ = self.run_scan(
                ["--venue", "bitvavo", "--interval", "0", "--fee", "0",
                 "--threshold-bps", "10", "--max-polls", "4", "--out", str(out)],
                {"bitvavo": FakeVenue("bitvavo", [5_100.0, 5_100.0, 5_000.0, 5_000.0])},
            )

            self.assertEqual(code, 0)
            self.assertIn("triangular cycles through EUR: 2", output)

            records = [json.loads(line) for line in out.read_text().splitlines()]
            episodes = [r for r in records if r["type"] == "episode"]
            self.assertEqual(len(episodes), 1)
            self.assertEqual(episodes[0]["venue"], "bitvavo")
            self.assertEqual(episodes[0]["cycle"], "EUR>BTC>ETH>EUR")
            self.assertEqual(episodes[0]["samples"], 2)

            summary = json.loads(output[output.rindex("{\n  \"ran_for_s\"") :])
            self.assertEqual(summary["venues"][0]["polls"], 4)
            self.assertEqual(summary["venues"][0]["episodes"], 1)

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                self.assertEqual(report_module.main([str(out)]), 0)
            rendered = buffer.getvalue()
            self.assertIn("--- bitvavo ---", rendered)
            self.assertIn("EUR>BTC>ETH>EUR", rendered)

    def test_depth_check_fires_and_is_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            _, _, venues = self.run_scan(
                ["--venue", "bitvavo", "--interval", "0", "--fee", "0",
                 "--threshold-bps", "10", "--depth-check-bps", "10",
                 "--depth-sizes", "100", "--max-polls", "1", "--out", str(out)],
                {"bitvavo": FakeVenue("bitvavo", [5_100.0])},
            )
            self.assertEqual(sorted(venues["bitvavo"].book_calls), ["BTC-EUR", "ETH-BTC", "ETH-EUR"])
            checks = [
                json.loads(line)
                for line in out.read_text().splitlines()
                if json.loads(line)["type"] == "depth_check"
            ]
            self.assertEqual(len(checks), 1)
            self.assertEqual(checks[0]["venue"], "bitvavo")

    def test_list_cycles_exits_without_polling(self):
        venues = {"bitvavo": FakeVenue("bitvavo", [5_000.0])}
        code, output, _ = self.run_scan(["--venue", "bitvavo", "--list-cycles"], venues)
        self.assertEqual(code, 0)
        self.assertEqual(venues["bitvavo"].polls, 0)
        self.assertIn("EUR>BTC>ETH>EUR", output)

    def test_halted_markets_never_enter_a_cycle(self):
        _, output, _ = self.run_scan(
            ["--venue", "bitvavo", "--list-cycles"], {"bitvavo": FakeVenue("bitvavo", [5_000.0])}
        )
        self.assertNotIn("DEAD", output)
        self.assertIn("3 tradeable markets of 4", output)

    def test_venue_without_cross_quotes_exits_nonzero(self):
        eur_only = [m for m in MARKETS if m.quote == "EUR"]
        venue = FakeVenue("bitvavo", [5_000.0], markets=eur_only)
        code, _, _ = self.run_scan(["--venue", "bitvavo", "--max-polls", "1"], {"bitvavo": venue})
        self.assertEqual(code, 1)
        self.assertEqual(venue.polls, 0)


class TestMultiVenue(ScanTestCase):
    def scans(self):
        return {
            "bitvavo": FakeVenue("bitvavo", [5_100.0, 5_000.0]),
            "kraken": FakeVenue("kraken", [5_050.0, 5_000.0]),
            "okx": FakeVenue("okx", [5_000.0, 5_000.0]),
        }

    def test_every_venue_is_polled_and_tagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            venues = self.scans()
            code, output, _ = self.run_scan(
                ["--venue", "bitvavo,kraken,okx", "--interval", "0", "--fee", "0",
                 "--threshold-bps", "10", "--max-polls", "2", "--out", str(out)],
                venues,
            )
            self.assertEqual(code, 0)
            self.assertEqual([v.polls for v in venues.values()], [2, 2, 2])

            episodes = [json.loads(line) for line in out.read_text().splitlines()]
            # okx never went above threshold, so it contributes no episodes.
            self.assertEqual({e["venue"] for e in episodes}, {"bitvavo", "kraken"})

            summary = json.loads(output[output.rindex("{\n  \"ran_for_s\"") :])
            self.assertEqual([v["venue"] for v in summary["venues"]], ["bitvavo", "kraken", "okx"])

    def test_report_compares_venues(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            self.run_scan(
                ["--venue", "bitvavo,kraken,okx", "--interval", "0", "--fee", "0",
                 "--threshold-bps", "10", "--max-polls", "2", "--out", str(out)],
                self.scans(),
            )
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                report_module.main([str(out)])
            rendered = buffer.getvalue()
            self.assertIn("venue comparison", rendered)
            self.assertIn("--- bitvavo ---", rendered)
            self.assertIn("--- kraken ---", rendered)

    def test_one_venue_failing_does_not_stop_the_others(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            venues = self.scans()
            venues["kraken"] = FakeVenue("kraken", [5_100.0], fail_polls=99)
            code, output, _ = self.run_scan(
                ["--venue", "bitvavo,kraken,okx", "--interval", "0", "--fee", "0",
                 "--threshold-bps", "10", "--max-polls", "2", "--out", str(out)],
                venues,
            )
            self.assertEqual(code, 0)
            self.assertEqual(venues["bitvavo"].polls, 2)
            summary = json.loads(output[output.rindex("{\n  \"ran_for_s\"") :])
            kraken = next(v for v in summary["venues"] if v["venue"] == "kraken")
            self.assertEqual(kraken["poll_failures"], 2)
            self.assertEqual(kraken["polls"], 0)

    def test_per_venue_fee_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            _, output, _ = self.run_scan(
                ["--venue", "bitvavo,okx", "--interval", "0",
                 "--fee", "bitvavo=0.0025,okx=0.001",
                 "--max-polls", "1", "--out", str(out)],
                {"bitvavo": FakeVenue("bitvavo", [5_000.0]), "okx": FakeVenue("okx", [5_000.0])},
            )
            self.assertIn("break-even hurdle 75 bps", output)
            self.assertIn("break-even hurdle 30 bps", output)


class TestFeeParsing(unittest.TestCase):
    def test_flat_fee_applies_everywhere(self):
        self.assertEqual(
            scan_module.parse_fees("0.001", ["bitvavo", "okx"]),
            {"bitvavo": 0.001, "okx": 0.001},
        )

    def test_per_venue_overrides_leave_others_on_default(self):
        self.assertEqual(
            scan_module.parse_fees("okx=0.001", ["bitvavo", "okx"]),
            {"bitvavo": None, "okx": 0.001},
        )

    def test_no_spec_means_venue_defaults(self):
        self.assertEqual(scan_module.parse_fees(None, ["kraken"]), {"kraken": None})

    def test_unknown_venue_is_rejected(self):
        with self.assertRaises(SystemExit):
            scan_module.parse_fees("binance=0.001", ["kraken"])

    def test_garbage_is_rejected(self):
        with self.assertRaises(SystemExit):
            scan_module.parse_fees("cheap", ["kraken"])


if __name__ == "__main__":
    unittest.main()
