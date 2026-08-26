"""Live triangular-arbitrage scanner across one or more venues.

Read-only: no API keys, no authenticated endpoints, no order-placement code
path anywhere in this package.

Usage:
    python3 -m scanner.scan --venue bitvavo,kraken,okx --list-cycles
    python3 -m scanner.scan --venue bitvavo,kraken,okx --out data/episodes.jsonl

Scanning several venues at once is what makes the fee comparison legible:
the same cycle arithmetic runs against each, so differences in hit rate come
from the venue's fees and quote-asset coverage, not from the code.
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from .graph import Cycle, find_cycles
from .pricing import (
    FEE_MODEL_OUTPUT,
    FEE_MODEL_QUOTE,
    CycleResult,
    evaluate_cycle,
    evaluate_cycle_at_size,
)
from .tracker import EpisodeTracker, open_sink
from .types import Market, Venue, VenueError
from .venues import VENUES, build

_stop = False


def _handle_sigint(_signum, _frame) -> None:
    global _stop
    _stop = True
    print("\nStopping after this poll...", file=sys.stderr)


@dataclass
class VenueScan:
    """Everything the loop needs to poll one venue."""

    venue: Venue
    markets: dict[str, Market]
    cycles: list[Cycle]
    fee: float
    tracker: EpisodeTracker
    failures: int = 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="scanner.scan",
        description="Read-only triangular arbitrage scanner.",
    )
    parser.add_argument(
        "--venue",
        default="bitvavo",
        help=f"comma-separated venues to scan; available: {', '.join(sorted(VENUES))}",
    )
    parser.add_argument("--base", default="EUR", help="asset each cycle starts and ends in")
    parser.add_argument(
        "--fee",
        default=None,
        help="taker fee per leg. A single number applies to every venue "
        "(0.0025 = 0.25%%); per-venue overrides look like "
        "'bitvavo=0.0025,okx=0.001'. Default: each venue's entry tier.",
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
        "exceeds this many net bps",
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
    parser.add_argument(
        "--okx-base-url",
        default=None,
        help="override the OKX API host, e.g. the EEA entity you trade on",
    )
    return parser.parse_args(argv)


def parse_fees(spec: str | None, venues: list[str]) -> dict[str, float | None]:
    """Turn --fee into a per-venue override map. None means 'venue default'."""
    fees: dict[str, float | None] = {name: None for name in venues}
    if not spec:
        return fees
    if "=" not in spec:
        try:
            flat = float(spec)
        except ValueError:
            raise SystemExit(f"--fee: {spec!r} is not a number or a venue=rate list") from None
        return {name: flat for name in venues}
    for item in spec.split(","):
        item = item.strip()
        if not item:
            continue
        name, _, value = item.partition("=")
        name = name.strip()
        if name not in fees:
            raise SystemExit(f"--fee: {name!r} is not one of the scanned venues")
        try:
            fees[name] = float(value)
        except ValueError:
            raise SystemExit(f"--fee: {value!r} is not a number") from None
    return fees


def discover(venue: Venue, base: str) -> tuple[dict[str, Market], list[Cycle]]:
    markets = venue.markets()
    tradeable = [m for m in markets if m.tradeable]
    quotes = sorted({m.quote for m in tradeable})
    cycles = find_cycles(tradeable, start_asset=base)

    print(f"[{venue.name}] {len(tradeable)} tradeable markets of {len(markets)}")
    print(f"[{venue.name}] quote assets: {', '.join(quotes) if quotes else '(none)'}")
    print(f"[{venue.name}] triangular cycles through {base}: {len(cycles)}")
    observed = getattr(venue, "observed_taker_fee", None)
    if observed is not None:
        print(f"[{venue.name}] entry-tier taker fee reported by the venue: {observed * 100:.3f}%")
    if not cycles:
        print(
            f"[{venue.name}] no cycles: triangular arbitrage needs markets quoted in "
            f"something other than {base}, so a path can leave {base} and come back "
            f"through a third asset. If every market here is {base}-quoted, this "
            f"strategy has nothing to work with on this venue.",
            file=sys.stderr,
        )
    return {m.market: m for m in tradeable}, cycles


def depth_check(
    scan: VenueScan, result: CycleResult, sizes: list[float], fee_model: str
) -> dict:
    books = {leg.market: scan.venue.book(leg.market, depth=50) for leg in result.cycle.legs}
    priced = {}
    for size in sizes:
        bps = evaluate_cycle_at_size(result.cycle, books, size, scan.fee, fee_model)
        priced[str(size)] = None if bps is None else round(bps, 4)
    return {
        "type": "depth_check",
        "ts": time.time(),
        "venue": scan.venue.name,
        "cycle": result.cycle.key,
        "legs": [str(leg) for leg in result.cycle.legs],
        "top_of_book_bps": round(result.net_bps, 4),
        "top_of_book_max_notional": round(result.max_start_notional, 2),
        "net_bps_by_size": priced,
    }


def poll_venue(scan: VenueScan, args: argparse.Namespace, sink) -> None:
    """One poll of one venue. A venue that fails does not stop the others."""
    poll_started = time.time()
    try:
        tops = scan.venue.ticker_book()
    except VenueError as exc:
        scan.failures += 1
        print(f"[{scan.venue.name}] poll failed: {exc}", file=sys.stderr)
        return

    results = [
        evaluate_cycle(cycle, tops, scan.markets, scan.fee, args.fee_model)
        for cycle in scan.cycles
    ]
    scan.tracker.observe(results, poll_started)

    priced = [r for r in results if r is not None]
    best = max(priced, key=lambda r: r.net_bps, default=None)
    hits = [r for r in priced if r.net_bps >= args.threshold_bps and r.feasible]

    if best and scan.tracker.stats.polls % max(args.status_every, 1) == 0:
        stamp = datetime.fromtimestamp(poll_started, timezone.utc).strftime("%H:%M:%S")
        print(
            f"{stamp} {scan.venue.name:<8} best {best.net_bps:+8.2f} bps  "
            f"{best.cycle.key:<26} max {best.max_start_notional:>10,.0f} {args.base}  "
            f"hits {len(hits):>3}  episodes {scan.tracker.stats.episodes_closed}"
        )

    if args.depth_check_bps is not None and hits:
        candidate = max(hits, key=lambda r: r.net_bps)
        if candidate.net_bps >= args.depth_check_bps:
            sizes = [float(s) for s in args.depth_sizes.split(",") if s.strip()]
            try:
                record = depth_check(scan, candidate, sizes, args.fee_model)
                sink.write(json.dumps(record) + "\n")
                sink.flush()
                print(f"         {scan.venue.name:<8} depth: {record['net_bps_by_size']}")
            except VenueError as exc:
                print(f"[{scan.venue.name}] depth check failed: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    names = [n.strip() for n in args.venue.split(",") if n.strip()]
    if not names:
        raise SystemExit("--venue: name at least one venue")
    fees = parse_fees(args.fee, names)

    if 0 < args.interval < 2.0:
        print(
            f"warning: a {args.interval}s interval polls aggressively; each venue "
            "has its own rate limit and the clients pace themselves, so the real "
            "interval may be longer",
            file=sys.stderr,
        )

    scans: list[VenueScan] = []
    for name in names:
        venue = build(name, base_url=args.okx_base_url if name == "okx" else None)
        try:
            markets, cycles = discover(venue, args.base)
        except VenueError as exc:
            print(f"[{name}] discovery failed: {exc}", file=sys.stderr)
            continue
        if not cycles:
            continue
        fee = fees[name] if fees[name] is not None else venue.default_taker_fee
        scans.append(
            VenueScan(venue=venue, markets=markets, cycles=cycles, fee=fee, tracker=None)  # type: ignore[arg-type]
        )

    if not scans:
        print("\nno venue produced any cycles to scan.", file=sys.stderr)
        return 1

    if args.list_cycles:
        for scan in scans:
            print(f"\n[{scan.venue.name}] {len(scan.cycles)} cycles:")
            for cycle in scan.cycles:
                print(f"  {cycle.key:<30} [{', '.join(str(leg) for leg in cycle.legs)}]")
        return 0

    signal.signal(signal.SIGINT, _handle_sigint)
    sink = open_sink(args.out)
    for scan in scans:
        scan.tracker = EpisodeTracker(args.threshold_bps, sink=sink, venue=scan.venue.name)

    started = time.time()
    deadline = started + args.duration if args.duration > 0 else None

    print("\nscanning:")
    for scan in scans:
        print(
            f"  {scan.venue.name:<8} {len(scan.cycles):>5} cycles  "
            f"fee {scan.fee * 100:.3f}%/leg  "
            f"break-even hurdle {scan.fee * 3 * 10_000:.0f} bps  "
            f"({scan.venue.poll_cost})"
        )
    print(
        f"every {args.interval}s | threshold {args.threshold_bps:g} bps | "
        f"model {args.fee_model} | -> {args.out}\n"
    )

    try:
        while not _stop:
            loop_started = time.time()
            for scan in scans:
                if _stop:
                    break
                poll_venue(scan, args, sink)

            polls = max((s.tracker.stats.polls for s in scans), default=0)
            if args.max_polls and polls >= args.max_polls:
                break
            if deadline and time.time() >= deadline:
                break
            elapsed = time.time() - loop_started
            if elapsed < args.interval:
                time.sleep(args.interval - elapsed)
    finally:
        summaries = []
        for scan in scans:
            scan.tracker.flush()
            summary = scan.tracker.stats.summary()
            summary["fee_per_leg"] = scan.fee
            summary["poll_failures"] = scan.failures
            summaries.append(summary)
        print(
            "\n"
            + json.dumps(
                {"ran_for_s": round(time.time() - started, 1), "venues": summaries}, indent=2
            )
        )
        sink.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
