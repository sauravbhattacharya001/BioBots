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
        """New allele appearing (prev_freq=0.0) is at the boundary — the
        Wright-Fisher selection coefficient formula is not applicable, so
        no selection event should be generated (fix for issue #15)."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        events = tracker.get_selection_events('x')
        # B: prev_freq=0.0 → boundary, skipped
        # A: prev_freq=1.0 → boundary, skipped
        b_events = [e for e in events if e.allele == 'B']
        a_events = [e for e in events if e.allele == 'A']
        assert len(b_events) == 0, "Boundary allele (prev_freq=0) should not produce selection event"
        assert len(a_events) == 0, "Boundary allele (prev_freq=1) should not produce selection event"

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

    def test_fixation_index_unequal_sizes_never_negative(self):
        """Regression test for issue #16: Fst must never be negative."""
        tracker = EvolutionTracker(traits=['color'])
        # Large uniform group + small diverse group
        group_a = diverse_bots('color', {'blue': 900})
        group_b = diverse_bots('color', {'blue': 50, 'red': 50})
        fst = tracker.get_fixation_index('color', [group_a, group_b])
        assert fst is not None
        assert fst >= 0.0, f"Fst should be non-negative, got {fst}"

    def test_fixation_index_weighted_vs_unweighted(self):
        """Verify weighted mean gives correct results for unequal group sizes."""
        tracker = EvolutionTracker(traits=['color'])
        # Group A: 800 bots, all blue (Simpson D = 0)
        # Group B: 200 bots, 50/50 split (Simpson D = 0.5)
        group_a = diverse_bots('color', {'blue': 800})
        group_b = diverse_bots('color', {'blue': 100, 'red': 100})
        fst = tracker.get_fixation_index('color', [group_a, group_b])
        assert fst is not None
        # Weighted Hs = (800/1000)*0.0 + (200/1000)*0.5 = 0.1
        # Ht for 900 blue, 100 red out of 1000 = 1 - (0.9^2 + 0.1^2) = 0.18
        # Fst = (0.18 - 0.1) / 0.18 ≈ 0.44
        assert 0.3 < fst < 0.6, f"Expected Fst ~0.44, got {fst}"

    def test_fixation_index_equal_sizes_unchanged(self):
        """Equal-sized groups should give same result as before (backward compat)."""
        tracker = EvolutionTracker(traits=['color'])
        group1 = diverse_bots('color', {'red': 100, 'blue': 100})
        group2 = diverse_bots('color', {'red': 100, 'blue': 100})
        fst = tracker.get_fixation_index('color', [group1, group2])
        assert fst is not None
        # Identical groups → no differentiation
        assert abs(fst) < 0.01

    def test_fixation_index_three_unequal_groups(self):
        """Weighted Fst with 3 groups of different sizes."""
        tracker = EvolutionTracker(traits=['color'])
        group_a = diverse_bots('color', {'red': 500})
        group_b = diverse_bots('color', {'blue': 300})
        group_c = diverse_bots('color', {'red': 100, 'blue': 100})
        fst = tracker.get_fixation_index('color', [group_a, group_b, group_c])
        assert fst is not None
        assert fst > 0.0
        assert fst <= 1.0

    def test_fixation_index_single_bot_groups(self):
        """Edge case: groups with 1 bot each (Simpson D = 0 for all)."""
        tracker = EvolutionTracker(traits=['color'])
        g1 = [{'traits': {'color': 'red'}}]
        g2 = [{'traits': {'color': 'blue'}}]
        fst = tracker.get_fixation_index('color', [g1, g2])
        # Ht = 0.5 (50/50), each subgroup Hs = 0
        # Fst = (0.5 - 0) / 0.5 = 1.0 (complete differentiation)
        assert fst is not None
        assert abs(fst - 1.0) < 0.01

    def test_fixation_index_range_0_to_1(self):
        """Fst should always be in [0, 1] for reasonable inputs."""
        tracker = EvolutionTracker(traits=['t'])
        for _ in range(20):
            import random
            sizes = [random.randint(10, 500) for _ in range(random.randint(2, 5))]
            groups = []
            for s in sizes:
                dist = {}
                for c in ['A', 'B', 'C', 'D']:
                    n = random.randint(0, s)
                    if n > 0:
                        dist[c] = n
                if not dist:
                    dist['A'] = s
                groups.append(diverse_bots('t', dist))
            fst = tracker.get_fixation_index('t', groups)
            if fst is not None:
                assert fst >= -0.001, f"Fst={fst} is negative"
                assert fst <= 1.001, f"Fst={fst} exceeds 1"


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


# ============================================================
# Boundary Frequency Tests (Issue #15)
# ============================================================

