"""Venue clients: translating each exchange's payload into shared types.

The response shapes below mirror what each API actually returns, including
the awkward parts — Kraken's legacy asset prefixes and three-element ticker
arrays, OKX's envelope and base-only minimums, Bitvavo's null books. This is
where a venue integration breaks, so it is where the fixtures live.
"""
import unittest
from unittest import mock

from scanner.types import VenueError
from scanner.venues import VENUES, build
from scanner.venues.bitvavo import Bitvavo
from scanner.venues.kraken import Kraken, normalise_asset
from scanner.venues.okx import Okx


def stub(venue, responses):
    """Replace the venue's HTTP layer with a path -> payload lookup."""

    def get_json(path, params=None, on_response=None):
        if path not in responses:
            raise AssertionError(f"unexpected request: {path}")
        payload = responses[path]
        return payload(params) if callable(payload) else payload

    return mock.patch.object(venue.http, "get_json", side_effect=get_json)


class TestRegistry(unittest.TestCase):
    def test_all_three_venues_are_registered(self):
        self.assertEqual(sorted(VENUES), ["bitvavo", "kraken", "okx"])

    def test_unknown_venue_exits_with_a_useful_message(self):
        with self.assertRaises(SystemExit) as ctx:
            build("binance")
        self.assertIn("bitvavo, kraken, okx", str(ctx.exception))

    def test_none_kwargs_are_dropped_so_defaults_apply(self):
        venue = build("okx", base_url=None)
        self.assertTrue(venue.http.base_url.endswith("/api/v5"))

    def test_okx_base_url_can_be_overridden(self):
        venue = build("okx", base_url="https://my.okx.com/api/v5")
        self.assertEqual(venue.http.base_url, "https://my.okx.com/api/v5")

    def test_fee_tiers_differ_as_documented(self):
        self.assertGreater(Bitvavo.default_taker_fee, Okx.default_taker_fee)
        self.assertAlmostEqual(Okx.default_taker_fee, 0.0010)


class TestBitvavo(unittest.TestCase):
    def setUp(self):
        self.venue = Bitvavo()

    def test_markets_are_parsed(self):
        payload = [
            {"market": "BTC-EUR", "base": "BTC", "quote": "EUR", "status": "trading",
             "minOrderInQuoteAsset": "5", "minOrderInBaseAsset": "0.0001"},
            {"market": "GONE-EUR", "base": "GONE", "quote": "EUR", "status": "halted",
             "minOrderInQuoteAsset": "5", "minOrderInBaseAsset": "1"},
            {"status": "trading"},  # malformed, must be skipped
        ]
        with stub(self.venue, {"/markets": payload}):
            markets = self.venue.markets()
        self.assertEqual([m.market for m in markets], ["BTC-EUR", "GONE-EUR"])
        self.assertTrue(markets[0].tradeable)
        self.assertFalse(markets[1].tradeable)
        self.assertEqual(markets[0].min_order_in_quote, 5.0)

    def test_ticker_handles_empty_books(self):
        payload = [
            {"market": "BTC-EUR", "bid": "99990", "bidSize": "1.5", "ask": "100000", "askSize": "2"},
            {"market": "THIN-EUR", "bid": None, "ask": None},
        ]
        with stub(self.venue, {"/ticker/book": payload}):
            tops = self.venue.ticker_book()
        self.assertTrue(tops["BTC-EUR"].complete)
        self.assertFalse(tops["THIN-EUR"].complete)
        self.assertEqual(tops["BTC-EUR"].ask_size, 2.0)

    def test_error_envelope_raises(self):
        with stub(self.venue, {"/markets": {"errorCode": 105, "error": "rate limited"}}):
            with self.assertRaises(VenueError):
                self.venue.markets()

    def test_rate_limit_header_sets_a_hold(self):
        self.venue._track_rate_limit({"bitvavo-ratelimit-remaining": "20",
                                      "bitvavo-ratelimit-resetat": "1700000000000"})
        self.assertEqual(self.venue.rate_limit_remaining, 20)
        self.assertAlmostEqual(self.venue.http.hold_until, 1700000000.5)

    def test_ample_budget_sets_no_hold(self):
        self.venue._track_rate_limit({"bitvavo-ratelimit-remaining": "900",
                                      "bitvavo-ratelimit-resetat": "1700000000000"})
        self.assertEqual(self.venue.http.hold_until, 0.0)


