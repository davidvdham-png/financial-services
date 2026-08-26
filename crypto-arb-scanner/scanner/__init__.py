"""Read-only triangular-arbitrage scanner for Bitvavo.

Phase 1 of the plan: measure whether net-positive cycles exist at all, and
how long they live. This package never places orders and never needs an
API key.
"""

__all__ = ["bitvavo", "graph", "pricing", "tracker"]
