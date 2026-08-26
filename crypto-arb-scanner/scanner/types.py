"""Venue-agnostic types shared by every exchange client.

The scanner's arithmetic never learns which exchange it is looking at: a
venue client's only job is to translate that exchange's API into these
shapes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class VenueError(RuntimeError):
    """Any failure talking to an exchange, wrapped per venue."""


@dataclass
class Market:
    """One tradeable pair.

    `market` is the venue's own identifier and is passed back to the venue
    verbatim. `base` and `quote` are normalised asset symbols used to build
    the trading graph, so BTC is BTC even on a venue that calls it XBT.
    """

    market: str
    base: str
    quote: str
    status: str
    min_order_in_quote: float  # 0.0 when the venue does not publish one
    min_order_in_base: float  # 0.0 when the venue does not publish one

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


Book = dict[str, list[tuple[float, float]]]  # {"bids": [(price, size)], "asks": [...]}


class Venue(ABC):
    """Read-only market data for one exchange.

    Deliberately narrow: three public endpoints, no authentication, no order
    placement. A venue client that cannot place an order is a venue client
    that cannot place an order by accident.
    """

    name: str = "unknown"
    # Taker fee per leg at the venue's entry volume tier. A cycle is three
    # legs, so the break-even hurdle is roughly three times this.
    default_taker_fee: float = 0.0025
    # Weight/requests one full top-of-book poll costs, for the status line.
    poll_cost: str = "1 request"

    @abstractmethod
    def markets(self) -> list[Market]:
        """Every pair the venue lists, tradeable or not."""

    @abstractmethod
    def ticker_book(self) -> dict[str, BookTop]:
        """Best bid/ask for every market, keyed by the venue's market id."""

    @abstractmethod
    def book(self, market: str, depth: int = 25) -> Book:
        """Full order book for one market, as sorted (price, size) levels."""


def to_float(value: object) -> float | None:
    """Exchange APIs return numbers as strings, inconsistently and sometimes
    empty. One tolerant parser beats a try/except at every call site."""
    if value is None or value == "":
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
