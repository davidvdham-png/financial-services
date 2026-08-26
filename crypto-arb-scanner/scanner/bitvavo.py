"""Minimal, dependency-free Bitvavo public REST client.

Only the three public endpoints the scanner needs. No authentication: every
call here is public market data, so the scanner runs without API keys and
cannot place an order even by accident.

Rate limits: Bitvavo allows 1000 weight per minute per IP. Weights used here
are /markets = 1, /ticker/book (all markets) = 25, /<market>/book = 1. The
client reads the remaining budget from the response headers and blocks
before spending past it rather than eating a 429 ban.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

BASE_URL = "https://api.bitvavo.com/v2"
USER_AGENT = "crypto-arb-scanner/0.1 (read-only market-data scanner)"

# Endpoint weights, per Bitvavo's published rate-limit table.
WEIGHT_MARKETS = 1
WEIGHT_TICKER_BOOK_ALL = 25
WEIGHT_BOOK_SINGLE = 1


class BitvavoError(RuntimeError):
    pass


@dataclass
class Market:
    """One tradeable pair, e.g. BTC-EUR."""

    market: str
    base: str
    quote: str
    status: str
    min_order_in_quote: float
    min_order_in_base: float

    @property
    def tradeable(self) -> bool:
        return self.status == "trading"


@dataclass
class BookTop:
    """Top of book for one market. Sizes are in the base asset."""

    market: str
    bid: float | None
    bid_size: float | None
    ask: float | None
    ask_size: float | None

    @property
    def complete(self) -> bool:
        return None not in (self.bid, self.bid_size, self.ask, self.ask_size)


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class BitvavoPublicClient:
    """Public-endpoint client with retry, backoff and rate-limit accounting."""

    def __init__(
        self,
        base_url: str = BASE_URL,
        timeout: float = 10.0,
        max_retries: int = 4,
        min_remaining: int = 100,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        # Stop and wait once the budget drops below this, leaving headroom for
        # whatever else shares the IP.
        self.min_remaining = min_remaining
        self.rate_limit_remaining: int | None = None
        self.rate_limit_reset_at: float | None = None  # unix seconds

    # -- internals ---------------------------------------------------------

    def _respect_rate_limit(self, weight: int) -> None:
        if self.rate_limit_remaining is None:
            return
        if self.rate_limit_remaining - weight >= self.min_remaining:
            return
        if self.rate_limit_reset_at is None:
            time.sleep(1.0)
            return
        wait = self.rate_limit_reset_at - time.time()
        if wait > 0:
            time.sleep(min(wait + 0.5, 60.0))
        self.rate_limit_remaining = None

    def _record_headers(self, headers: Any) -> None:
        remaining = headers.get("bitvavo-ratelimit-remaining")
        reset_at = headers.get("bitvavo-ratelimit-resetat")
        if remaining is not None:
            try:
                self.rate_limit_remaining = int(remaining)
            except ValueError:
                pass
        if reset_at is not None:
            try:
                # Bitvavo reports the reset moment in epoch milliseconds.
                self.rate_limit_reset_at = int(reset_at) / 1000.0
            except ValueError:
                pass

    def _get(self, path: str, weight: int) -> Any:
        self._respect_rate_limit(weight)
        url = f"{self.base_url}{path}"
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    self._record_headers(response.headers)
                    payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict) and "errorCode" in payload:
                    raise BitvavoError(f"{path}: {payload}")
                return payload
            except urllib.error.HTTPError as exc:
                self._record_headers(exc.headers)
                if exc.code == 429:
                    # Banned or throttled: back off hard, the reset header knows best.
                    wait = 5.0
                    if self.rate_limit_reset_at:
                        wait = max(wait, self.rate_limit_reset_at - time.time() + 0.5)
                    time.sleep(min(wait, 60.0))
                    last_error = exc
                    continue
                if 500 <= exc.code < 600:
                    last_error = exc
                    time.sleep(2.0**attempt)
                    continue
                raise BitvavoError(f"{path}: HTTP {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                time.sleep(2.0**attempt)

        raise BitvavoError(f"{path}: failed after {self.max_retries} attempts: {last_error}")

    # -- endpoints ---------------------------------------------------------

    def markets(self) -> list[Market]:
        raw = self._get("/markets", WEIGHT_MARKETS)
        out: list[Market] = []
        for entry in raw:
            base, quote = entry.get("base"), entry.get("quote")
            name = entry.get("market")
            if not (base and quote and name):
                continue
            out.append(
                Market(
                    market=name,
                    base=base,
                    quote=quote,
                    status=entry.get("status", "unknown"),
                    min_order_in_quote=_to_float(entry.get("minOrderInQuoteAsset")) or 0.0,
                    min_order_in_base=_to_float(entry.get("minOrderInBaseAsset")) or 0.0,
                )
            )
        return out

    def ticker_book(self) -> dict[str, BookTop]:
        """Best bid/ask for every market in a single request."""
        raw = self._get("/ticker/book", WEIGHT_TICKER_BOOK_ALL)
        tops: dict[str, BookTop] = {}
        for entry in raw:
            name = entry.get("market")
            if not name:
                continue
            tops[name] = BookTop(
                market=name,
                bid=_to_float(entry.get("bid")),
                bid_size=_to_float(entry.get("bidSize")),
                ask=_to_float(entry.get("ask")),
                ask_size=_to_float(entry.get("askSize")),
            )
        return tops

    def book(self, market: str, depth: int = 25) -> dict[str, list[tuple[float, float]]]:
        """Full order book for one market, as sorted (price, size) levels."""
        raw = self._get(f"/{market}/book?depth={depth}", WEIGHT_BOOK_SINGLE)

        def levels(key: str) -> list[tuple[float, float]]:
            out = []
            for row in raw.get(key, []):
                price, size = _to_float(row[0]), _to_float(row[1])
                if price and size:
                    out.append((price, size))
            return out

        return {"bids": levels("bids"), "asks": levels("asks")}
