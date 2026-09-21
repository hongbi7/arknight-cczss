"""Regression checks for race-question candidate coverage."""

import math
import random
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from build_anomaly_data import candidate_option_ids


class RaceCandidateTests(unittest.TestCase):
    def test_small_groups_cover_majorities_before_reusing_them(self):
        inside = list("abcdef")
        outside = list("xyz")
        first_pass = list(candidate_option_ids(
            inside, outside, random.Random(7),
            max_attempts=math.comb(len(inside), 3), spread_majorities=True,
        ))
        self.assertEqual(len({tuple(sorted(ids[:3])) for ids in first_pass}), 20)
        self.assertEqual({ids[3] for ids in first_pass}, set(outside))

    def test_exhaustive_search_has_no_duplicates_or_missing_combinations(self):
        inside = list("abcde")
        outside = list("xyz")
        candidates = list(candidate_option_ids(
            inside, outside, random.Random(9), max_attempts=1000,
            spread_majorities=True,
        ))
        keys = {(tuple(sorted(ids[:3])), ids[3]) for ids in candidates}
        self.assertEqual(len(candidates), math.comb(5, 3) * 3)
        self.assertEqual(len(keys), len(candidates))
        for ids in candidates:
            self.assertEqual(len(set(ids)), 4)
            self.assertTrue(set(ids[:3]) <= set(inside))
            self.assertIn(ids[3], outside)

    def test_extended_budget_and_seed_are_respected_for_large_groups(self):
        def generate():
            return list(candidate_option_ids(
                list(range(30)), [100, 101], random.Random(42),
                max_attempts=24001, spread_majorities=True,
            ))

        first = generate()
        self.assertEqual(len(first), 24001)
        self.assertEqual(first, generate())


if __name__ == "__main__":
    unittest.main()
