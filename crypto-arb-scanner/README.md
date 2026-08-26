# crypto-arb-scanner

A read-only scanner that measures whether triangular arbitrage is worth
pursuing on the exchanges a Dutch resident can actually use — **Bitvavo**,
**Kraken** and **OKX** — before anyone writes execution code.

This is phase 1 of a longer plan. It does not trade. It has no API key, no
authenticated endpoint, and no order-placement code path, so it cannot place
an order even if it is misconfigured. What it does is watch every triangular
cycle on each venue and record, after fees:

- how often a net-positive cycle appears,
- how long it survives,
- how much size actually fits in it.

Those three numbers decide whether phases 2–5 (paper trading, live execution,
productionising) are worth the effort. Most of the time the honest answer is
no, and finding that out for the price of a week of logging is the point.

> Standalone tooling. Not a Cowork plugin and not part of the marketplace in
> `plugins/`; `scripts/check.py` does not lint it.

## Why triangular, and why several venues at once

Cross-exchange spot arbitrage needs capital pre-funded on both venues, because
moving coins mid-trade takes minutes to hours and the spread is gone long
before the transfer confirms. That means permanent inventory risk on both
sides, plus two taker fees and a withdrawal fee against a spread that is
rarely wide enough to cover them.

A triangular cycle — `EUR -> BTC -> ETH -> EUR` — stays inside one exchange.
No transfers, no cross-venue inventory. Fees are the only hurdle, which makes
it the cheapest possible test of whether any edge exists at all.

Two venue properties dominate the result, and scanning several at once is what
makes them legible — same arithmetic, same window, different venue:

**Your taker fee is the whole game.** A cycle is three legs, so the break-even
hurdle is roughly three times the per-leg fee:

| Venue | Entry-tier taker | Break-even hurdle |
|---|---|---|
| OKX | ~0.10% | ~30 bps |
| Bitvavo | ~0.25% | ~75 bps |
| Kraken | ~0.26% | ~78 bps |

That is not a marginal difference. It is the difference between "essentially
never happens" and "happens sometimes". Verify the current numbers against
each venue's own fee schedule and your volume tier — `--fee` takes per-venue
overrides for exactly this reason. Kraken publishes its entry tier in the
`AssetPairs` response, and the scanner prints what it saw at startup so you
can check your assumption against the venue.

**Quote-asset coverage decides how many cycles exist at all.** Triangular
arbitrage needs markets quoted in something other than EUR; if a venue lists
every pair against EUR only, no path can leave EUR and return through a third
asset. Bitvavo is EUR-heavy. Kraken and OKX quote in EUR, USD, USDT, USDC, BTC
and ETH, so their graphs are far richer. The scanner reports the cycle count
per venue on startup and says so plainly when a venue yields zero — that
result is itself a valid answer.

## Requirements

Python 3.11+. No third-party packages.

## Usage

```bash
# What cycles exist right now, per venue?
python3 -m scanner.scan --venue bitvavo,kraken,okx --list-cycles

# Log opportunities for a week. Ctrl-C to stop; state is flushed on exit.
python3 -m scanner.scan --venue bitvavo,kraken,okx --out data/episodes.jsonl

# Per-venue fees, and re-pricing of the best candidates against the full book
python3 -m scanner.scan --venue bitvavo,okx \
    --fee bitvavo=0.0025,okx=0.001 \
    --depth-check-bps 5 --depth-sizes 100,250,500,1000

# Read the verdict, with a venue-by-venue comparison
python3 -m scanner.report data/episodes.jsonl
```

Key options:

| Flag | Default | Meaning |
|---|---|---|
| `--venue` | `bitvavo` | Comma-separated: `bitvavo`, `kraken`, `okx`. |
| `--fee` | venue entry tier | A single number for all venues, or `bitvavo=0.0025,okx=0.001`. |
| `--fee-model` | `output` | `output` deducts the fee from what you receive; `quote` charges it in the market's quote currency. |
| `--base` | `EUR` | Asset each cycle starts and ends in. |
| `--interval` | `3.0` | Seconds between polls. |
| `--threshold-bps` | `0.0` | Net bps after fees at which a cycle counts as an opportunity. |
| `--depth-check-bps` | off | Fetch full books and re-price at real size when a candidate exceeds this. |
| `--okx-base-url` | `www.okx.com` | Point at the entity you actually trade on (see below). |
| `--duration` / `--max-polls` | unlimited | Bounded runs. |

A venue that fails a poll does not stop the others; failures are counted per
venue and reported in the run summary.

## Venue notes

- **Bitvavo** — 1000 weight/minute per IP; one poll costs 25. The client reads
  the rate-limit headers and blocks before overspending rather than earning a
  ban.
- **Kraken** — public endpoints are counter-based at roughly one request per
  second, so the client paces itself. Kraken's own asset symbols are legacy-
  prefixed (`XXBT`, `ZEUR`); the client normalises them so cycle keys read the
  same across venues. Dark-pool (`.d`) pairs are skipped.
- **OKX** — `www.okx.com` serves public market data globally, but if you trade
  through the EEA entity its instrument list can differ. Point
  `--okx-base-url` at the host you actually trade on before trusting the
  numbers. OKX publishes a minimum order size in the base asset only.

Regulatory status and fee schedules move. Check the current MiCA registration
and fee page for any venue before opening an account; the numbers here are
orientation, not a source.

## Reading the output

`scanner.report` prints a venue comparison, then per venue: episodes per day,
lifetime percentiles, the net-edge distribution, and a per-cycle breakdown.
Judge it against three bars:

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
- **Your fee tier.** `--fee` is an assumption per venue. Tiers move with
  30-day volume, and maker/taker differ.
- **Fee mechanics at the margin.** The two fee models differ by well under a
  basis point per cycle. Verify against a real fill before trusting either
  when the edge is that thin.
- **Missing minimums.** A venue that publishes no minimum order size yields no
  minimum constraint, so every non-empty book counts as feasible there.

## Adding a venue

`graph.py`, `pricing.py`, `tracker.py` and `report.py` never learn which
exchange they are looking at. A new venue is one file in `scanner/venues/`
implementing `markets()`, `ticker_book()` and `book()` from `scanner/types.py`,
plus one line in the registry. The existing arithmetic tests carry over
unchanged.

## Roadmap

| Phase | Status |
|---|---|
| 1. Data + spread measurement across venues | this repo |
| 2. Backtest on your own log | needs 1–2 weeks of phase 1 data |
| 3. Paper trading with slippage and partial fills | not started |
| 4. Live, small capital, kill switch | not started |
| 5. Idempotent orders, crash recovery, reconciliation | not started |

Do not skip phase 2. It is the only phase that can tell you to stop.

## Legal and tax (NL)

Trading your own money on your own account needs no licence. Trading or
managing money for others falls under AFM/MiCA authorisation. Bot access via
the public API is permitted within each venue's rate limits. Dutch tax normally
treats this as box 3 wealth, but sufficiently intensive and labour-like trading
can be reclassified as box 1 income, which materially changes returns — worth
checking with a tax adviser before scaling up.

None of this is investment advice.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

68 tests, no network required: the fee and cycle arithmetic, book walking,
episode tracking, each venue's response parsing against fixture payloads, and
the full multi-venue scan loop against stubbed exchanges.
