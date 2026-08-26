"""Episode bookkeeping: opening, closing and summarising opportunities."""
import io
import json
import unittest

from scanner.types import BookTop, Market
from scanner.graph import BUY, SELL, Cycle, Leg
from scanner.pricing import evaluate_cycle
from scanner.tracker import EpisodeTracker

CYCLE = Cycle(
    (
        Leg("BTC-EUR", BUY, "EUR", "BTC"),
        Leg("ETH-BTC", BUY, "BTC", "ETH"),
        Leg("ETH-EUR", SELL, "ETH", "EUR"),
    )
)

MARKETS = {
    "BTC-EUR": Market("BTC-EUR", "BTC", "EUR", "trading", 5.0, 0.0001),
    "ETH-BTC": Market("ETH-BTC", "ETH", "BTC", "trading", 0.0001, 0.001),
    "ETH-EUR": Market("ETH-EUR", "ETH", "EUR", "trading", 5.0, 0.001),
}


def snapshot(eth_eur_bid):
    return {
        "BTC-EUR": BookTop("BTC-EUR", 99_990.0, 1.0, 100_000.0, 0.5),
        "ETH-BTC": BookTop("ETH-BTC", 0.0499, 20.0, 0.05, 10.0),
        "ETH-EUR": BookTop("ETH-EUR", eth_eur_bid, 4.0, eth_eur_bid + 10, 5.0),
    }


def evaluate(eth_eur_bid):
    return [evaluate_cycle(CYCLE, snapshot(eth_eur_bid), MARKETS, fee=0.0)]


class TestEpisodeTracker(unittest.TestCase):
    def test_episode_spans_consecutive_profitable_polls(self):
        sink = io.StringIO()
        tracker = EpisodeTracker(threshold_bps=10.0, sink=sink)

        self.assertEqual(tracker.observe(evaluate(5_100.0), 1_000.0), [])
        self.assertEqual(tracker.observe(evaluate(5_200.0), 1_003.0), [])
        closed = tracker.observe(evaluate(5_000.0), 1_006.0)  # back to break-even

        self.assertEqual(len(closed), 1)
        episode = closed[0]
        self.assertEqual(episode.samples, 2)
        self.assertAlmostEqual(episode.duration_s, 3.0)
        self.assertAlmostEqual(episode.peak_bps, 400.0, places=6)  # the 4% snapshot
        self.assertEqual(json.loads(sink.getvalue())["type"], "episode")

    def test_a_dip_below_threshold_starts_a_new_episode(self):
        tracker = EpisodeTracker(threshold_bps=10.0)
        tracker.observe(evaluate(5_100.0), 1_000.0)
        tracker.observe(evaluate(5_000.0), 1_003.0)
        tracker.observe(evaluate(5_100.0), 1_006.0)
        tracker.flush()
        self.assertEqual(tracker.stats.episodes_closed, 2)

    def test_flush_closes_whatever_is_still_open(self):
        tracker = EpisodeTracker(threshold_bps=10.0)
        tracker.observe(evaluate(5_100.0), 1_000.0)
        self.assertEqual(len(tracker.flush()), 1)
        self.assertEqual(tracker.open_episodes, {})

    def test_unpriceable_cycles_are_counted_not_dropped(self):
        tracker = EpisodeTracker(threshold_bps=0.0)
        tracker.observe([None, None], 1_000.0)
        self.assertEqual(tracker.stats.unpriceable, 2)
        self.assertEqual(tracker.stats.evaluations, 0)

    def test_summary_records_the_best_cycle_seen(self):
        tracker = EpisodeTracker(threshold_bps=10.0)
        tracker.observe(evaluate(5_100.0), 1_000.0)
        summary = tracker.stats.summary()
        self.assertEqual(summary["best_cycle"], "EUR>BTC>ETH>EUR")
        self.assertAlmostEqual(summary["best_bps"], 200.0, places=2)

    def test_below_threshold_never_opens_an_episode(self):
        tracker = EpisodeTracker(threshold_bps=500.0)
        tracker.observe(evaluate(5_100.0), 1_000.0)
        self.assertEqual(tracker.open_episodes, {})
        self.assertEqual(tracker.stats.above_threshold, 0)
