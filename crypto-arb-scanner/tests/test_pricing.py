"""Cycle arithmetic. No network: every input here is constructed by hand."""
import unittest

from scanner.types import BookTop, Market
from scanner.graph import BUY, SELL, Cycle, Leg
from scanner.pricing import (
    FEE_MODEL_OUTPUT,
    FEE_MODEL_QUOTE,
    evaluate_cycle,
    evaluate_cycle_at_size,
    walk_buy,
    walk_sell,
)

# EUR -> BTC -> ETH -> EUR, priced so the loop is exactly break-even at zero fee.
CYCLE = Cycle(
    (
        Leg("BTC-EUR", BUY, "EUR", "BTC"),
        Leg("ETH-BTC", BUY, "BTC", "ETH"),
        Leg("ETH-EUR", SELL, "ETH", "EUR"),
    )
)

MARKETS = {
    "BTC-EUR": Market("BTC-EUR", "BTC", "EUR", "trading", 5.0, 0.0001),
    "ETH-BTC": Market("ETH-BTC", "ETH", "BTC", "trading", 0.0001, 0.001),
    "ETH-EUR": Market("ETH-EUR", "ETH", "EUR", "trading", 5.0, 0.001),
}


def tops(eth_eur_bid=5000.0, btc_size=0.5, eth_btc_size=10.0, eth_eur_size=4.0):
    return {
        "BTC-EUR": BookTop("BTC-EUR", 99_990.0, 1.0, 100_000.0, btc_size),
        "ETH-BTC": BookTop("ETH-BTC", 0.0499, 20.0, 0.05, eth_btc_size),
        "ETH-EUR": BookTop("ETH-EUR", eth_eur_bid, eth_eur_size, eth_eur_bid + 10, 5.0),
    }


class TestEvaluateCycle(unittest.TestCase):
    def test_break_even_prices_with_no_fee(self):
        result = evaluate_cycle(CYCLE, tops(), MARKETS, fee=0.0)
        self.assertAlmostEqual(result.net_ratio, 1.0, places=12)
        self.assertAlmostEqual(result.net_bps, 0.0, places=8)

    def test_fee_is_charged_once_per_leg(self):
        fee = 0.0025
        result = evaluate_cycle(CYCLE, tops(), MARKETS, fee=fee, fee_model=FEE_MODEL_OUTPUT)
        self.assertAlmostEqual(result.net_ratio, (1 - fee) ** 3, places=12)
        # Gross is reported without fees so the raw spread stays visible.
        self.assertAlmostEqual(result.gross_ratio, 1.0, places=12)

    def test_quote_fee_model_is_marginally_kinder_on_buys(self):
        fee = 0.0025
        out = evaluate_cycle(CYCLE, tops(), MARKETS, fee, FEE_MODEL_OUTPUT)
        quote = evaluate_cycle(CYCLE, tops(), MARKETS, fee, FEE_MODEL_QUOTE)
        self.assertGreater(quote.net_ratio, out.net_ratio)
        # Two buy legs differ by 1/(1+f) vs (1-f): under a basis point in total.
        self.assertLess(quote.net_bps - out.net_bps, 1.0)

    def test_positive_edge_is_detected(self):
        # A 2% richer ETH bid turns the loop profitable even after 0.75% of fees.
        result = evaluate_cycle(CYCLE, tops(eth_eur_bid=5100.0), MARKETS, fee=0.0025)
        self.assertGreater(result.net_bps, 0.0)
        self.assertAlmostEqual(result.gross_ratio, 1.02, places=10)

    def test_max_notional_is_the_tightest_leg(self):
        result = evaluate_cycle(CYCLE, tops(), MARKETS, fee=0.0)
        # ETH-EUR bid holds 4 ETH; the cycle produces 2e-4 ETH per EUR in.
        self.assertAlmostEqual(result.max_start_notional, 20_000.0, places=6)

    def test_min_notional_respects_the_strictest_leg(self):
        result = evaluate_cycle(CYCLE, tops(), MARKETS, fee=0.0)
        # ETH-BTC needs 0.0001 BTC and the cycle spends 1e-5 BTC per EUR in.
        self.assertAlmostEqual(result.min_start_notional, 10.0, places=6)
        self.assertTrue(result.feasible)

    def test_infeasible_when_top_of_book_cannot_fill_the_minimum(self):
        result = evaluate_cycle(CYCLE, tops(eth_eur_size=0.0004), MARKETS, fee=0.0)
        self.assertLess(result.max_start_notional, result.min_start_notional)
        self.assertFalse(result.feasible)

    def test_missing_or_empty_book_is_unpriceable(self):
        broken = tops()
        broken["ETH-BTC"] = BookTop("ETH-BTC", None, None, None, None)
        self.assertIsNone(evaluate_cycle(CYCLE, broken, MARKETS, fee=0.0))

        missing = tops()
        del missing["ETH-EUR"]
        self.assertIsNone(evaluate_cycle(CYCLE, missing, MARKETS, fee=0.0))

    def test_profit_at_max_matches_edge_times_size(self):
        result = evaluate_cycle(CYCLE, tops(eth_eur_bid=5100.0), MARKETS, fee=0.0)
        expected = result.max_start_notional * (result.net_ratio - 1.0)
        self.assertAlmostEqual(result.profit_at_max, expected, places=9)
        self.assertGreater(result.profit_at_max, 0.0)


