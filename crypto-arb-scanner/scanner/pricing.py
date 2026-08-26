"""Cycle economics: fees, top-of-book returns, and depth-aware returns.

All functions here are pure, so the interesting arithmetic is testable
without touching the network.

Fee model
---------
Exchanges charge a taker fee per fill. Two conventions matter and they
differ by less than a basis point, but the scanner exists to measure
something that *lives* in that range, so both are implemented:

  "output"  fee is deducted from whatever you receive on each leg.
            Slightly conservative on buy legs. This is the default.
  "quote"   fee is charged in the market's quote currency, so a buy costs
            price * (1 + fee) per unit of base.

Verify against a real fill before trusting either at the margin.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .types import BookTop, Market
from .graph import BUY, SELL, Cycle, Leg

FEE_MODEL_OUTPUT = "output"
FEE_MODEL_QUOTE = "quote"


@dataclass
class LegQuote:
    """What one leg looked like at the moment of evaluation."""

    leg: Leg
    price: float
    # Amount entering this leg per 1 unit of the cycle's start asset.
    input_ratio: float
    # Quote-currency notional traded on this leg per 1 unit of start asset.
    quote_ratio: float
    # Base-asset quantity traded on this leg per 1 unit of start asset.
    base_ratio: float
    # Largest input this leg can absorb at top of book, in its from_asset.
    max_input: float


@dataclass
class CycleResult:
    cycle: Cycle
    net_ratio: float
    gross_ratio: float
    max_start_notional: float
    min_start_notional: float
    legs: list[LegQuote] = field(default_factory=list)

    @property
    def net_bps(self) -> float:
        return (self.net_ratio - 1.0) * 10_000.0

    @property
    def gross_bps(self) -> float:
        return (self.gross_ratio - 1.0) * 10_000.0

    @property
    def feasible(self) -> bool:
        """True when the exchange's minimum order size fits at top of book.

        A venue that publishes no minimum yields min_start_notional == 0, in
        which case any non-empty book counts as feasible.
        """
        return self.max_start_notional > 0 and self.max_start_notional >= self.min_start_notional

    @property
    def profit_at_max(self) -> float:
        return self.max_start_notional * (self.net_ratio - 1.0)


def _apply_leg(amount: float, side: str, price: float, fee: float, fee_model: str) -> float:
    """Amount received after trading `amount` of the leg's from_asset."""
    if side == BUY:
        if fee_model == FEE_MODEL_QUOTE:
            return amount / (price * (1.0 + fee))
        return (amount / price) * (1.0 - fee)
    return amount * price * (1.0 - fee)


def evaluate_cycle(
    cycle: Cycle,
    tops: dict[str, BookTop],
    markets: dict[str, Market],
    fee: float,
    fee_model: str = FEE_MODEL_OUTPUT,
) -> CycleResult | None:
    """Return the top-of-book economics of one cycle, or None if unpriceable."""
    amount = 1.0
    gross = 1.0
    leg_quotes: list[LegQuote] = []

    for leg in cycle.legs:
        top = tops.get(leg.market)
        if top is None or not top.complete:
            return None
        if leg.side == BUY:
            price, size = top.ask, top.ask_size
            if not price or price <= 0 or not size or size <= 0:
                return None
            # ask_size is in base; the most quote this leg can absorb.
            max_input = size * price
            quote_ratio = amount
            base_ratio = amount / price
        else:
            price, size = top.bid, top.bid_size
            if not price or price <= 0 or not size or size <= 0:
                return None
            max_input = size
            quote_ratio = amount * price
            base_ratio = amount

        leg_quotes.append(
            LegQuote(
                leg=leg,
                price=price,
                input_ratio=amount,
                quote_ratio=quote_ratio,
                base_ratio=base_ratio,
                max_input=max_input,
            )
        )
        amount = _apply_leg(amount, leg.side, price, fee, fee_model)
        gross = _apply_leg(gross, leg.side, price, 0.0, fee_model)

    # Constraints expressed in the start asset.
    max_start = min(lq.max_input / lq.input_ratio for lq in leg_quotes)
    # Venues publish a minimum in the quote asset, the base asset, or both.
    min_start = 0.0
    for lq in leg_quotes:
        market = markets.get(lq.leg.market)
        if not market:
            continue
        if market.min_order_in_quote > 0 and lq.quote_ratio > 0:
            min_start = max(min_start, market.min_order_in_quote / lq.quote_ratio)
        if market.min_order_in_base > 0 and lq.base_ratio > 0:
            min_start = max(min_start, market.min_order_in_base / lq.base_ratio)

    return CycleResult(
        cycle=cycle,
        net_ratio=amount,
        gross_ratio=gross,
        max_start_notional=max_start,
        min_start_notional=min_start,
        legs=leg_quotes,
    )


# -- depth-aware evaluation -------------------------------------------------


def walk_buy(asks: list[tuple[float, float]], quote_amount: float, fee: float, fee_model: str) -> float | None:
    """Base received for spending `quote_amount` against the ask side."""
    remaining = quote_amount
    received = 0.0
    for price, size in asks:
        level_quote = price * size
        take = min(remaining, level_quote)
        received += _apply_leg(take, BUY, price, fee, fee_model)
        remaining -= take
        if remaining <= 1e-12:
            return received
    return None  # book too thin for this size


def walk_sell(bids: list[tuple[float, float]], base_amount: float, fee: float, fee_model: str) -> float | None:
    """Quote received for selling `base_amount` into the bid side."""
    remaining = base_amount
    received = 0.0
    for price, size in bids:
        take = min(remaining, size)
        received += _apply_leg(take, SELL, price, fee, fee_model)
        remaining -= take
        if remaining <= 1e-12:
            return received
    return None


def evaluate_cycle_at_size(
    cycle: Cycle,
    books: dict[str, dict[str, list[tuple[float, float]]]],
    notional: float,
    fee: float,
    fee_model: str = FEE_MODEL_OUTPUT,
) -> float | None:
    """Net basis points for executing `notional` of the start asset through
    the full order books, walking each level. None if any book runs out."""
    amount = notional
    for leg in cycle.legs:
        book = books.get(leg.market)
        if not book:
            return None
        if leg.side == BUY:
            amount = walk_buy(book.get("asks", []), amount, fee, fee_model)
        else:
            amount = walk_sell(book.get("bids", []), amount, fee, fee_model)
        if amount is None:
            return None
    return (amount / notional - 1.0) * 10_000.0
