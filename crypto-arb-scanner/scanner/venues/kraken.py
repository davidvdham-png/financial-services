"""Kraken (IE, MiCA) public market data.

Worth scanning because of its quote assets: EUR, USD, USDT, USDC, BTC and
ETH all appear as quote currencies, so the triangular graph is far richer
than on a EUR-only venue.

Rate limits: public endpoints are counter-based and roughly one request per
second, so the client paces itself rather than relying on headers.

Asset naming: Kraken's own symbols are legacy-prefixed (XXBT, ZEUR). The
client normalises to the names everyone else uses, so cycle keys read the
same across venues.
"""
from __future__ import annotations

from typing import Any

from ..http import HttpClient
from ..types import Book, BookTop, Market, Venue, VenueError, to_float

# Kraken's own spelling -> the symbol used everywhere else.
ASSET_ALIASES = {"XBT": "BTC", "XDG": "DOGE"}


def normalise_asset(symbol: str) -> str:
    """Strip Kraken's legacy X/Z class prefix and apply naming aliases.

    The prefix only ever appears on four-character legacy codes (XXBT, ZEUR);
    modern listings are plain (SOL, ADA), so length is the discriminator.
    """
    if len(symbol) == 4 and symbol[0] in ("X", "Z"):
        symbol = symbol[1:]
    return ASSET_ALIASES.get(symbol, symbol)


class Kraken(Venue):
    name = "kraken"
    default_taker_fee = 0.0026
    poll_cost = "1 request"

    def __init__(self, base_url: str = "https://api.kraken.com/0/public") -> None:
        self.http = HttpClient(base_url, min_interval=1.0)
        self.observed_taker_fee: float | None = None
        # Ticker without a pair filter returns everything; if this venue ever
        # stops allowing that, fall back to explicit batches.
        self._all_tickers_supported = True
        self._known_pairs: list[str] = []

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        payload = self.http.get_json(path, params)
        if not isinstance(payload, dict):
            raise VenueError(f"kraken {path}: unexpected payload type {type(payload).__name__}")
        errors = payload.get("error") or []
        if errors:
            raise VenueError(f"kraken {path}: {', '.join(errors)}")
        return payload.get("result") or {}

    def markets(self) -> list[Market]:
        result = self._get("/AssetPairs")
        out: list[Market] = []
        for pair_id, entry in result.items():
            # Dark-pool pairs are suffixed .d and are not ordinary spot books.
            if pair_id.endswith(".d"):
                continue
            wsname = entry.get("wsname")
            if wsname and "/" in wsname:
                base, quote = (normalise_asset(part) for part in wsname.split("/", 1))
            else:
                base = normalise_asset(entry.get("base", ""))
                quote = normalise_asset(entry.get("quote", ""))
            if not base or not quote:
                continue

            if self.observed_taker_fee is None:
                fees = entry.get("fees") or []
                if fees and len(fees[0]) > 1:
                    tier = to_float(fees[0][1])
                    if tier is not None:
                        self.observed_taker_fee = tier / 100.0

            out.append(
                Market(
                    market=pair_id,
                    base=base,
                    quote=quote,
                    status="trading" if entry.get("status") == "online" else entry.get("status", "unknown"),
                    min_order_in_quote=to_float(entry.get("costmin")) or 0.0,
                    min_order_in_base=to_float(entry.get("ordermin")) or 0.0,
                )
            )
        self._known_pairs = [m.market for m in out if m.tradeable]
        return out

    def ticker_book(self) -> dict[str, BookTop]:
        if not self._all_tickers_supported:
            return self._explicit_tickers()
        try:
            return self._parse_tickers(self._get("/Ticker"))
        except VenueError:
            # Distinguish "this venue wants an explicit pair list" from an
            # outage or a throttle. Only a fallback that actually succeeds
            # justifies switching modes permanently; anything else has to
            # surface, or the scanner silently records an empty market.
            if not self._known_pairs:
                raise
            tops = self._explicit_tickers()
            self._all_tickers_supported = False
            return tops

    def _explicit_tickers(self, batch_size: int = 100) -> dict[str, BookTop]:
        tops: dict[str, BookTop] = {}
        for start in range(0, len(self._known_pairs), batch_size):
            batch = self._known_pairs[start : start + batch_size]
            tops.update(self._parse_tickers(self._get("/Ticker", {"pair": ",".join(batch)})))
        return tops

    @staticmethod
    def _parse_tickers(result: dict[str, Any]) -> dict[str, BookTop]:
        tops: dict[str, BookTop] = {}
        for pair_id, entry in result.items():
            ask, bid = entry.get("a") or [], entry.get("b") or []
            # [price, whole lot volume, lot volume] - index 2 is the real size.
            tops[pair_id] = BookTop(
                market=pair_id,
                bid=to_float(bid[0]) if len(bid) > 0 else None,
                bid_size=to_float(bid[2]) if len(bid) > 2 else None,
                ask=to_float(ask[0]) if len(ask) > 0 else None,
                ask_size=to_float(ask[2]) if len(ask) > 2 else None,
            )
        return tops

    def book(self, market: str, depth: int = 25) -> Book:
        result = self._get("/Depth", {"pair": market, "count": depth})
        # Kraken may echo the canonical pair id rather than what we asked for.
        entry = result.get(market) or (next(iter(result.values()), {}) if result else {})

        def levels(key: str) -> list[tuple[float, float]]:
            out = []
            for row in entry.get(key, []):
                price, size = to_float(row[0]), to_float(row[1])
                if price and size:
                    out.append((price, size))
            return out

        return {"bids": levels("bids"), "asks": levels("asks")}
