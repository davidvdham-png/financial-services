"""Summarise a scan log into the numbers that decide go / no-go.

    python3 -m scanner.report data/episodes.jsonl

Answers, from the recorded episodes:
  - how many net-positive opportunities appeared per day
  - how long they survived (median and p90 lifetime)
  - how much size actually fit, and what the euro profit would have been
  - which cycles produced them
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


def report(path: Path, min_notional: float) -> int:
    episodes, depth_checks = load(path)
    if not episodes and not depth_checks:
        print(f"{path}: no records yet.")
        return 0

    print(f"=== {path} ===")
    if episodes:
        starts = [e["opened_at"] for e in episodes]
        span_s = max(e.get("closed_at") or e["opened_at"] for e in episodes) - min(starts)
        span_days = max(span_s / 86_400.0, 1e-9)
        print(f"window        : {_fmt_ts(min(starts))} -> {_fmt_ts(min(starts) + span_s)} UTC")
        print(f"episodes      : {len(episodes)}  ({len(episodes) / span_days:.1f} per day)")

        # An episode only matters if the exchange minimum fit at least once.
        tradeable = [e for e in episodes if e.get("feasible_samples", 0) > 0]
        sized = [e for e in tradeable if e.get("peak_notional", 0.0) >= min_notional]
        print(f"  tradeable   : {len(tradeable)}  (min order size fit at top of book)")
        print(f"  >= {min_notional:,.0f} size : {len(sized)}")

        durations = [e["duration_s"] for e in episodes]
        print(
            f"lifetime (s)  : median {statistics.median(durations):.1f} | "
            f"p90 {_pct(durations, 0.9):.1f} | max {max(durations):.1f}"
        )
        print(
            "  note: lifetime is bounded below by the poll interval; an episode "
            "seen once may have lived far less than one interval."
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
        print("\ntop cycles by episode count:")
        for cycle, _count in Counter({k: len(v) for k, v in by_cycle.items()}).most_common(10):
            values = by_cycle[cycle]
            print(f"  {cycle:<34} {len(values):>5} episodes  best {max(values):+7.2f} bps")

    if depth_checks:
        print(f"\ndepth checks  : {len(depth_checks)}")
        by_size: dict[str, list[float]] = defaultdict(list)
        thin = Counter()
        for check in depth_checks:
            for size, bps in check.get("net_bps_by_size", {}).items():
                if bps is None:
                    thin[size] += 1
                else:
                    by_size[size].append(bps)
        for size in sorted(by_size, key=float):
            values = by_size[size]
            positive = sum(1 for v in values if v > 0)
            print(
                f"  size {float(size):>8,.0f}: median {statistics.median(values):+7.2f} bps | "
                f"positive {positive}/{len(values)} | book too thin {thin[size]}"
            )
        if not by_size:
            print("  every depth check ran out of book — top-of-book size was the whole story")

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
