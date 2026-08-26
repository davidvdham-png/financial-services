# crypto-arb-scanner

A read-only scanner that measures whether triangular arbitrage on **Bitvavo**
is worth pursuing — before anyone writes execution code.

This is phase 1 of a longer plan. It does not trade. It has no API key, no
authenticated endpoint, and no order-placement code path, so it cannot place
an order even if it is misconfigured. What it does is watch every triangular
cycle on the venue and record, after fees:

- how often a net-positive cycle appears,
- how long it survives,
- how much size actually fits in it.

Those three numbers decide whether phases 2–5 (paper trading, live execution,
productionising) are worth the effort. Most of the time the honest answer is
no, and finding that out for the price of a week of logging is the point.

> Standalone tooling. Not a Cowork plugin and not part of the marketplace in
> `plugins/`; `scripts/check.py` does not lint it.

## Why triangular, and why one venue

Cross-exchange spot arbitrage needs capital pre-funded on both venues, because
moving coins mid-trade takes minutes to hours and the spread is gone long
before the transfer confirms. That means permanent inventory risk on both
sides, plus two taker fees and a withdrawal fee against a spread that is
rarely wide enough to cover them.

A triangular cycle — `EUR -> BTC -> ETH -> EUR` — stays inside one exchange.
No transfers, no cross-venue inventory. Fees are the only hurdle, which makes
it the cheapest possible test of whether any edge exists at all.

**The catch:** triangular arbitrage needs markets quoted in something other
than EUR. If a venue lists every pair against EUR only, no path can leave EUR
and return through a third asset, and there is nothing to scan. The scanner
reports the cycle count on startup and exits with a clear message when it is
zero — that result is itself a valid answer.

## Requirements

Python 3.11+. No third-party packages.

## Usage

```bash
# What cycles exist on the venue right now?
python3 -m scanner.scan --list-cycles

# Log opportunities for a week. Ctrl-C to stop; state is flushed on exit.
python3 -m scanner.scan --interval 3 --fee 0.0025 --out data/episodes.jsonl

# Also re-price the best candidates against the full order book
python3 -m scanner.scan --depth-check-bps 5 --depth-sizes 100,250,500,1000

# Read the verdict
python3 -m scanner.report data/episodes.jsonl
```

Key options:

| Flag | Default | Meaning |
|---|---|---|
| `--fee` | `0.0025` | Taker fee per leg. Bitvavo's base tier is 0.25%; set your own tier. |
| `--fee-model` | `output` | `output` deducts the fee from what you receive; `quote` charges it in the market's quote currency. |
| `--interval` | `3.0` | Seconds between polls. |
| `--threshold-bps` | `0.0` | Net basis points after fees at which a cycle counts as an opportunity. |
| `--depth-check-bps` | off | Fetch full books and re-price at real size when a candidate exceeds this. |
| `--duration` / `--max-polls` | unlimited | Bounded runs. |

## Reading the output

`scanner.report` prints episodes per day, lifetime percentiles, the net-edge
distribution, and a per-cycle breakdown. Judge it against three bars:

1. **Tradeable.** The exchange minimum order size has to fit at top of book.
   An episode where only €3 of size fit is not an opportunity.
2. **Longer-lived than your round trip.** Three sequential taker orders over a
   consumer connection is comfortably 200–500 ms. An edge with a median
   lifetime under that is not reachable, no matter how large the number looks.
3. **Worth the risk.** Peak profit per episode, summed over the window, has to
   beat what the same capital earns sitting still — with a wide margin for the
   legs that will fill partially or not at all.

If the log shows a handful of sub-second, sub-€50 episodes per day, the answer
is no and you have saved yourself weeks. That is a successful run.

## What this deliberately does not model

- **Latency.** Prices are timestamped on arrival, not on exchange. Recorded
  lifetimes are an upper bound on what you could actually have caught.
- **Poll granularity.** An episode seen in one poll may have lived far less
  than one interval. Lifetimes are floored by `--interval`, so treat short
  medians as "at most this long".
- **Partial fills and rejects.** Every leg is priced as if it fills whole. Real
  execution on leg 2 or 3 leaves you holding inventory you did not want, which
  is the single largest hidden cost of this strategy.
- **Your fee tier.** `--fee` is a flat assumption. Bitvavo's tiers move with
  30-day volume, and maker/taker differ.
- **Fee mechanics at the margin.** The two fee models differ by well under a
  basis point per cycle. Verify against a real fill before trusting either
  when the edge is that thin.

## Rate limits

Bitvavo allows 1000 weight per minute per IP. One poll of `/ticker/book`
costs 25, so a 3-second interval spends ~500/minute and leaves headroom for
depth checks (3 weight each). The client reads the rate-limit headers and
blocks before overspending rather than earning a ban. Below a 2-second
interval it warns.

## Roadmap

| Phase | Status |
|---|---|
| 1. Data + spread measurement | this repo |
| 2. Backtest on your own log | needs 1–2 weeks of phase 1 data |
| 3. Paper trading with slippage and partial fills | not started |
| 4. Live, small capital, kill switch | not started |
| 5. Idempotent orders, crash recovery, reconciliation | not started |

Do not skip phase 2. It is the only phase that can tell you to stop.

## Legal and tax (NL)

Trading your own money on your own account needs no licence. Trading or
managing money for others falls under AFM/MiCA authorisation. Bot access via
the API is permitted within Bitvavo's rate limits. Dutch tax normally treats
this as box 3 wealth, but sufficiently intensive and labour-like trading can
be reclassified as box 1 income, which materially changes returns — worth
checking with a tax adviser before scaling up.

None of this is investment advice.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

32 tests, no network required: the fee and cycle arithmetic, book walking,
episode tracking, and the full scan loop against a stubbed exchange.
