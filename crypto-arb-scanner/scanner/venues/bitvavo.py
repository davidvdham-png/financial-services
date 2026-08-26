"""Bitvavo (NL, DNB/MiCA) public market data.

Rate limits: 1000 weight per minute per IP. /markets = 1, /ticker/book for
all markets = 25, /<market>/book = 1. The client reads the remaining budget
from the response headers and blocks before spending past it rather than
earning a ban.
"""
from __future__ import annotations

from typing import Any

from ..http import HttpClient
from ..types import Book, BookTop, Market, Venue, VenueError, to_float

WEIGHT_TICKER_BOOK_ALL = 25


class Bitvavo(Venue):
    name = "bitvavo"
    default_taker_fee = 0.0025
    poll_cost = "25 of 1000 weight/min"

    def __init__(self, base_url: str = "https://api.bitvavo.com/v2", min_remaining: int = 100) -> None:
        self.http = HttpClient(base_url)
        # Stop and wait once the budget drops below this, leaving headroom
        # for anything else sharing the IP.
        self.min_remaining = min_remaining
        self.rate_limit_remaining: int | None = None

    def _track_rate_limit(self, headers: Any) -> None:
        remaining = to_float(headers.get("bitvavo-ratelimit-remaining"))
        reset_at = to_float(headers.get("bitvavo-ratelimit-resetat"))
        if remaining is not None:
            self.rate_limit_remaining = int(remaining)
            if remaining < self.min_remaining + WEIGHT_TICKER_BOOK_ALL and reset_at:
                # resetAt is epoch milliseconds.
                self.http.hold_until = reset_at / 1000.0 + 0.5

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        payload = self.http.get_json(path, params, on_response=self._track_rate_limit)
        if isinstance(payload, dict) and "errorCode" in payload:
            raise VenueError(f"bitvavo {path}: {payload}")
        return payload

    def markets(self) -> list[Market]:
        out: list[Market] = []
        for entry in self._get("/markets"):
            base, quote, name = entry.get("base"), entry.get("quote"), entry.get("market")
            if not (base and quote and name):
                continue
            out.append(
                Market(
                    market=name,
                    base=base,
                    quote=quote,
                    # Bitvavo already calls it "trading"; normalise anyway.
                    status="trading" if entry.get("status") == "trading" else entry.get("status", "unknown"),
                    min_order_in_quote=to_float(entry.get("minOrderInQuoteAsset")) or 0.0,
                    min_order_in_base=to_float(entry.get("minOrderInBaseAsset")) or 0.0,
                )
            )
        return out

    def ticker_book(self) -> dict[str, BookTop]:
        tops: dict[str, BookTop] = {}
        for entry in self._get("/ticker/book"):
            name = entry.get("market")
            if not name:
                continue
            tops[name] = BookTop(
                market=name,
                bid=to_float(entry.get("bid")),
                bid_size=to_float(entry.get("bidSize")),
                ask=to_float(entry.get("ask")),
                ask_size=to_float(entry.get("askSize")),
            )
        return tops

    def book(self, market: str, depth: int = 25) -> Book:
        raw = self._get(f"/{market}/book", {"depth": depth})

        def levels(key: str) -> list[tuple[float, float]]:
            out = []
            for row in raw.get(key, []):
                price, size = to_float(row[0]), to_float(row[1])
                if price and size:
                    out.append((price, size))
            return out

        return {"bids": levels("bids"), "asks": levels("asks")}
