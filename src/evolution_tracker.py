"""
evolution_tracker.py — Population Genetics & Evolution Analysis

Tracks genetic traits across generations, computes diversity metrics,
detects evolutionary pressure, and records allele frequency history.

Metrics:
- Shannon diversity index (H) — information entropy of trait distribution
- Simpson's diversity index (D) — probability two random bots differ
- Heterozygosity — fraction of population with non-modal trait values
- Allele frequency — proportion of each trait value in the population
- Selection coefficient — rate of change in allele frequency per generation
- Effective population size (Ne) — genetic diversity-adjusted count
- Fixation index (Fst) — population differentiation between subgroups
"""

import math
from collections import Counter
from typing import Any


class TraitSnapshot:
    """A snapshot of a single trait's distribution at one generation."""

    __slots__ = ('trait_name', 'generation', 'frequencies', 'total',
                 'shannon', 'simpson', 'heterozygosity', 'modal_value')

    def __init__(self, trait_name: str, generation: int,
                 values: list[Any]):
        self.trait_name = trait_name
        self.generation = generation
        self.total = len(values)

        counts = Counter(values)
        self.frequencies = {
            k: v / self.total for k, v in counts.items()
        } if self.total > 0 else {}

        self.modal_value = counts.most_common(1)[0][0] if counts else None

        # Shannon diversity: H = -sum(p * ln(p))
        self.shannon = 0.0
        for freq in self.frequencies.values():
            if freq > 0:
                self.shannon -= freq * math.log(freq)

        # Simpson's diversity: D = 1 - sum(p^2)
        self.simpson = 1.0 - sum(f ** 2 for f in self.frequencies.values())

        # Heterozygosity: fraction with non-modal value
        if self.total > 0 and self.modal_value is not None:
            modal_count = counts.get(self.modal_value, 0)
            self.heterozygosity = 1.0 - (modal_count / self.total)
        else:
            self.heterozygosity = 0.0

    def to_dict(self) -> dict:
        return {
            'trait': self.trait_name,
            'generation': self.generation,
            'total': self.total,
            'frequencies': dict(self.frequencies),
            'modal_value': self.modal_value,
            'shannon': round(self.shannon, 6),
            'simpson': round(self.simpson, 6),
            'heterozygosity': round(self.heterozygosity, 6),
        }


class SelectionEvent:
    """Detected evolutionary pressure on a trait."""

    __slots__ = ('trait_name', 'allele', 'generation', 'coefficient',
                 'direction', 'prev_freq', 'curr_freq')

    def __init__(self, trait_name: str, allele: Any, generation: int,
                 coefficient: float, prev_freq: float, curr_freq: float):
        self.trait_name = trait_name
        self.allele = allele
        self.generation = generation
        self.coefficient = coefficient
        self.prev_freq = prev_freq
        self.curr_freq = curr_freq
        self.direction = 'positive' if coefficient > 0 else 'negative'

    def to_dict(self) -> dict:
        return {
            'trait': self.trait_name,
            'allele': self.allele,
            'generation': self.generation,
            'coefficient': round(self.coefficient, 6),
            'direction': self.direction,
            'prev_freq': round(self.prev_freq, 6),
            'curr_freq': round(self.curr_freq, 6),
        }


