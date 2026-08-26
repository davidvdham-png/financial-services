"""Venue registry. Adding an exchange means adding a client here and nothing
else: the graph, pricing, tracking and reporting layers are venue-agnostic.
"""
from __future__ import annotations

from ..types import Venue
from .bitvavo import Bitvavo
from .kraken import Kraken
from .okx import Okx

VENUES: dict[str, type[Venue]] = {
    Bitvavo.name: Bitvavo,
    Kraken.name: Kraken,
    Okx.name: Okx,
}


def build(name: str, **kwargs) -> Venue:
    try:
        venue_class = VENUES[name]
    except KeyError:
        raise SystemExit(
            f"unknown venue {name!r}; available: {', '.join(sorted(VENUES))}"
        ) from None
    return venue_class(**{k: v for k, v in kwargs.items() if v is not None})


__all__ = ["VENUES", "Bitvavo", "Kraken", "Okx", "build"]
