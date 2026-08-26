"""Summarise a scan log into the numbers that decide go / no-go.

    python3 -m scanner.report data/episodes.jsonl

Answers, per venue:
  - how many net-positive opportunities appeared per day
  - how long they survived
  - how much size actually fit, and what the euro profit would have been
  - which cycles produced them

With several venues in one log the comparison is the point: same arithmetic,
same window, different fees and different quote-asset coverage.
"""
from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def load(path: Path) -> tuple[list[dict], list[dict]]:
    episodes, depth_checks = [], []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                print(f"  (skipping malformed line {line_no})")
                continue
            if record.get("type") == "depth_check":
                depth_checks.append(record)
            else:
                episodes.append(record)
    return episodes, depth_checks


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(int(q * (len(ordered) - 1)), len(ordered) - 1)
    return ordered[index]


def _fmt_ts(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).strftime("%Y-%m-%d %H:%M")


def _group(records: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        grouped[record.get("venue", "unknown")].append(record)
    return grouped


def _window_days(episodes: list[dict]) -> tuple[float, float]:
    starts = [e["opened_at"] for e in episodes]
    ends = [e.get("closed_at") or e["opened_at"] for e in episodes]
    span = max(ends) - min(starts)
    return min(starts), max(span / 86_400.0, 1e-9)


def venue_section(venue: str, episodes: list[dict], min_notional: float) -> None:
    start, span_days = _window_days(episodes)
    print(f"\n--- {venue} ---")
    print(f"window        : {_fmt_ts(start)} -> {_fmt_ts(start + span_days * 86_400)} UTC")
    print(f"episodes      : {len(episodes)}  ({len(episodes) / span_days:.1f} per day)")

    tradeable = [e for e in episodes if e.get("feasible_samples", 0) > 0]
    sized = [e for e in tradeable if e.get("peak_notional", 0.0) >= min_notional]
    print(f"  tradeable   : {len(tradeable)}  (minimum order size fit at top of book)")
    print(f"  >= {min_notional:,.0f} size : {len(sized)}")

    durations = [e["duration_s"] for e in episodes]
    print(
        f"lifetime (s)  : median {statistics.median(durations):.1f} | "
        f"p90 {_pct(durations, 0.9):.1f} | max {max(durations):.1f}"
    )

    peaks = [e["peak_bps"] for e in episodes]
    print(
        f"net edge (bps): median {statistics.median(peaks):.2f} | "
        f"p90 {_pct(peaks, 0.9):.2f} | max {max(peaks):.2f}"
    )

    profits = [e.get("peak_profit", 0.0) for e in sized]
    if profits:
        print(
            f"profit at peak: sum {sum(profits):,.2f} | median {statistics.median(profits):,.2f} "
            f"| max {max(profits):,.2f}  (per episode, at the size that fit)"
        )
    else:
        print("profit at peak: nothing cleared the size filter")

    by_cycle: dict[str, list[float]] = defaultdict(list)
    for episode in episodes:
        by_cycle[episode["cycle"]].append(episode["peak_bps"])
    print("top cycles by episode count:")
    for cycle, _count in Counter({k: len(v) for k, v in by_cycle.items()}).most_common(5):
        values = by_cycle[cycle]
        print(f"  {cycle:<32} {len(values):>5} episodes  best {max(values):+7.2f} bps")


def comparison(grouped: dict[str, list[dict]], min_notional: float) -> None:
    print("\nvenue comparison")
    print(
        f"  {'venue':<10} {'episodes':>9} {'per day':>9} {'tradeable':>10} "
        f"{'>= size':>8} {'median s':>9} {'best bps':>9}"
    )
    for venue in sorted(grouped):
        episodes = grouped[venue]
        _start, span_days = _window_days(episodes)
        tradeable = [e for e in episodes if e.get("feasible_samples", 0) > 0]
        sized = [e for e in tradeable if e.get("peak_notional", 0.0) >= min_notional]
        durations = [e["duration_s"] for e in episodes]
        peaks = [e["peak_bps"] for e in episodes]
        print(
            f"  {venue:<10} {len(episodes):>9} {len(episodes) / span_days:>9.1f} "
            f"{len(tradeable):>10} {len(sized):>8} "
            f"{statistics.median(durations):>9.1f} {max(peaks):>+9.2f}"
        )


def depth_section(depth_checks: list[dict]) -> None:
    print(f"\ndepth checks  : {len(depth_checks)}")
    for venue, checks in sorted(_group(depth_checks).items()):
        by_size: dict[str, list[float]] = defaultdict(list)
        thin: Counter = Counter()
        for check in checks:
            for size, bps in check.get("net_bps_by_size", {}).items():
                if bps is None:
                    thin[size] += 1
                else:
                    by_size[size].append(bps)
        print(f"  [{venue}] {len(checks)} checks")
        for size in sorted(by_size, key=float):
            values = by_size[size]
            positive = sum(1 for v in values if v > 0)
            print(
                f"    size {float(size):>8,.0f}: median {statistics.median(values):+7.2f} bps | "
                f"positive {positive}/{len(values)} | book too thin {thin[size]}"
            )
        if not by_size:
            print("    every check ran out of book — top-of-book size was the whole story")


def report(path: Path, min_notional: float) -> int:
    episodes, depth_checks = load(path)
    if not episodes and not depth_checks:
        print(f"{path}: no records yet.")
        return 0

    print(f"=== {path} ===")
    grouped = _group(episodes)
    if len(grouped) > 1:
        comparison(grouped, min_notional)
    for venue in sorted(grouped):
        venue_section(venue, grouped[venue], min_notional)

    if episodes:
        print(
            "\nnote: lifetime is bounded below by the poll interval; an episode seen "
            "once may have lived far less than one interval."
        )
    if depth_checks:
        depth_section(depth_checks)

    print(
        "\nRead this as: an opportunity is only real if it is tradeable, survives "
        "longer than your round-trip latency, and clears a size worth the risk."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scanner.report", description=__doc__)
    parser.add_argument("path", nargs="?", default="data/episodes.jsonl")
    parser.add_argument(
        "--min-notional",
        type=float,
        default=100.0,
        help="ignore episodes where less than this much size fit at top of book",
    )
    args = parser.parse_args(argv)
    path = Path(args.path)
    if not path.exists():
        print(f"{path}: not found. Run the scanner first.")
        return 1
    return report(path, args.min_notional)


if __name__ == "__main__":
    raise SystemExit(main())
