"""Build the trading graph and enumerate triangular cycles.

A market BASE-QUOTE gives two directed edges:
    QUOTE -> BASE   by buying  BASE at the ask
    BASE  -> QUOTE  by selling BASE at the bid

A cycle is three such edges returning to the asset you started from, e.g.
EUR -> BTC -> ETH -> EUR. Cycles that need no transfers between venues are
the only kind worth scanning first: everything happens inside one exchange,
so the only hurdle is fees.
"""
from __future__ import annotations

from dataclasses import dataclass

from .types import Market

BUY = "buy"
SELL = "sell"


@dataclass(frozen=True)
class Leg:
    """One directed hop: spend from_asset, receive to_asset."""

    market: str
    side: str  # BUY (pay quote, get base) or SELL (pay base, get quote)
    from_asset: str
    to_asset: str

    def __str__(self) -> str:
        return f"{self.side} {self.market}"


@dataclass(frozen=True)
class Cycle:
    legs: tuple[Leg, ...]

    @property
    def start_asset(self) -> str:
        return self.legs[0].from_asset

    @property
    def path(self) -> tuple[str, ...]:
        return (self.start_asset,) + tuple(leg.to_asset for leg in self.legs)

    @property
    def key(self) -> str:
        return ">".join(self.path)

    def __str__(self) -> str:
        return self.key


def build_edges(markets: list[Market]) -> dict[str, list[Leg]]:
    """Map each asset to the legs that spend it."""
    edges: dict[str, list[Leg]] = {}
    for market in markets:
        if not market.tradeable:
            continue
        edges.setdefault(market.quote, []).append(
            Leg(market.market, BUY, market.quote, market.base)
        )
        edges.setdefault(market.base, []).append(
            Leg(market.market, SELL, market.base, market.quote)
        )
    return edges


def find_cycles(markets: list[Market], start_asset: str = "EUR", length: int = 3) -> list[Cycle]:
    """All simple cycles of the given length starting and ending at start_asset.

    Each cycle is returned once per direction, since a triangle is profitable
    in at most one of its two directions and we do not know which up front.
    """
    edges = build_edges(markets)
    if start_asset not in edges:
        return []

    cycles: list[Cycle] = []
    seen: set[tuple[str, ...]] = set()

    def walk(asset: str, path: list[Leg], visited: set[str]) -> None:
        if len(path) == length:
            if asset == start_asset:
                fingerprint = tuple(f"{leg.side}:{leg.market}" for leg in path)
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    cycles.append(Cycle(tuple(path)))
            return
        for leg in edges.get(asset, []):
            # Only the final hop may return to the start; no asset repeats.
            if leg.to_asset == start_asset and len(path) != length - 1:
                continue
            if leg.to_asset != start_asset and leg.to_asset in visited:
                continue
            if leg.market in {p.market for p in path}:
                continue
            walk(leg.to_asset, path + [leg], visited | {leg.to_asset})

    walk(start_asset, [], {start_asset})
    return cycles


def markets_in_cycles(cycles: list[Cycle]) -> set[str]:
    return {leg.market for cycle in cycles for leg in cycle.legs}
