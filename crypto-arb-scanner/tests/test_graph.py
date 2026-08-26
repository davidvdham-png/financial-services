"""Cycle enumeration over a hand-built market list."""
import unittest

from scanner.bitvavo import Market
from scanner.graph import BUY, SELL, build_edges, find_cycles


def market(name, base, quote, status="trading"):
    return Market(name, base, quote, status, 5.0, 0.0001)


TRIANGLE = [
    market("BTC-EUR", "BTC", "EUR"),
    market("ETH-EUR", "ETH", "EUR"),
    market("ETH-BTC", "ETH", "BTC"),
]


class TestGraph(unittest.TestCase):
    def test_each_market_gives_both_directions(self):
        edges = build_edges([market("BTC-EUR", "BTC", "EUR")])
        self.assertEqual([leg.side for leg in edges["EUR"]], [BUY])
        self.assertEqual([leg.side for leg in edges["BTC"]], [SELL])

    def test_halted_markets_are_excluded(self):
        edges = build_edges([market("XYZ-EUR", "XYZ", "EUR", status="halted")])
        self.assertEqual(edges, {})

    def test_triangle_is_found_in_both_directions(self):
        cycles = find_cycles(TRIANGLE, start_asset="EUR")
        self.assertEqual(len(cycles), 2)
        self.assertEqual(
            {cycle.key for cycle in cycles},
            {"EUR>BTC>ETH>EUR", "EUR>ETH>BTC>EUR"},
        )

    def test_cycles_use_three_distinct_markets(self):
        for cycle in find_cycles(TRIANGLE, start_asset="EUR"):
            self.assertEqual(len({leg.market for leg in cycle.legs}), 3)
            self.assertEqual(cycle.path[0], "EUR")
            self.assertEqual(cycle.path[-1], "EUR")

    def test_eur_only_venue_has_no_triangles(self):
        # The realistic failure case: every pair quoted in EUR means no path
        # can leave EUR and return through a third asset.
        eur_only = [
            market("BTC-EUR", "BTC", "EUR"),
            market("ETH-EUR", "ETH", "EUR"),
            market("SOL-EUR", "SOL", "EUR"),
        ]
        self.assertEqual(find_cycles(eur_only, start_asset="EUR"), [])

    def test_unknown_start_asset_yields_nothing(self):
        self.assertEqual(find_cycles(TRIANGLE, start_asset="GBP"), [])

    def test_extra_quote_assets_multiply_the_cycle_count(self):
        markets = TRIANGLE + [
            market("USDC-EUR", "USDC", "EUR"),
            market("BTC-USDC", "BTC", "USDC"),
            market("ETH-USDC", "ETH", "USDC"),
        ]
        cycles = find_cycles(markets, start_asset="EUR")
        self.assertIn("EUR>USDC>BTC>EUR", {c.key for c in cycles})
        self.assertGreater(len(cycles), 2)