class EvolutionTracker:
    """Track genetic evolution across generations in a bot population.

    Usage:
        tracker = EvolutionTracker(traits=['speed', 'size', 'color'])
        tracker.record_generation(generation=0, bots=population)
        tracker.record_generation(generation=1, bots=population)
        report = tracker.get_report()
    """

    # Minimum frequency change per generation to flag as selection
    SELECTION_THRESHOLD = 0.05

    def __init__(self, traits: list[str] | None = None,
                 selection_threshold: float | None = None):
        """
        Args:
            traits: List of trait names to track. If None, auto-discovers
                    from first recorded generation.
            selection_threshold: Minimum allele frequency change per
                                generation to flag as evolutionary pressure.
        """
        self.traits = list(traits) if traits else []
        self.selection_threshold = (
            selection_threshold
            if selection_threshold is not None
            else self.SELECTION_THRESHOLD
        )
        self._history: dict[str, list[TraitSnapshot]] = {}
        self._selection_events: list[SelectionEvent] = []
        self._generations_recorded = 0

    def record_generation(self, generation: int, bots: list) -> dict[str, TraitSnapshot]:
        """Record trait distributions for a generation of bots.

        Args:
            generation: The generation number.
            bots: List of bot objects with a 'traits' dict attribute.

        Returns:
            Dict mapping trait names to their TraitSnapshot for this generation.
        """
        # Auto-discover traits from first bot if not set
        if not self.traits and bots:
            first = bots[0]
            traits_dict = (
                first.traits if hasattr(first, 'traits')
                else first.get('traits', {}) if isinstance(first, dict)
                else {}
            )
            self.traits = sorted(traits_dict.keys())

        snapshots = {}
        for trait in self.traits:
            values = []
            for bot in bots:
                if hasattr(bot, 'traits'):
                    val = bot.traits.get(trait)
                elif isinstance(bot, dict):
                    val = bot.get('traits', {}).get(trait)
                else:
                    val = None
                if val is not None:
                    values.append(val)

            snapshot = TraitSnapshot(trait, generation, values)
            snapshots[trait] = snapshot

            if trait not in self._history:
                self._history[trait] = []
            self._history[trait].append(snapshot)

            # Detect selection pressure
            self._detect_selection(trait, snapshot)

        self._generations_recorded += 1
        return snapshots

    def _detect_selection(self, trait: str, current: TraitSnapshot):
        """Compare current snapshot to previous and detect selection."""
        history = self._history.get(trait, [])
        if len(history) < 2:
            return

        previous = history[-2]
        all_alleles = set(previous.frequencies.keys()) | set(current.frequencies.keys())

        for allele in all_alleles:
            prev_freq = previous.frequencies.get(allele, 0.0)
            curr_freq = current.frequencies.get(allele, 0.0)
            delta = curr_freq - prev_freq

            if abs(delta) >= self.selection_threshold:
                # Selection coefficient: s ≈ Δp / (p * (1-p))
                # This formula is derived from the Wright-Fisher model and is
                # only valid in the interior of (0, 1). At boundary frequencies
                # (near 0 or 1), p*(1-p) → 0 and the coefficient blows up,
                # producing biologically implausible values (e.g., s=100).
                # Skip boundary alleles where the formula doesn't apply.
                if prev_freq < 0.01 or prev_freq > 0.99:
                    continue

                denom = prev_freq * (1 - prev_freq)
                # Defensive clamp — shouldn't trigger given the boundary check
                # above, but guards against floating-point edge cases.
                denom = max(denom, 0.001)
                coefficient = delta / denom

                # Clamp to biologically plausible range. Real-world selection
                # coefficients rarely exceed ±1.0; values beyond ±10 are
                # almost certainly artifacts.
                coefficient = max(-10.0, min(10.0, coefficient))

                event = SelectionEvent(
                    trait_name=trait,
                    allele=allele,
                    generation=current.generation,
                    coefficient=coefficient,
                    prev_freq=prev_freq,
                    curr_freq=curr_freq,
                )
                self._selection_events.append(event)

    def get_diversity(self, trait: str) -> float | None:
        """Get the latest Shannon diversity for a trait."""
        history = self._history.get(trait, [])
        return history[-1].shannon if history else None

    def get_heterozygosity(self, trait: str) -> float | None:
        """Get the latest heterozygosity for a trait."""
        history = self._history.get(trait, [])
        return history[-1].heterozygosity if history else None

    def get_frequencies(self, trait: str) -> dict[Any, float]:
        """Get the latest allele frequencies for a trait."""
        history = self._history.get(trait, [])
        return dict(history[-1].frequencies) if history else {}

    def get_frequency_history(self, trait: str,
                              allele: Any) -> list[tuple[int, float]]:
        """Get frequency of a specific allele across all generations.

        Returns list of (generation, frequency) tuples.
        """
        history = self._history.get(trait, [])
        return [
            (snap.generation, snap.frequencies.get(allele, 0.0))
            for snap in history
        ]

    def get_selection_events(self, trait: str | None = None) -> list[SelectionEvent]:
        """Get detected selection events, optionally filtered by trait."""
        if trait is None:
            return list(self._selection_events)
        return [e for e in self._selection_events if e.trait_name == trait]

    def get_effective_population_size(self, trait: str) -> float | None:
        """Estimate effective population size (Ne) from heterozygosity.

        Uses: Ne ≈ H / (1 - H) for a neutral locus.
        """
        h = self.get_heterozygosity(trait)
        if h is None or h >= 1.0:
            return None
        if h <= 0.0:
            return 0.0
        return h / (1.0 - h)

    def get_fixation_index(self, trait: str,
                           subgroups: list[list] | None = None) -> float | None:
        """Calculate Wright's Fst between subgroups for a trait.

        Fst = (Ht - mean(Hs)) / Ht
        where Ht = total heterozygosity, Hs = subgroup heterozygosity.

        If subgroups not provided, returns None.
        """
        if subgroups is None or len(subgroups) < 2:
            return None

        # Total population
        all_bots = [b for group in subgroups for b in group]
        total_snap = self._make_snapshot(trait, all_bots)
        ht = total_snap.simpson  # Using Simpson's D as heterozygosity proxy

        if ht <= 0:
            return 0.0

        # Mean subgroup heterozygosity (weighted by subgroup size)
        hs_values = []
        group_sizes = []
        for group in subgroups:
            if group:
                sub_snap = self._make_snapshot(trait, group)
                hs_values.append(sub_snap.simpson)
                group_sizes.append(len(group))

        if not hs_values:
            return None

        total_n = sum(group_sizes)
        if total_n == 0:
            return None
        mean_hs = sum(n / total_n * hs for n, hs in zip(group_sizes, hs_values))
        return (ht - mean_hs) / ht

    def _make_snapshot(self, trait: str, bots: list) -> TraitSnapshot:
        """Create a TraitSnapshot from bots without recording it."""
        values = []
        for bot in bots:
            if hasattr(bot, 'traits'):
                val = bot.traits.get(trait)
            elif isinstance(bot, dict):
                val = bot.get('traits', {}).get(trait)
            else:
                val = None
            if val is not None:
                values.append(val)
        return TraitSnapshot(trait, -1, values)

    def get_diversity_trend(self, trait: str) -> str:
        """Classify the diversity trend for a trait: increasing, stable, or decreasing."""
        history = self._history.get(trait, [])
        if len(history) < 3:
            return 'insufficient_data'

        recent = [s.shannon for s in history[-3:]]
        delta = recent[-1] - recent[0]

        if delta > 0.05:
            return 'increasing'
        elif delta < -0.05:
            return 'decreasing'
        return 'stable'

    @property
    def generations_recorded(self) -> int:
        return self._generations_recorded

    @property
    def tracked_traits(self) -> list[str]:
        return list(self.traits)

    def get_report(self) -> dict:
        """Generate a comprehensive evolution report."""
        report = {
            'generations_recorded': self._generations_recorded,
            'traits': {},
            'selection_events': [e.to_dict() for e in self._selection_events],
        }

        for trait in self.traits:
            history = self._history.get(trait, [])
            if not history:
                continue

            latest = history[-1]
            report['traits'][trait] = {
                'current': latest.to_dict(),
                'diversity_trend': self.get_diversity_trend(trait),
                'effective_population_size': self.get_effective_population_size(trait),
                'allele_count': len(latest.frequencies),
                'generations_tracked': len(history),
            }

        return report

    def summary(self) -> str:
        """Human-readable summary string."""
        lines = [f"Evolution Tracker — {self._generations_recorded} generations, {len(self.traits)} traits"]
        for trait in self.traits:
            h = self._history.get(trait, [])
            if not h:
                continue
            latest = h[-1]
            lines.append(
                f"  {trait}: Shannon={latest.shannon:.3f}, "
                f"Simpson={latest.simpson:.3f}, "
                f"H={latest.heterozygosity:.3f}, "
                f"alleles={len(latest.frequencies)}, "
                f"trend={self.get_diversity_trend(trait)}"
            )
        sel = len(self._selection_events)
        if sel:
            lines.append(f"  Selection events: {sel}")
        return '\n'.join(lines)