class TestBoundaryFrequencyFix:
    """Tests for the selection coefficient boundary fix.

    The Wright-Fisher selection coefficient s ≈ Δp / [p(1-p)] is only valid
    when the previous allele frequency is in the interior of (0, 1). At
    boundaries (near 0 or 1), p*(1-p) → 0 and the coefficient blows up.
    The fix skips alleles where prev_freq < 0.01 or prev_freq > 0.99.
    """

    def test_zero_frequency_no_event(self):
        """Allele at 0% (new allele appearing) should not trigger selection."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        assert len(b_events) == 0

    def test_full_frequency_no_event(self):
        """Allele at 100% (near fixation) should not trigger selection."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        tracker.record_generation(1, diverse_bots('x', {'A': 90, 'B': 10}))
        events = tracker.get_selection_events('x')
        a_events = [e for e in events if e.allele == 'A']
        assert len(a_events) == 0

    def test_near_zero_boundary(self):
        """Allele at 0.5% (below 1% threshold) should be skipped."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.01)
        # 200 bots: 1 with B (0.5%), 199 with A (99.5%)
        tracker.record_generation(0, diverse_bots('x', {'A': 199, 'B': 1}))
        # Shift B to 10%
        tracker.record_generation(1, diverse_bots('x', {'A': 180, 'B': 20}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        # B prev_freq = 0.005 < 0.01 → skipped
        assert len(b_events) == 0

    def test_near_one_boundary(self):
        """Allele at 99.5% (above 99% threshold) should be skipped."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.01)
        tracker.record_generation(0, diverse_bots('x', {'A': 199, 'B': 1}))
        tracker.record_generation(1, diverse_bots('x', {'A': 180, 'B': 20}))
        events = tracker.get_selection_events('x')
        a_events = [e for e in events if e.allele == 'A']
        # A prev_freq = 0.995 > 0.99 → skipped
        assert len(a_events) == 0

    def test_interior_frequency_produces_event(self):
        """Allele well within (0.01, 0.99) should still trigger selection."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 50, 'B': 50}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        events = tracker.get_selection_events('x')
        # Both A and B are at 0.5 prev_freq — well in interior
        assert len(events) >= 1
        a_events = [e for e in events if e.allele == 'A']
        b_events = [e for e in events if e.allele == 'B']
        if a_events:
            assert a_events[0].direction == 'positive'
        if b_events:
            assert b_events[0].direction == 'negative'

    def test_coefficient_clamped_to_range(self):
        """Even in the interior, coefficient should be clamped to [-10, 10]."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.01)
        # prev_freq = 0.02 → p*(1-p) = 0.0196, delta = 0.48
        # Unclamped: 0.48 / 0.0196 ≈ 24.5 → should be clamped to 10.0
        tracker.record_generation(0, diverse_bots('x', {'A': 98, 'B': 2}))
        tracker.record_generation(1, diverse_bots('x', {'A': 50, 'B': 50}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        if b_events:
            assert b_events[0].coefficient <= 10.0
            assert b_events[0].coefficient >= -10.0

    def test_negative_coefficient_clamped(self):
        """Large negative selection should also be clamped."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.01)
        # B at 97% → p*(1-p) = 0.0291, delta from 97% to 50% = -0.47
        # Unclamped: -0.47 / 0.0291 ≈ -16.2 → clamped to -10.0
        tracker.record_generation(0, diverse_bots('x', {'A': 3, 'B': 97}))
        tracker.record_generation(1, diverse_bots('x', {'A': 50, 'B': 50}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        if b_events:
            assert b_events[0].coefficient >= -10.0

    def test_allele_disappears_from_interior(self):
        """Allele disappearing from interior (prev_freq=0.2) should work."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        tracker.record_generation(0, diverse_bots('x', {'A': 80, 'B': 20}))
        tracker.record_generation(1, diverse_bots('x', {'A': 100}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        # B prev_freq=0.2 is in interior → should produce event
        assert len(b_events) == 1
        assert b_events[0].direction == 'negative'

    def test_just_above_lower_boundary(self):
        """Allele at exactly 1% (0.01) should produce event (boundary is <0.01)."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        # 100 bots: 1 with B (1%), 99 with A (99%)
        # A at 99% is > 0.99 → skipped
        # B at 1% is >= 0.01 → should produce event
        tracker.record_generation(0, diverse_bots('x', {'A': 99, 'B': 1}))
        tracker.record_generation(1, diverse_bots('x', {'A': 80, 'B': 20}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        assert len(b_events) == 1
        assert b_events[0].direction == 'positive'

    def test_multiple_generations_boundary_then_interior(self):
        """Allele that starts at boundary then moves to interior."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        # Gen 0: B at 0% (boundary)
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        # Gen 1: B at 10% (B boundary skipped, A boundary skipped)
        tracker.record_generation(1, diverse_bots('x', {'A': 90, 'B': 10}))
        # Gen 2: B at 30% (B prev=10% in interior → event!)
        tracker.record_generation(2, diverse_bots('x', {'A': 70, 'B': 30}))
        events = tracker.get_selection_events('x')
        b_events = [e for e in events if e.allele == 'B']
        # Only gen 1→2 should produce B event (gen 0→1 is boundary)
        assert len(b_events) == 1
        assert b_events[0].generation == 2

    def test_no_events_when_both_alleles_at_boundary(self):
        """When all alleles are at boundary, no events should fire."""
        tracker = EvolutionTracker(traits=['x'], selection_threshold=0.05)
        # Only one allele at 100%
        tracker.record_generation(0, diverse_bots('x', {'A': 100}))
        # Still only one allele at 100%
        tracker.record_generation(1, diverse_bots('x', {'B': 100}))
        events = tracker.get_selection_events('x')
        # A: prev_freq=1.0 (boundary), B: prev_freq=0.0 (boundary)
        assert len(events) == 0
