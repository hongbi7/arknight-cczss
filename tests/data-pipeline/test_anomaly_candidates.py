"""Regression checks for anomaly candidate coverage and ambiguity."""

import math
import random
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from build_anomaly_data import (
    build_domain_audit, candidate_option_ids, has_competing_odd,
    select_diverse_questions, tuple_odd_indexes, context_facets,
    shared_context_candidates, shared_context_score, distractor_score,
)


class AnomalyCandidateTests(unittest.TestCase):
    def test_each_domain_has_relevant_backgrounds_without_fixing_its_answer(self):
        cases = [
            ("roster.profession.medic", "position", "profession"),
            ("roster.subprofession.physician", "profession", "subProfessionId"),
            ("roster.position.ranged", "profession", "position"),
            ("skill.count.3", "profession", "skillCount"),
            ("skill.damaged_recovery", "skillCount", None),
            ("battle.stun", "subProfessionId", None),
            ("logistics.base_room.factory", "obtain", None),
            ("logistics.obtain.activity", "profession", "obtain"),
            ("logistics.limited", "profession", "obtain"),
            ("visual.illustrator.example", "profession", None),
            ("visual.outfit_brand.example", "race", None),
        ]
        for rule_id, shared, excluded in cases:
            with self.subTest(rule=rule_id):
                rule = {"id": rule_id}
                self.assertIn(shared, context_facets(rule))
                if excluded:
                    self.assertNotIn(excluded, context_facets(rule))
                records = {oid: {} for oid in "abcxy"}
                for oid in "abcx":
                    if shared in ("skillCount", "obtain"):
                        records[oid]["_context"] = {shared: 3 if shared == "skillCount" else "活动获得"}
                    else:
                        records[oid][shared] = "same"
                generated = list(shared_context_candidates(rule, list("abc"), list("xy"), records, random.Random(7)))
                self.assertEqual(generated, [list("abcx")])
                self.assertGreater(shared_context_score(rule, list("abcx"), records), 0)
                self.assertEqual(shared_context_score(rule, list("abcy"), records), 0)

    def test_faction_question_prefers_same_race_distractor(self):
        records = {oid: {"race": "菲林", "origin": None, "power": {"id": "a"},
                         "familiarityScore": 60, "profession": "MEDIC", "position": "RANGED", "rarity": 5}
                   for oid in "abcxy"}
        records["x"]["power"] = {"id": "b"}
        records["y"]["power"] = {"id": "b"}
        records["y"]["race"] = "佩洛"
        rule = {"id": "identity.power.a"}
        self.assertGreater(distractor_score(list("abcx"), records, rule),
                           distractor_score(list("abcy"), records, rule))
        candidates = list(shared_context_candidates(rule, list("abc"), list("xy"), records, random.Random(1)))
        self.assertEqual(candidates, [list("abcx")])

    def test_shared_context_excludes_the_tested_facet_and_missing_values(self):
        for prefix in ["power", "power_root", "secondary_power"]:
            self.assertNotIn("power", context_facets({"id": f"identity.{prefix}.a"}))
        self.assertNotIn("race", context_facets({"id": "identity.race.a"}))
        self.assertNotIn("origin", context_facets({"id": "identity.origin.a"}))
        for missing in [None, "未录入", "未公开", "未知"]:
            records = {oid: {"race": missing, "origin": missing} for oid in "abcx"}
            rule = {"id": "identity.power.a"}
            self.assertEqual(shared_context_score(rule, list("abcx"), records), 0)
            self.assertEqual(list(shared_context_candidates(
                rule, list("abc"), ["x"], records, random.Random(1))), [])

    def test_race_question_can_share_faction_without_requiring_same_race(self):
        records = {oid: {"race": "菲林", "power": {"id": "rhodes"}} for oid in "abcx"}
        records["x"]["race"] = "佩洛"
        rule = {"id": "identity.race.feline"}
        self.assertEqual(shared_context_score(rule, list("abcx"), records), 80)
        self.assertEqual(list(shared_context_candidates(
            rule, list("abc"), ["x"], records, random.Random(1))), [list("abcx")])

    def test_fast_rejection_matches_full_audit_for_all_membership_patterns(self):
        ids = list("abcd")
        target = {"id": "target", "_memberSet": set("abc")}
        for pattern in range(16):
            other = {"id": "other", "_memberSet": {
                oid for index, oid in enumerate(ids) if pattern & (1 << index)
            }}
            audit = build_domain_audit([target, other], ids)
            for inverse in [True, False]:
                self.assertEqual(
                    has_competing_odd(ids, audit, inverse),
                    tuple_odd_indexes(ids, audit, inverse)[0] != {3},
                )

    def test_swapping_only_the_odd_operator_does_not_add_a_question_type(self):
        candidates = [
            {"id": "a", "majorityIds": ["a", "b", "c"], "oddId": "x", "distractorScore": 10},
            {"id": "b", "majorityIds": ["c", "a", "b"], "oddId": "y", "distractorScore": 20},
            {"id": "c", "majorityIds": ["a", "b", "d"], "oddId": "x", "distractorScore": 5},
        ]
        selected = select_diverse_questions(candidates, 40)
        self.assertEqual(len(selected), 2)
        self.assertEqual({question["id"] for question in selected}, {"b", "c"})

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
