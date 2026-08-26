"""Read-only triangular-arbitrage scanner for MiCA-accessible exchanges.

Phase 1 of the plan: measure whether net-positive cycles exist at all, how
long they live, and how much size fits — across several venues at once, so
fee and quote-coverage differences show up in the same window.

Nothing here authenticates or places orders.
"""

__all__ = ["graph", "http", "pricing", "tracker", "types", "venues"]
