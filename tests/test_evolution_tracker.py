"""
Tests for EvolutionTracker — population genetics and evolution analysis.

Covers: TraitSnapshot, SelectionEvent, EvolutionTracker (recording,
diversity metrics, selection detection, effective pop size, fixation
index, frequency history, trends, reports).
"""

import math
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from evolution_tracker import TraitSnapshot, SelectionEvent, EvolutionTracker


# ============================================================
# Helpers
# ============================================================

def make_bots(traits_list):
    """Create mock bots from a list of trait dicts."""
    return [{'traits': t} for t in traits_list]


def uniform_bots(n, trait_name, value):
    """Create n bots all with the same trait value."""
    return make_bots([{trait_name: value} for _ in range(n)])


def diverse_bots(trait_name, distribution):
    """Create bots from a {value: count} distribution."""
    bots = []
    for val, count in distribution.items():
        for _ in range(count):
            bots.append({'traits': {trait_name: val}})
    return bots


# ============================================================
# TraitSnapshot Tests
# ============================================================

class TestTraitSnapshot:

    def test_empty_values(self):
        snap = TraitSnapshot('color', 0, [])
        assert snap.total == 0
        assert snap.shannon == 0.0
        assert snap.simpson == 0.0
        assert snap.heterozygosity == 0.0
        assert snap.modal_value is None
        assert snap.frequencies == {}

    def test_single_value(self):
        snap = TraitSnapshot('size', 1, ['large'])
        assert snap.total == 1
        assert snap.frequencies == {'large': 1.0}
        assert snap.modal_value == 'large'
        assert snap.shannon == 0.0  # no diversity
        assert snap.simpson == 0.0
        assert snap.heterozygosity == 0.0

    def test_uniform_distribution(self):
        snap = TraitSnapshot('color', 0, ['red'] * 50)
        assert snap.shannon == 0.0
        assert snap.simpson == 0.0
        assert snap.heterozygosity == 0.0
        assert snap.modal_value == 'red'

    def test_two_equal_alleles(self):
        snap = TraitSnapshot('color', 0, ['red'] * 50 + ['blue'] * 50)
        assert snap.total == 100
        assert abs(snap.frequencies['red'] - 0.5) < 0.001
        assert abs(snap.frequencies['blue'] - 0.5) < 0.001
        assert snap.shannon > 0.6  # ln(2) ≈ 0.693
        assert abs(snap.simpson - 0.5) < 0.001
        assert abs(snap.heterozygosity - 0.5) < 0.001

    def test_three_alleles(self):
        vals = ['A'] * 40 + ['B'] * 30 + ['C'] * 30
        snap = TraitSnapshot('gene', 5, vals)
        assert snap.total == 100
        assert len(snap.frequencies) == 3
        assert snap.modal_value == 'A'
        assert snap.shannon > 1.0

    def test_to_dict(self):
        snap = TraitSnapshot('speed', 3, ['fast', 'slow', 'fast'])
        d = snap.to_dict()
        assert d['trait'] == 'speed'
        assert d['generation'] == 3
        assert d['total'] == 3
        assert 'frequencies' in d
        assert 'shannon' in d
        assert 'simpson' in d
        assert 'heterozygosity' in d

    def test_numeric_values(self):
        snap = TraitSnapshot('size', 0, [1, 2, 2, 3, 3, 3])
        assert snap.modal_value == 3
        assert len(snap.frequencies) == 3

    def test_shannon_max_for_uniform(self):
        """Maximum Shannon entropy for k categories = ln(k)."""
        k = 4
        vals = [i for i in range(k) for _ in range(25)]
        snap = TraitSnapshot('x', 0, vals)
        max_entropy = math.log(k)
        assert abs(snap.shannon - max_entropy) < 0.001


# ============================================================
# SelectionEvent Tests
# ============================================================

class TestSelectionEvent:

    def test_positive_selection(self):
        e = SelectionEvent('color', 'red', 5, 0.15, 0.3, 0.45)
        assert e.direction == 'positive'
        assert e.coefficient == 0.15
        assert e.trait_name == 'color'
        assert e.allele == 'red'

    def test_negative_selection(self):
        e = SelectionEvent('size', 'large', 3, -0.2, 0.6, 0.4)
        assert e.direction == 'negative'

    def test_to_dict(self):
        e = SelectionEvent('speed', 'fast', 10, 0.5, 0.2, 0.7)
        d = e.to_dict()
        assert d['trait'] == 'speed'
        assert d['allele'] == 'fast'
        assert d['generation'] == 10
        assert d['direction'] == 'positive'


