"""End-to-end wiring: discovery -> poll loop -> JSONL -> report.

The exchange is stubbed, so this exercises everything except the HTTP calls
themselves and runs without network access.
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
from scanner.bitvavo import BookTop, Market

MARKETS = [
    Market("BTC-EUR", "BTC", "EUR", "trading", 5.0, 0.0001),
    Market("ETH-EUR", "ETH", "EUR", "trading", 5.0, 0.001),
    Market("ETH-BTC", "ETH", "BTC", "trading", 0.0001, 0.001),
    Market("DEAD-EUR", "DEAD", "EUR", "halted", 5.0, 0.001),
]


class FakeClient:
    """Replays a fixed sequence of order books, one per poll."""

    def __init__(self, eth_eur_bids):
        self.eth_eur_bids = list(eth_eur_bids)
        self.polls = 0
        self.book_calls = []

    def markets(self):
        return MARKETS

    def ticker_book(self):
        bid = self.eth_eur_bids[min(self.polls, len(self.eth_eur_bids) - 1)]
        self.polls += 1
        return {
            "BTC-EUR": BookTop("BTC-EUR", 99_990.0, 1.0, 100_000.0, 0.5),
            "ETH-EUR": BookTop("ETH-EUR", bid, 4.0, bid + 10, 5.0),
            "ETH-BTC": BookTop("ETH-BTC", 0.0499, 20.0, 0.05, 10.0),
        }

    def book(self, market, depth=25):
        self.book_calls.append(market)
        return {
            "bids": [(99_000.0, 100.0)],
            "asks": [(0.001, 1_000_000.0)],
        }


class TestScanLoop(unittest.TestCase):
    def run_scan(self, argv, bids):
        client = FakeClient(bids)
        buffer = io.StringIO()
        with mock.patch.object(scan_module, "BitvavoPublicClient", return_value=client):
            with redirect_stdout(buffer), redirect_stderr(io.StringIO()):
                code = scan_module.main(argv)
        return code, buffer.getvalue(), client

    def test_scan_writes_episodes_and_report_reads_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            # Profitable for two polls, then back to break-even.
            code, output, _ = self.run_scan(
                [
                    "--interval", "0",
                    "--fee", "0",
                    "--threshold-bps", "10",
                    "--max-polls", "4",
                    "--out", str(out),
                ],
                bids=[5_100.0, 5_100.0, 5_000.0, 5_000.0],
            )

            self.assertEqual(code, 0)
            self.assertIn("triangular cycles through EUR: 2", output)
            self.assertIn("best", output)

            records = [json.loads(line) for line in out.read_text().splitlines()]
            episodes = [r for r in records if r["type"] == "episode"]
            self.assertEqual(len(episodes), 1)
            self.assertEqual(episodes[0]["cycle"], "EUR>BTC>ETH>EUR")
            self.assertEqual(episodes[0]["samples"], 2)
            self.assertGreater(episodes[0]["peak_bps"], 100.0)

            summary = json.loads(output[output.rindex("{") :])
            self.assertEqual(summary["polls"], 4)
            self.assertEqual(summary["episodes"], 1)

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                self.assertEqual(report_module.main([str(out)]), 0)
            rendered = buffer.getvalue()
            self.assertIn("episodes      : 1", rendered)
            self.assertIn("EUR>BTC>ETH>EUR", rendered)

    def test_depth_check_fires_and_is_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episodes.jsonl"
            _, _, client = self.run_scan(
                [
                    "--interval", "0",
                    "--fee", "0",
                    "--threshold-bps", "10",
                    "--depth-check-bps", "10",
                    "--depth-sizes", "100",
                    "--max-polls", "1",
                    "--out", str(out),
                ],
                bids=[5_100.0],
            )
            self.assertEqual(sorted(client.book_calls), ["BTC-EUR", "ETH-BTC", "ETH-EUR"])
            records = [json.loads(line) for line in out.read_text().splitlines()]
            checks = [r for r in records if r["type"] == "depth_check"]
            self.assertEqual(len(checks), 1)
            self.assertIn("100.0", checks[0]["net_bps_by_size"])

    def test_list_cycles_exits_without_polling(self):
        code, output, client = self.run_scan(["--list-cycles"], bids=[5_000.0])
        self.assertEqual(code, 0)
        self.assertEqual(client.polls, 0)
        self.assertIn("EUR>BTC>ETH>EUR", output)
        self.assertIn("buy BTC-EUR", output)

    def test_halted_markets_never_enter_a_cycle(self):
        _, output, _ = self.run_scan(["--list-cycles"], bids=[5_000.0])
        self.assertNotIn("DEAD", output)
        self.assertIn("markets: 3 tradeable of 4", output)

    def test_venue_without_cross_quotes_exits_nonzero(self):
        client = FakeClient([5_000.0])
        client.markets = lambda: [m for m in MARKETS if m.quote == "EUR"]
        with mock.patch.object(scan_module, "BitvavoPublicClient", return_value=client):
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = scan_module.main(["--max-polls", "1"])
        self.assertEqual(code, 1)
        self.assertEqual(client.polls, 0)


if __name__ == "__main__":
    unittest.main()
