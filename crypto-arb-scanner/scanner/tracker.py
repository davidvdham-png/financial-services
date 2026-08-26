"""Track how long a profitable cycle stays profitable.

The number that decides whether triangular arbitrage is worth pursuing is not
"how often does a positive spread appear" but "how long does it survive after
fees, and how much size fits in it". This module turns a stream of per-poll
evaluations into discrete episodes so those two questions can be answered
from the log.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, TextIO

from .pricing import CycleResult


@dataclass
class Episode:
    """An uninterrupted run of polls where one cycle stayed above threshold."""

    cycle: str
    legs: list[str]
    opened_at: float
    closed_at: float | None = None
    samples: int = 0
    peak_bps: float = 0.0
    sum_bps: float = 0.0
    peak_notional: float = 0.0
    # Best profit seen: net edge times the size that actually fit at that moment.
    peak_profit: float = 0.0
    feasible_samples: int = 0

    @property
    def duration_s(self) -> float:
        return (self.closed_at or self.opened_at) - self.opened_at

    @property
    def mean_bps(self) -> float:
        return self.sum_bps / self.samples if self.samples else 0.0

    def observe(self, result: CycleResult, timestamp: float) -> None:
        self.samples += 1
        self.sum_bps += result.net_bps
        self.closed_at = timestamp
        if result.net_bps > self.peak_bps:
            self.peak_bps = result.net_bps
        if result.feasible:
            self.feasible_samples += 1
            size = min(result.max_start_notional, 100_000.0)
            self.peak_notional = max(self.peak_notional, size)
            self.peak_profit = max(self.peak_profit, size * (result.net_ratio - 1.0))

    def to_record(self) -> dict:
        record = asdict(self)
        record["type"] = "episode"
        record["duration_s"] = round(self.duration_s, 3)
        record["mean_bps"] = round(self.mean_bps, 4)
        record["peak_bps"] = round(self.peak_bps, 4)
        record["peak_notional"] = round(self.peak_notional, 2)
        record["peak_profit"] = round(self.peak_profit, 4)
        record.pop("sum_bps", None)
        return record


@dataclass
class ScanStats:
    polls: int = 0
    evaluations: int = 0
    unpriceable: int = 0
    above_threshold: int = 0
    feasible_above_threshold: int = 0
    episodes_closed: int = 0
    best_bps: float = float("-inf")
    best_cycle: str | None = None

    def summary(self) -> dict:
        return {
            "polls": self.polls,
            "cycle_evaluations": self.evaluations,
            "unpriceable": self.unpriceable,
            "samples_above_threshold": self.above_threshold,
            "samples_above_threshold_and_tradeable": self.feasible_above_threshold,
            "episodes": self.episodes_closed,
            "best_bps": None if self.best_bps == float("-inf") else round(self.best_bps, 4),
            "best_cycle": self.best_cycle,
        }


class EpisodeTracker:
    """Opens an episode when a cycle crosses the threshold, closes it when it
    falls back, and writes closed episodes to a JSONL sink."""

    def __init__(self, threshold_bps: float, sink: TextIO | None = None) -> None:
        self.threshold_bps = threshold_bps
        self.sink = sink
        self.open_episodes: dict[str, Episode] = {}
        self.stats = ScanStats()

    def _fingerprint(self, result: CycleResult) -> str:
        return "|".join(f"{leg.side}:{leg.market}" for leg in result.cycle.legs)

    def observe(self, results: Iterable[CycleResult | None], timestamp: float) -> list[Episode]:
        """Feed one poll's worth of evaluations. Returns episodes closed now."""
        self.stats.polls += 1
        live: set[str] = set()

        for result in results:
            if result is None:
                self.stats.unpriceable += 1
                continue
            self.stats.evaluations += 1
            if result.net_bps > self.stats.best_bps:
                self.stats.best_bps = result.net_bps
                self.stats.best_cycle = result.cycle.key

            if result.net_bps < self.threshold_bps:
                continue

            self.stats.above_threshold += 1
            if result.feasible:
                self.stats.feasible_above_threshold += 1

            key = self._fingerprint(result)
            live.add(key)
            episode = self.open_episodes.get(key)
            if episode is None:
                episode = Episode(
                    cycle=result.cycle.key,
                    legs=[str(leg) for leg in result.cycle.legs],
                    opened_at=timestamp,
                )
                self.open_episodes[key] = episode
            episode.observe(result, timestamp)

        return self._close_stale(live)

    def _close_stale(self, live: set[str]) -> list[Episode]:
        closed = []
        for key in list(self.open_episodes):
            if key in live:
                continue
            episode = self.open_episodes.pop(key)
            closed.append(episode)
            self._emit(episode)
        return closed

    def flush(self) -> list[Episode]:
        """Close everything still open, e.g. at shutdown."""
        return self._close_stale(set())

    def _emit(self, episode: Episode) -> None:
        self.stats.episodes_closed += 1
        if self.sink is not None:
            self.sink.write(json.dumps(episode.to_record()) + "\n")
            self.sink.flush()


def open_sink(path: str | Path) -> TextIO:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    return target.open("a", encoding="utf-8")