# ============================================================
# EvolutionTracker Core Tests
# ============================================================

class TestEvolutionTracker:

    def test_creation(self):
        tracker = EvolutionTracker(traits=['speed', 'color'])
        assert tracker.tracked_traits == ['speed', 'color']
        assert tracker.generations_recorded == 0

    def test_auto_discover_traits(self):
        tracker = EvolutionTracker()
        bots = make_bots([{'speed': 5, 'color': 'red'}])
        tracker.record_generation(0, bots)
        assert 'speed' in tracker.tracked_traits
        assert 'color' in tracker.tracked_traits

    def test_record_generation(self):
        tracker = EvolutionTracker(traits=['color'])
        bots = diverse_bots('color', {'red': 60, 'blue': 40})
        snaps = tracker.record_generation(0, bots)
        assert 'color' in snaps
        assert snaps['color'].total == 100
        assert tracker.generations_recorded == 1

    def test_multiple_generations(self):
        tracker = EvolutionTracker(traits=['color'])
        tracker.record_generation(0, diverse_bots('color', {'red': 50, 'blue': 50}))
        tracker.record_generation(1, diverse_bots('color', {'red': 60, 'blue': 40}))
        tracker.record_generation(2, diverse_bots('color', {'red': 70, 'blue': 30}))
        assert tracker.generations_recorded == 3

    def test_get_diversity(self):
        tracker = EvolutionTracker(traits=['x'])
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        h = tracker.get_diversity('x')
        assert h is not None
        assert h > 0.6

    def test_get_diversity_missing_trait(self):
        tracker = EvolutionTracker(traits=['x'])
        assert tracker.get_diversity('y') is None

    def test_get_heterozygosity(self):
        tracker = EvolutionTracker(traits=['x'])
        tracker.record_generation(0, diverse_bots('x', {'A': 80, 'B': 20}))
        h = tracker.get_heterozygosity('x')
        assert h is not None
        assert abs(h - 0.2) < 0.001

    def test_get_frequencies(self):
        tracker = EvolutionTracker(traits=['color'])
        tracker.record_generation(0, diverse_bots('color', {'red': 75, 'blue': 25}))
        freqs = tracker.get_frequencies('color')
        assert abs(freqs['red'] - 0.75) < 0.001
        assert abs(freqs['blue'] - 0.25) < 0.001

    def test_get_frequencies_empty(self):
        tracker = EvolutionTracker(traits=['x'])
        assert tracker.get_frequencies('x') == {}

    def test_get_frequency_history(self):
        tracker = EvolutionTracker(traits=['color'])
        tracker.record_generation(0, diverse_bots('color', {'red': 50, 'blue': 50}))
        tracker.record_generation(1, diverse_bots('color', {'red': 70, 'blue': 30}))
        history = tracker.get_frequency_history('color', 'red')
        assert len(history) == 2
        assert history[0] == (0, 0.5)
        assert history[1] == (1, 0.7)


# ============================================================
# Selection Detection Tests
# ============================================================

