"""Read-only audit of anomaly generation coverage; never rewrites game data."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import time

import build_anomaly_data as builder


def competing_odd(ids, audit, include_inverse):
    masks = [audit["operatorMasks"][oid] for oid in ids]
    for index in range(3):
        others = [masks[k] for k in range(4) if k != index]
        if others[0] & others[1] & others[2] & ~masks[index]:
            return True
        if include_inverse and ~others[0] & ~others[1] & ~others[2] & masks[index]:
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempts", type=int, default=192000)
    parser.add_argument("--pool", type=int, default=240)
    parser.add_argument("--output", type=Path, default=builder.WORK_DIR / "anomaly-coverage-audit.json")
    args = parser.parse_args()
    if args.attempts < 1 or args.pool < 1:
        parser.error("attempts and pool must be positive")
    root = builder.find_excel_root()
    operators = builder.load_json(builder.SERVER_DATA / "operators.json")
    themes = builder.canonical_themes(operators, root, builder.load_json(builder.ROOT / "scripts/theme-overrides.json"))
    bank, by_id = builder.build_rules(root, operators, themes,
        builder.load_json(builder.SERVER_DATA / "operator-identities.json"),
        builder.load_json(builder.ROOT / "scripts/anomaly-rule-overrides.json"))
    stored_rules = builder.load_json(builder.OUT_RULES)["definitions"]
    stored = builder.load_json(builder.OUT_QUESTIONS)["questions"]
    buckets = defaultdict(list)
    for question in stored:
        buckets[(question["ruleId"], question["difficulty"])].append(question)
    all_ids = sorted(by_id)
    audits = {domain: builder.build_domain_audit([r for r in bank.rules if r["domain"] == domain], all_ids)
              for domain in builder.DOMAIN_LABELS}
    global_audit = builder.build_domain_audit(bank.rules, all_ids)
    # Cross-check the fast predicate against the builder on real target-rule candidates.
    checked = 0
    for rule in bank.rules[:20]:
        inside = sorted(rule["_memberSet"])
        outside = sorted(set(all_ids) - rule["_memberSet"])
        for ids in builder.candidate_option_ids(inside, outside, random.Random(1), max_attempts=20):
            for audit, inverse in [(audits[rule["domain"]], True), (global_audit, False)]:
                assert competing_odd(ids, audit, inverse) == (builder.tuple_odd_indexes(ids, audit, inverse)[0] != {3})
                checked += 1
    rows = []
    started = time.monotonic()
    for rule_index, rule in enumerate(bank.rules):
        for difficulty, config in builder.DIFFICULTIES.items():
            previous = buckets[(rule["id"], difficulty)]
            row = {"ruleId": rule["id"], "title": rule["title"], "domain": rule["domain"],
                   "difficulty": difficulty, "stored": len(previous), "enabled": rule["id"] in stored_rules}
            if rule["difficulty"] > config["level"]:
                row["reason"] = "rule_difficulty_gate"
                rows.append(row)
                continue
            eligible = [oid for oid in all_ids if by_id[oid].get("familiarityScore", 0) >= config["min"]]
            inside = [oid for oid in eligible if oid in rule["_memberSet"] and
                      (rule.get("_eligibleMemberIds") is None or oid in rule["_eligibleMemberIds"])]
            outside = [oid for oid in eligible if oid not in rule["_memberSet"] and
                       (rule.get("_eligibleOddIds") is None or oid in rule["_eligibleOddIds"])]
            combinations = math.comb(len(inside), 3) * len(outside) if len(inside) >= 3 else 0
            row.update(eligibleMembers=len(inside), eligibleOdd=len(outside), combinations=combinations)
            if not combinations:
                row["reason"] = "insufficient_eligible_operators"
                rows.append(row)
                continue
            seed = int(hashlib.sha256((rule["id"] + ":" + difficulty + ":coverage-audit-v1").encode()).hexdigest()[:16], 16)
            found = []
            seen = set()
            rejects = Counter()
            attempts = 0
            for ids in builder.candidate_option_ids(inside, outside, random.Random(seed),
                                                   max_attempts=args.attempts, spread_majorities=True):
                attempts += 1
                if not builder.meets_rule_constraints(rule, ids, by_id):
                    rejects["rule_constraints"] += 1
                    continue
                if not builder.meets_difficulty(ids, by_id, difficulty):
                    rejects["familiarity"] += 1
                    continue
                if builder.protected_facet_collisions(ids, by_id):
                    rejects["rarity_shortcut"] += 1
                    continue
                if competing_odd(ids, audits[rule["domain"]], True):
                    rejects["same_domain_ambiguity"] += 1
                    continue
                if competing_odd(ids, global_audit, False):
                    rejects["cross_domain_ambiguity"] += 1
                    continue
                # 只替换异类不算新题型；搜索预算按共性三人组覆盖来评估。
                key = tuple(sorted(ids[:3]))
                if key in seen:
                    continue
                seen.add(key)
                found.append(ids)
                if len(found) >= args.pool:
                    break
            stored_majorities = {tuple(q["majorityIds"]) for q in previous}
            new_majorities = {tuple(sorted(ids[:3])) for ids in found}
            cap = builder.RACE_TARGET_PER_DIFFICULTY if rule["id"].startswith("identity.race.") else builder.TARGET_PER_RULE_AND_DIFFICULTY
            row.update(attempts=attempts, found=len(found), storedMajorities=len(stored_majorities),
                       foundMajorities=len(new_majorities), newMajorities=len(new_majorities-stored_majorities),
                       target=cap, rejects=dict(rejects),
                       exhaustive=(len(inside) <= builder.EXHAUSTIVE_MAJORITY_LIMIT and attempts == combinations))
            row["reason"] = "probed"
            rows.append(row)
        if rule_index % 25 == 0:
            print(json.dumps({"rulesAudited":rule_index+1,"total":len(bank.rules),"seconds":round(time.monotonic()-started)}), flush=True)
    output = {"builderVersion":builder.BUILDER_VERSION, "attemptBudget":args.attempts, "poolCap":args.pool,
              "fastPredicateChecks":checked,"seconds":round(time.monotonic()-started),
              "storedQuestions":len(stored),"rows":rows,"excludedRules":bank.disabled}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output":str(args.output),"rows":len(rows),"seconds":output["seconds"]}),flush=True)


if __name__ == "__main__":
    main()
