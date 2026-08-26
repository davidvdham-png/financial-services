"""OKX (MT, MiCA via OKX Europe) public market data.

The reason to scan it: entry-tier spot taker fee is around 0.10% against
0.25-0.26% on Bitvavo and Kraken. A cycle is three legs, so that is a
break-even hurdle near 30 bps instead of 75 - the single largest lever on
whether triangular arbitrage clears at all.

Endpoint note: `www.okx.com` serves public market data globally. If you
trade through the EEA entity, its instrument list can differ from the global
one, so point --okx-base-url at the host you actually trade on before
trusting the numbers.
"""
from __future__ import annotations

from typing import Any

from ..http import HttpClient
from ..types import Book, BookTop, Market, Venue, VenueError, to_float

MAX_BOOK_DEPTH = 400


class Okx(Venue):
    name = "okx"
    default_taker_fee = 0.0010
    poll_cost = "1 request"

    def __init__(self, base_url: str = "https://www.okx.com/api/v5") -> None:
        self.http = HttpClient(base_url, min_interval=0.15)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> list[dict]:
        payload = self.http.get_json(path, params)
        if not isinstance(payload, dict):
            raise VenueError(f"okx {path}: unexpected payload type {type(payload).__name__}")
        if payload.get("code") not in ("0", 0, None):
            raise VenueError(f"okx {path}: code {payload.get('code')}: {payload.get('msg')}")
        return payload.get("data") or []

    def markets(self) -> list[Market]:
        out: list[Market] = []
        for entry in self._get("/public/instruments", {"instType": "SPOT"}):
            base, quote = entry.get("baseCcy"), entry.get("quoteCcy")
            name = entry.get("instId")
            if not (base and quote and name):
                continue
            out.append(
                Market(
                    market=name,
                    base=base,
                    quote=quote,
                    status="trading" if entry.get("state") == "live" else entry.get("state", "unknown"),
                    # OKX publishes a minimum in the base asset only.
                    min_order_in_quote=0.0,
                    min_order_in_base=to_float(entry.get("minSz")) or 0.0,
                )
            )
        return out

    def ticker_book(self) -> dict[str, BookTop]:
        tops: dict[str, BookTop] = {}
        for entry in self._get("/market/tickers", {"instType": "SPOT"}):
            name = entry.get("instId")
            if not name:
                continue
            tops[name] = BookTop(
                market=name,
                bid=to_float(entry.get("bidPx")),
                bid_size=to_float(entry.get("bidSz")),
                ask=to_float(entry.get("askPx")),
                ask_size=to_float(entry.get("askSz")),
            )
        return tops

    def book(self, market: str, depth: int = 25) -> Book:
        data = self._get(
            "/market/books", {"instId": market, "sz": min(depth, MAX_BOOK_DEPTH)}
        )
        entry = data[0] if data else {}

        def levels(key: str) -> list[tuple[float, float]]:
            out = []
            for row in entry.get(key, []):
                price, size = to_float(row[0]), to_float(row[1])
                if price and size:
                    out.append((price, size))
            return out

        return {"bids": levels("bids"), "asks": levels("asks")}