class TestKrakenAssetNaming(unittest.TestCase):
    def test_legacy_prefixes_are_stripped(self):
        self.assertEqual(normalise_asset("ZEUR"), "EUR")
        self.assertEqual(normalise_asset("XETH"), "ETH")

    def test_xbt_becomes_btc(self):
        self.assertEqual(normalise_asset("XXBT"), "BTC")
        self.assertEqual(normalise_asset("XBT"), "BTC")

    def test_modern_short_symbols_are_untouched(self):
        for symbol in ("SOL", "ADA", "EUR", "USDT", "USDC"):
            self.assertEqual(normalise_asset(symbol), symbol)


class TestKraken(unittest.TestCase):
    ASSET_PAIRS = {
        "error": [],
        "result": {
            "XXBTZEUR": {"wsname": "XBT/EUR", "base": "XXBT", "quote": "ZEUR",
                         "status": "online", "ordermin": "0.0001", "costmin": "0.5",
                         "fees": [[0, 0.26], [50000, 0.24]]},
            "XETHXXBT": {"wsname": "ETH/XBT", "base": "XETH", "quote": "XXBT",
                         "status": "online", "ordermin": "0.01", "costmin": "0.00005",
                         "fees": [[0, 0.26]]},
            "XETHZEUR": {"wsname": "ETH/EUR", "base": "XETH", "quote": "ZEUR",
                         "status": "online", "ordermin": "0.01", "costmin": "0.5",
                         "fees": [[0, 0.26]]},
            "XXBTZEUR.d": {"wsname": "XBT/EUR.d", "base": "XXBT", "quote": "ZEUR",
                           "status": "online", "ordermin": "0.0001", "costmin": "0.5"},
            "PAUSEDEUR": {"wsname": "PAUSED/EUR", "base": "PAUSED", "quote": "ZEUR",
                          "status": "cancel_only", "ordermin": "1", "costmin": "0.5"},
        },
    }

    def setUp(self):
        self.venue = Kraken()

    def test_markets_normalise_assets_and_skip_dark_pools(self):
        with stub(self.venue, {"/AssetPairs": self.ASSET_PAIRS}):
            markets = self.venue.markets()
        by_id = {m.market: m for m in markets}
        self.assertNotIn("XXBTZEUR.d", by_id)
        self.assertEqual((by_id["XXBTZEUR"].base, by_id["XXBTZEUR"].quote), ("BTC", "EUR"))
        self.assertEqual((by_id["XETHXXBT"].base, by_id["XETHXXBT"].quote), ("ETH", "BTC"))

    def test_only_online_pairs_are_tradeable(self):
        with stub(self.venue, {"/AssetPairs": self.ASSET_PAIRS}):
            markets = self.venue.markets()
        by_id = {m.market: m for m in markets}
        self.assertTrue(by_id["XXBTZEUR"].tradeable)
        self.assertFalse(by_id["PAUSEDEUR"].tradeable)

    def test_both_minimums_are_captured(self):
        with stub(self.venue, {"/AssetPairs": self.ASSET_PAIRS}):
            market = next(m for m in self.venue.markets() if m.market == "XXBTZEUR")
        self.assertEqual(market.min_order_in_base, 0.0001)
        self.assertEqual(market.min_order_in_quote, 0.5)

    def test_entry_tier_fee_is_read_from_the_venue(self):
        with stub(self.venue, {"/AssetPairs": self.ASSET_PAIRS}):
            self.venue.markets()
        self.assertAlmostEqual(self.venue.observed_taker_fee, 0.0026)

    def test_ticker_uses_lot_volume_not_whole_lot_volume(self):
        ticker = {"error": [], "result": {
            "XXBTZEUR": {"a": ["100000.0", "1", "1.234"], "b": ["99990.0", "2", "2.500"]},
        }}
        with stub(self.venue, {"/Ticker": ticker}):
            tops = self.venue.ticker_book()
        top = tops["XXBTZEUR"]
        self.assertEqual((top.ask, top.ask_size), (100_000.0, 1.234))
        self.assertEqual((top.bid, top.bid_size), (99_990.0, 2.5))

    def test_error_array_raises(self):
        with stub(self.venue, {"/Ticker": {"error": ["EGeneral:Invalid arguments"]}}):
            with self.assertRaises(VenueError) as ctx:
                self.venue.ticker_book()
        self.assertIn("EGeneral", str(ctx.exception))

    def test_ticker_falls_back_to_explicit_pairs_when_the_bulk_call_fails(self):
        self.venue._known_pairs = ["XXBTZEUR"]
        calls = []

        def get_json(path, params=None, on_response=None):
            calls.append((path, params))
            if params is None:
                return {"error": ["EGeneral:Invalid arguments"]}
            return {"error": [], "result": {
                "XXBTZEUR": {"a": ["100000.0", "1", "1.0"], "b": ["99990.0", "1", "1.0"]}}}

        with mock.patch.object(self.venue.http, "get_json", side_effect=get_json):
            tops = self.venue.ticker_book()
        self.assertIn("XXBTZEUR", tops)
        self.assertFalse(self.venue._all_tickers_supported)
        self.assertEqual(calls[1][1], {"pair": "XXBTZEUR"})

    def test_depth_accepts_a_canonical_key_we_did_not_ask_for(self):
        depth = {"error": [], "result": {
            "XXBTZEUR": {"asks": [["100000.0", "1.0", 1700000000]],
                         "bids": [["99990.0", "2.0", 1700000000]]}}}
        with stub(self.venue, {"/Depth": depth}):
            book = self.venue.book("XBTEUR")
        self.assertEqual(book["asks"], [(100_000.0, 1.0)])
        self.assertEqual(book["bids"], [(99_990.0, 2.0)])