class TestBookWalking(unittest.TestCase):
    def test_buy_consumes_levels_in_order(self):
        asks = [(100.0, 1.0), (110.0, 1.0)]
        # 100 EUR clears the first level exactly.
        self.assertAlmostEqual(walk_buy(asks, 100.0, 0.0, FEE_MODEL_OUTPUT), 1.0, places=12)
        # 210 EUR takes both levels: 1 + 1 units.
        self.assertAlmostEqual(walk_buy(asks, 210.0, 0.0, FEE_MODEL_OUTPUT), 2.0, places=12)

    def test_sell_consumes_levels_in_order(self):
        bids = [(100.0, 1.0), (90.0, 2.0)]
        self.assertAlmostEqual(walk_sell(bids, 1.0, 0.0, FEE_MODEL_OUTPUT), 100.0, places=12)
        self.assertAlmostEqual(walk_sell(bids, 3.0, 0.0, FEE_MODEL_OUTPUT), 280.0, places=12)

    def test_thin_book_returns_none_rather_than_a_partial_fill(self):
        self.assertIsNone(walk_buy([(100.0, 1.0)], 500.0, 0.0, FEE_MODEL_OUTPUT))
        self.assertIsNone(walk_sell([(100.0, 1.0)], 5.0, 0.0, FEE_MODEL_OUTPUT))

    def test_depth_pricing_degrades_as_size_grows(self):
        books = {
            "BTC-EUR": {"asks": [(100_000.0, 0.1), (100_500.0, 10.0)], "bids": []},
            "ETH-BTC": {"asks": [(0.05, 100.0)], "bids": []},
            "ETH-EUR": {"asks": [], "bids": [(5_100.0, 100.0)]},
        }
        small = evaluate_cycle_at_size(CYCLE, books, 1_000.0, 0.0, FEE_MODEL_OUTPUT)
        large = evaluate_cycle_at_size(CYCLE, books, 100_000.0, 0.0, FEE_MODEL_OUTPUT)
        self.assertGreater(small, large)
        self.assertAlmostEqual(small, 200.0, places=6)  # 2% on the untouched top level

    def test_depth_pricing_reports_none_when_a_book_runs_out(self):
        books = {
            "BTC-EUR": {"asks": [(100_000.0, 0.001)], "bids": []},
            "ETH-BTC": {"asks": [(0.05, 100.0)], "bids": []},
            "ETH-EUR": {"asks": [], "bids": [(5_100.0, 100.0)]},
        }
        self.assertIsNone(evaluate_cycle_at_size(CYCLE, books, 1_000_000.0, 0.0, FEE_MODEL_OUTPUT))


if __name__ == "__main__":
    unittest.main()