class TestSelectionDetection:

    def test_no_selection_small_change(self):
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.1)
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        tracker.record_generation(1, diverse_bots('x', {'A': 52, 'B': 48}))
        events = tracker.get_selection_events('x')
        assert len(events) == 0

    def test_selection_large_change(self):
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        tracker.record_generation(1, diverse_bots('x', {'A': 70, 'B': 30}))
        events = tracker.get_selection_events('x')
        assert len(events) >= 1
        # A increased, B decreased
        a_events = [e for e in events if e.allele == 'A']
        b_events = [e for e in events if e.allele == 'B']
        if a_events:
            assert a_events[0].direction == 'positive'
        if b_events:
            assert b_events[0].direction == 'negative'

    def test_get_all_selection_events(self):
        tracker = EvolutionTracker(traits=['x', 'y'], selection_threshold=0.05)
        tracker.record_generation(0, make_bots(
            [{'x': 'A', 'y': 'P'}] * 50 + [{'x': 'B', 'y': 'Q'}] * 50))
        tracker.record_generation(1, make_bots(
            [{'x': 'A', 'y': 'P'}] * 80 + [{'x': 'B', 'y': 'Q'}] * 20))
        all_events = tracker.get_selection_events()
        assert len(all_events) >= 2  # at least x and y have changes

    def test_new_allele_appears(self):
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        assert len(b_events) == 1
        assert b_events[0].direction == 'positive'

    def test_allele_disappears(self):
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 80, 'B': 20}))
        tracker.record_generation(1, diverse_bots('x', {'A': 100}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        assert len(b_events) == 1
        assert b_events[0].direction == 'negative'


# ============================================================
# Advanced Metrics Tests
# ============================================================

class TestAdvancedMetrics:

    def test_effective_population_size(self):
        tracker = EvolutionTracker(traits=['x'])
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        ne = tracker.get_effective_population_size('x')
        assert ne is not None
        assert ne > 0

    def test_effective_pop_size_uniform(self):
        tracker = EvolutionTracker(traits=['x'])
        tracker.record_generation(0, uniform_bots(100, 'x', 'A'))
        ne = tracker.get_effective_population_size('x')
        assert ne == 0.0  # zero heterozygosity

    def test_effective_pop_size_missing(self):
        tracker = EvolutionTracker(traits=['x'])
        assert tracker.get_effective_population_size('y') is None

    def test_fixation_index(self):
        tracker = EvolutionTracker(traits=['color'])
        group1 = diverse_bots('color', {'red': 90, 'blue': 10})
        group2 = diverse_bots('color', {'red': 10, 'blue': 90})
        fst = tracker.get_fixation_index('color', [group1, group2])
        assert fst is not None
        assert fst > 0.5  # highly differentiated

    def test_fixation_index_same_groups(self):
        tracker = EvolutionTracker(traits=['color'])
        group = diverse_bots('color', {'red': 50, 'blue': 50})
        fst = tracker.get_fixation_index('color', [group, group])
        assert fst is not None
        assert abs(fst) < 0.01  # no differentiation

    def test_fixation_index_no_subgroups(self):
        tracker = EvolutionTracker(traits=['x'])
        assert tracker.get_fixation_index('x') is None
        assert tracker.get_fixation_index('x', []) is None


# ============================================================
# Trend and Report Tests
# ============================================================

class TestTrendsAndReports:

    def test_diversity_trend_insufficient(self):
        tracker = EvolutionTracker(traits=['x'])
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        assert tracker.get_diversity_trend('x') == 'insufficient_data'

    def test_diversity_trend_stable(self):
        tracker = EvolutionTracker(traits=['x'])
        for g in range(5):
            tracker.record_generation(g, diverse_bots('x', {'A': 50, 'B': 50}))
        assert tracker.get_diversity_trend('x') == 'stable'

    def test_diversity_trend_decreasing(self):
        tracker = EvolutionTracker(traits=['x'])
        # Start diverse, converge to uniform
        tracker.record_generation(0, diverse_bots('x', {'A': 25, 'B': 25, 'C': 25, 'D': 25}))
        tracker.record_generation(1, diverse_bots('x', {'A': 40, 'B': 30, 'C': 20, 'D': 10}))
        tracker.record_generation(2, diverse_bots('x', {'A': 70, 'B': 20, 'C': 7, 'D': 3}))
        assert tracker.get_diversity_trend('x') == 'decreasing'

    def test_get_report(self):
        tracker = EvolutionTracker(traits=['speed'])
        tracker.record_generation(0, diverse_bots('speed', {'fast': 60, 'slow': 40}))
        report = tracker.get_report()
        assert report['generations_recorded'] == 1
        assert 'speed' in report['traits']
        assert 'current' in report['traits']['speed']
        assert 'selection_events' in report

    def test_summary(self):
        tracker = EvolutionTracker(traits=['color'])
        tracker.record_generation(0, diverse_bots('color', {'red': 50, 'blue': 50}))
        s = tracker.summary()
        assert 'Evolution Tracker' in s
        assert 'color' in s
        assert 'Shannon' in s

    def test_report_with_selection(self):
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        report = tracker.get_report()
        assert len(report['selection_events']) > 0

    def test_bot_with_object_traits(self):
        """Test with actual bot-like objects (hasattr interface)."""
        class MockBot:
            def __init__(self, **traits):
                self.traits = traits

        tracker = EvolutionTracker(traits=['speed'])
        bots = [MockBot(speed='fast')] * 30 + [MockBot(speed='slow')] * 70
        snaps = tracker.record_generation(0, bots)
        assert snaps['speed'].total == 100
        assert abs(snaps['speed'].frequencies['slow'] - 0.7) < 0.001