class TestOkx(unittest.TestCase):
    def setUp(self):
        self.venue = Okx()

    def test_instruments_are_parsed_with_base_only_minimums(self):
        payload = {"code": "0", "msg": "", "data": [
            {"instId": "BTC-EUR", "baseCcy": "BTC", "quoteCcy": "EUR",
             "state": "live", "minSz": "0.0001"},
            {"instId": "OLD-USDT", "baseCcy": "OLD", "quoteCcy": "USDT",
             "state": "suspend", "minSz": "1"},
        ]}
        with stub(self.venue, {"/public/instruments": payload}):
            markets = self.venue.markets()
        self.assertTrue(markets[0].tradeable)
        self.assertFalse(markets[1].tradeable)
        self.assertEqual(markets[0].min_order_in_base, 0.0001)
        self.assertEqual(markets[0].min_order_in_quote, 0.0)

    def test_tickers_are_parsed(self):
        payload = {"code": "0", "data": [
            {"instId": "BTC-USDT", "bidPx": "99990", "bidSz": "1.5",
             "askPx": "100000", "askSz": "2.5"}]}
        with stub(self.venue, {"/market/tickers": payload}):
            tops = self.venue.ticker_book()
        self.assertTrue(tops["BTC-USDT"].complete)
        self.assertEqual(tops["BTC-USDT"].bid_size, 1.5)

    def test_non_zero_code_raises_with_the_message(self):
        with stub(self.venue, {"/market/tickers": {"code": "50011", "msg": "Too many requests"}}):
            with self.assertRaises(VenueError) as ctx:
                self.venue.ticker_book()
        self.assertIn("Too many requests", str(ctx.exception))

    def test_book_levels_ignore_the_trailing_order_counts(self):
        payload = {"code": "0", "data": [{
            "asks": [["100000", "1.0", "0", "3"]],
            "bids": [["99990", "2.0", "0", "5"]],
            "ts": "1700000000000"}]}
        with stub(self.venue, {"/market/books": payload}):
            book = self.venue.book("BTC-USDT", depth=50)
        self.assertEqual(book["asks"], [(100_000.0, 1.0)])
        self.assertEqual(book["bids"], [(99_990.0, 2.0)])

    def test_book_depth_is_capped_at_the_api_maximum(self):
        seen = {}

        def get_json(path, params=None, on_response=None):
            seen.update(params or {})
            return {"code": "0", "data": [{"asks": [], "bids": []}]}

        with mock.patch.object(self.venue.http, "get_json", side_effect=get_json):
            self.venue.book("BTC-USDT", depth=5_000)
        self.assertEqual(seen["sz"], 400)

    def test_empty_data_yields_an_empty_book(self):
        with stub(self.venue, {"/market/books": {"code": "0", "data": []}}):
            self.assertEqual(self.venue.book("BTC-USDT"), {"bids": [], "asks": []})


if __name__ == "__main__":
    unittest.main()
