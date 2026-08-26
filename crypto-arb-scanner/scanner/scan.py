"""Live triangular-arbitrage scanner. Read-only: it never places an order.

Usage:
    python3 -m scanner.scan --list-cycles
    python3 -m scanner.scan --interval 3 --fee 0.0025 --out data/episodes.jsonl

Rate budget: one poll costs 25 weight of the 1000/minute allowance, so a
3-second interval spends ~500/minute and leaves room for depth checks.
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from datetime import datetime, timezone

from .bitvavo import BitvavoError, BitvavoPublicClient, Market
from .graph import Cycle, find_cycles
from .pricing import (
    FEE_MODEL_OUTPUT,
    FEE_MODEL_QUOTE,
    CycleResult,
    evaluate_cycle,
    evaluate_cycle_at_size,
)
from .tracker import EpisodeTracker, open_sink

_stop = False


def _handle_sigint(_signum, _frame) -> None:
    global _stop
    _stop = True
    print("\nStopping after this poll...", file=sys.stderr)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="scanner.scan",
        description="Read-only triangular arbitrage scanner for Bitvavo.",
    )
    parser.add_argument("--base", default="EUR", help="asset each cycle starts and ends in")
    parser.add_argument(
        "--fee",
        type=float,
        default=0.0025,
        help="taker fee per leg as a fraction (0.0025 = 0.25%%, Bitvavo's base tier)",
    )
    parser.add_argument(
        "--fee-model",
        choices=[FEE_MODEL_OUTPUT, FEE_MODEL_QUOTE],
        default=FEE_MODEL_OUTPUT,
        help="how the taker fee is charged; see scanner/pricing.py",
    )
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between polls")
    parser.add_argument(
        "--threshold-bps",
        type=float,
        default=0.0,
        help="net basis points after fees at which a cycle counts as an opportunity",
    )
    parser.add_argument("--out", default="data/episodes.jsonl", help="JSONL output path")
    parser.add_argument(
        "--duration", type=float, default=0.0, help="stop after N seconds (0 = run until Ctrl-C)"
    )
    parser.add_argument(
        "--depth-check-bps",
        type=float,
        default=None,
        help="fetch full order books and re-price at real size when a cycle "
        "exceeds this many net bps (costs 3 extra weight per check)",
    )
    parser.add_argument(
        "--depth-sizes",
        default="100,250,500,1000",
        help="comma-separated notionals in the base asset for depth checks",
    )
    parser.add_argument("--status-every", type=int, default=1, help="print a status line every N polls")
    parser.add_argument(
        "--max-polls", type=int, default=0, help="stop after N polls (0 = unlimited)"
    )
    parser.add_argument("--list-cycles", action="store_true", help="enumerate cycles and exit")
    return parser.parse_args(argv)


def discover(client: BitvavoPublicClient, base: str) -> tuple[dict[str, Market], list[Cycle]]:
    markets = client.markets()
    tradeable = [m for m in markets if m.tradeable]
    quotes = sorted({m.quote for m in tradeable})
    cycles = find_cycles(tradeable, start_asset=base)

    print(f"markets: {len(tradeable)} tradeable of {len(markets)}")
    print(f"quote assets: {', '.join(quotes)}")
    print(f"triangular cycles through {base}: {len(cycles)}")
    if not cycles:
        print(
            f"\nNo cycles found. Triangular arbitrage needs markets quoted in "
            f"something other than {base} (e.g. BTC-quoted or USDC-quoted pairs) "
            f"so a path can leave {base} and come back through a third asset. "
            f"If every market here is {base}-quoted, this strategy has nothing "
            f"to work with on this venue.",
            file=sys.stderr,
        )
    return {m.market: m for m in tradeable}, cycles


def depth_check(
    client: BitvavoPublicClient,
    result: CycleResult,
    sizes: list[float],
    fee: float,
    fee_model: str,
) -> dict:
    books = {}
    for leg in result.cycle.legs:
        books[leg.market] = client.book(leg.market, depth=50)
    priced = {}
    for size in sizes:
        bps = evaluate_cycle_at_size(result.cycle, books, size, fee, fee_model)
        priced[str(size)] = None if bps is None else round(bps, 4)
    return {
        "type": "depth_check",
        "ts": time.time(),
        "cycle": result.cycle.key,
        "legs": [str(leg) for leg in result.cycle.legs],
        "top_of_book_bps": round(result.net_bps, 4),
        "top_of_book_max_notional": round(result.max_start_notional, 2),
        "net_bps_by_size": priced,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if 0 < args.interval < 2.0:
        print(
            f"warning: interval {args.interval}s spends {25 * 60 / args.interval:.0f} "
            "weight/minute against a 1000/minute limit",
            file=sys.stderr,
        )

    client = BitvavoPublicClient()
    try:
        markets_by_name, cycles = discover(client, args.base)
    except BitvavoError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if not cycles:
        return 1

    if args.list_cycles:
        for cycle in cycles:
            print(f"  {cycle.key}   [{', '.join(str(leg) for leg in cycle.legs)}]")
        return 0

    depth_sizes = [float(s) for s in args.depth_sizes.split(",") if s.strip()]

    signal.signal(signal.SIGINT, _handle_sigint)
    sink = open_sink(args.out)
    tracker = EpisodeTracker(args.threshold_bps, sink=sink)
    started = time.time()
    deadline = started + args.duration if args.duration > 0 else None

    print(
        f"\nscanning {len(cycles)} cycles every {args.interval}s | "
        f"fee {args.fee * 100:.3f}%/leg ({args.fee_model}) | "
        f"threshold {args.threshold_bps:g} bps | -> {args.out}\n"
    )

    try:
        while not _stop:
            poll_started = time.time()
            try:
                tops = client.ticker_book()
            except BitvavoError as exc:
                print(f"poll failed: {exc}", file=sys.stderr)
                time.sleep(args.interval)
                continue

            results = [
                evaluate_cycle(cycle, tops, markets_by_name, args.fee, args.fee_model)
                for cycle in cycles
            ]
            tracker.observe(results, poll_started)

            priced = [r for r in results if r is not None]
            best = max(priced, key=lambda r: r.net_bps, default=None)
            hits = [r for r in priced if r.net_bps >= args.threshold_bps and r.feasible]

            if best and tracker.stats.polls % max(args.status_every, 1) == 0:
                stamp = datetime.fromtimestamp(poll_started, timezone.utc).strftime("%H:%M:%S")
                print(
                    f"{stamp}  best {best.net_bps:+8.2f} bps  {best.cycle.key:<28} "
                    f"max {best.max_start_notional:>10,.0f} {args.base}  "
                    f"tradeable hits {len(hits):>3}  episodes {tracker.stats.episodes_closed}"
                )

            if args.depth_check_bps is not None and hits:
                candidate = max(hits, key=lambda r: r.net_bps)
                if candidate.net_bps >= args.depth_check_bps:
                    try:
                        record = depth_check(
                            client, candidate, depth_sizes, args.fee, args.fee_model
                        )
                        sink.write(json.dumps(record) + "\n")
                        sink.flush()
                        print(f"          depth: {record['net_bps_by_size']}")
                    except BitvavoError as exc:
                        print(f"depth check failed: {exc}", file=sys.stderr)

            if args.max_polls and tracker.stats.polls >= args.max_polls:
                break
            if deadline and time.time() >= deadline:
                break
            elapsed = time.time() - poll_started
            if elapsed < args.interval:
                time.sleep(args.interval - elapsed)
    finally:
        tracker.flush()
        summary = tracker.stats.summary()
        summary["ran_for_s"] = round(time.time() - started, 1)
        print("\n" + json.dumps(summary, indent=2))
        sink.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
