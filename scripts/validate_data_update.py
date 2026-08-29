# -*- coding: utf-8 -*-
"""Validate generated game data and write a deterministic update report."""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = PROJECT_ROOT / ".update-work" / "data-update-report.json"
DEFAULT_VERSION = PROJECT_ROOT / "server-data" / "data-version.json"
GENERATED_DATA_FILES = (
    "public/data/names.json",
    "server-data/operators.json",
    "server-data/operator-archives.json",
    "server-data/operator-clues.json",
    "server-data/operator-familiarity.json",
    "server-data/operator-identities.json",
    "server-data/operator-themes.json",
    "server-data/operator-brand-art.json",
    "server-data/anomaly-rules.json",
    "server-data/anomaly-questions.json",
)

EXPECTED_ANOMALY_DOMAINS = {"roster", "identity", "skill", "battle", "logistics", "visual"}
EXPECTED_ANOMALY_DIFFICULTIES = {"trainee", "standard", "hazard"}
MIN_ANOMALY_BUCKET_SIZE = 60


def load_json(relative_path):
    path = PROJECT_ROOT / relative_path
    if not path.is_file():
        raise FileNotFoundError(f"Generated file does not exist: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def public_asset_exists(url):
    if not url or not url.startswith("/"):
        return False
    path = (PROJECT_ROOT / "public" / url.lstrip("/")).resolve()
    public_root = (PROJECT_ROOT / "public").resolve()
    try:
        path.relative_to(public_root)
    except ValueError:
        return False
    return path.is_file()


def file_digest(relative_path):
    path = PROJECT_ROOT / relative_path
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"bytes": path.stat().st_size, "sha256": digest}


def validate(source):
    operators = load_json("server-data/operators.json")
    archives = load_json("server-data/operator-archives.json")
    clues = load_json("server-data/operator-clues.json")
    familiarity = load_json("server-data/operator-familiarity.json")
    identities = load_json("server-data/operator-identities.json")
    themes = load_json("server-data/operator-themes.json")
    anomaly_rules = load_json("server-data/anomaly-rules.json")
    anomaly_questions = load_json("server-data/anomaly-questions.json")
    names = load_json("public/data/names.json")
    operator_art = load_json("public/data/operator-art.json")
    attention_path = PROJECT_ROOT / "scripts" / "operator-attention-signals.json"
    attention = json.loads(attention_path.read_text(encoding="utf-8")) if attention_path.is_file() else {}
    attention_records = attention.get("operators", {})
    attention_weights_path = PROJECT_ROOT / "scripts" / "popularity-source-weights.json"
    attention_weights = (
        json.loads(attention_weights_path.read_text(encoding="utf-8"))
        if attention_weights_path.is_file() else {}
    )

    operator_ids = {record.get("id") for record in operators.values() if record.get("id")}
    operator_by_id = {
        record.get("id"): record for record in operators.values() if record.get("id")
    }
    operator_names = set(operators)
    name_index = {record.get("n") for record in names if record.get("n")}

    structural_errors = []

    anomaly_definitions = anomaly_rules.get("definitions") or {}
    anomaly_question_list = anomaly_questions.get("questions") or []
    anomaly_domains = set((anomaly_rules.get("domains") or {}).keys())
    anomaly_difficulties = set((anomaly_rules.get("difficulties") or {}).keys())
    if anomaly_rules.get("schemaVersion") != 1 or anomaly_questions.get("schemaVersion") != 1:
        structural_errors.append("anomaly data schemaVersion must be 1")
    if anomaly_rules.get("sourceFingerprint") != anomaly_questions.get("sourceFingerprint"):
        structural_errors.append("anomaly rule and question source fingerprints differ")
    if anomaly_domains != EXPECTED_ANOMALY_DOMAINS:
        structural_errors.append(
            f"anomaly domains differ (actual={sorted(anomaly_domains)})"
        )
    if anomaly_difficulties != EXPECTED_ANOMALY_DIFFICULTIES:
        structural_errors.append(
            f"anomaly difficulties differ (actual={sorted(anomaly_difficulties)})"
        )

    forbidden_rule_parts = {
        "rarity", "tag", "tags", "cv", "voice", "charword",
        "birthday", "height", "combat_experience", "battle_experience",
    }
    rule_members = {}
    for rule_id, rule in anomaly_definitions.items():
        members = set(rule.get("members") or [])
        rule_members[rule_id] = members
        if rule.get("id") != rule_id:
            structural_errors.append(f"anomaly rule key/id mismatch: {rule_id}")
        if rule.get("domain") not in EXPECTED_ANOMALY_DOMAINS:
            structural_errors.append(f"anomaly rule {rule_id} has invalid domain")
        if len(members) < 3:
            structural_errors.append(f"anomaly rule {rule_id} has fewer than three members")
        if rule.get("memberCount") != len(members):
            structural_errors.append(f"anomaly rule {rule_id} memberCount is inconsistent")
        unknown = sorted(members - operator_ids)
        if unknown:
            structural_errors.append(f"anomaly rule {rule_id} has unknown operators: {unknown[:8]}")
        source_head = str(rule.get("source") or "").lower().split(":", 1)[0]
        id_parts = set(rule_id.lower().replace("-", "_").split("."))
        source_parts = set(source_head.replace("-", "_").split("."))
        if id_parts & forbidden_rule_parts or source_parts & forbidden_rule_parts:
            structural_errors.append(f"anomaly rule {rule_id} uses a forbidden dimension")
        if rule.get("domain") == "roster" and ({"rarity", "tag", "tags"} & (id_parts | source_parts)):
            structural_errors.append(f"roster rule {rule_id} uses rarity or tags")
        if rule.get("domain") == "visual" and ({"cv", "voice", "charword"} & (id_parts | source_parts)):
            structural_errors.append(f"visual rule {rule_id} uses CV data")
        if "module_count" in rule_id or "uniequip.charequip" in source_head:
            structural_errors.append(f"anomaly rule {rule_id} uses the removed module-count type")

    question_ids = set()
    anomaly_buckets = {
        f"{domain}:{difficulty}": 0
        for domain in EXPECTED_ANOMALY_DOMAINS
        for difficulty in EXPECTED_ANOMALY_DIFFICULTIES
    }
    for question in anomaly_question_list:
        question_id = question.get("id")
        if not question_id or question_id in question_ids:
            structural_errors.append(f"anomaly question id is missing or duplicated: {question_id}")
        question_ids.add(question_id)
        domain = question.get("domain")
        difficulty = question.get("difficulty")
        bucket_key = f"{domain}:{difficulty}"
        if bucket_key not in anomaly_buckets:
            structural_errors.append(f"anomaly question {question_id} has an invalid bucket")
        else:
            anomaly_buckets[bucket_key] += 1
        rule_id = question.get("ruleId")
        rule = anomaly_definitions.get(rule_id)
        if not rule:
            structural_errors.append(f"anomaly question {question_id} references unknown rule {rule_id}")
            continue
        if rule.get("domain") != domain:
            structural_errors.append(f"anomaly question {question_id} crosses rule domains")
        majority = question.get("majorityIds") or []
        odd_id = question.get("oddId")
        option_ids = set(majority + ([odd_id] if odd_id else []))
        if len(majority) != 3 or len(set(majority)) != 3 or len(option_ids) != 4:
            structural_errors.append(f"anomaly question {question_id} must contain four unique options")
            continue
        unknown = sorted(option_ids - operator_ids)
        if unknown:
            structural_errors.append(f"anomaly question {question_id} has unknown operators: {unknown}")
        else:
            rarity_counts = Counter(operator_by_id[operator_id].get("rarity") for operator_id in option_ids)
            if sorted(rarity_counts.values()) == [1, 3]:
                structural_errors.append(
                    f"anomaly question {question_id} has a protected rarity 3:1 shortcut"
                )
            for competing_id, competing_members in rule_members.items():
                matching = option_ids & competing_members
                if len(matching) != 3:
                    continue
                competing_odd = next(iter(option_ids - matching))
                if competing_odd != odd_id:
                    structural_errors.append(
                        f"anomaly question {question_id} has conflicting rule {competing_id}"
                    )
                    break
        members = rule_members[rule_id]
        if not set(majority).issubset(members) or odd_id in members:
            structural_errors.append(f"anomaly question {question_id} does not match its target rule")
        if str(rule.get("source") or "").startswith("skin.displaySkin.skinGroupName"):
            art = question.get("optionArt") or []
            art_by_id = {entry.get("operatorId"): entry for entry in art}
            if set(art_by_id) != option_ids or len(art) != 4:
                structural_errors.append(
                    f"outfit-brand question {question_id} must provide four skin illustrations"
                )
            else:
                target_brand = str(rule.get("matchLabel") or "")
                for operator_id in option_ids:
                    entry = art_by_id[operator_id]
                    brand = str(entry.get("brand") or "")
                    should_match = operator_id in members
                    if (brand == target_brand) != should_match:
                        structural_errors.append(
                            f"outfit-brand question {question_id} has mismatched art for {operator_id}"
                        )
                        break
                    if not public_asset_exists(entry.get("imageUrl")):
                        structural_errors.append(
                            f"outfit-brand question {question_id} is missing skin art for {operator_id}"
                        )
                        break
        evidence = question.get("evidence") or []
        evidence_by_id = {entry.get("operatorId"): entry for entry in evidence}
        if set(evidence_by_id) != option_ids or len(evidence) != 4:
            structural_errors.append(f"anomaly question {question_id} has incomplete evidence")
        else:
            for operator_id in option_ids:
                if bool(evidence_by_id[operator_id].get("match")) != (operator_id in members):
                    structural_errors.append(
                        f"anomaly question {question_id} has inconsistent evidence for {operator_id}"
                    )
                    break
        for supporting_id in question.get("supportingRuleIds") or []:
            supporting = anomaly_definitions.get(supporting_id)
            supporting_members = rule_members.get(supporting_id, set())
            if not supporting or supporting.get("domain") != domain:
                structural_errors.append(
                    f"anomaly question {question_id} has invalid supporting rule {supporting_id}"
                )
                continue
            if not set(majority).issubset(supporting_members) or odd_id in supporting_members:
                structural_errors.append(
                    f"anomaly question {question_id} supporting rule {supporting_id} is ambiguous"
                )

    for bucket_key, count in sorted(anomaly_buckets.items()):
        if count < MIN_ANOMALY_BUCKET_SIZE:
            structural_errors.append(
                f"anomaly bucket {bucket_key} has {count} questions; "
                f"minimum is {MIN_ANOMALY_BUCKET_SIZE}"
            )
    for label, actual in (
        ("operator-clues", set(clues)),
        ("operator-familiarity", set(familiarity)),
    ):
        missing = sorted(operator_ids - actual)
        extra = sorted(actual - operator_ids)
        if missing:
            structural_errors.append(f"{label} missing {len(missing)} operator ids: {', '.join(missing[:8])}")
        if extra:
            structural_errors.append(f"{label} has {len(extra)} unknown operator ids: {', '.join(extra[:8])}")

    attention_coverage = {}
    attention_providers = set(attention.get("_meta", {}).get("providers") or [])
    attention_providers.update(
        provider for provider in (attention_weights.get("providers") or {})
        if provider != "communityAnchor"
    )
    for provider in sorted(attention_providers):
        valid = 0
        for operator_id in operator_ids:
            provider_record = (attention_records.get(operator_id) or {}).get(provider) or {}
            value = provider_record.get("index")
            if not isinstance(value, (int, float)):
                continue
            if provider == "bilibiliVideo" and provider_record.get("resultCount", 0) <= 0:
                continue
            valid += 1
        coverage = valid / len(operator_ids) if operator_ids else 0
        used = sum(
            1 for record in familiarity.values()
            if provider in (record.get("activeAttentionProviders") or [])
        )
        enabled = coverage >= 0.9
        attention_coverage[provider] = {
            "valid": valid,
            "expected": len(operator_ids),
            "coverage": round(coverage, 4),
            "enabled": enabled,
            "familiarityRecordsUsingProvider": used,
        }
        if not enabled and used:
            structural_errors.append(
                f"attention provider {provider} has only {coverage:.1%} coverage but is used by {used} records"
            )

    missing_archives = sorted(operator_ids - set(archives))
    if missing_archives:
        structural_errors.append(
            f"operator-archives missing {len(missing_archives)} operator ids: "
            f"{', '.join(missing_archives[:8])}"
        )
    if operator_names != name_index:
        missing_names = sorted(operator_names - name_index)
        extra_names = sorted(name_index - operator_names)
        structural_errors.append(
            "public name index differs from server operators "
            f"(missing={missing_names[:8]}, extra={extra_names[:8]})"
        )

    identity_members = set((identities.get("byOperator") or {}).keys())
    for group in identities.get("groups") or []:
        member_ids = set(group.get("memberIds") or [])
        if group.get("baseId") not in member_ids:
            structural_errors.append(f"identity group {group.get('id')} does not contain its base operator")
        unknown = sorted(member_ids - operator_ids)
        if unknown:
            structural_errors.append(f"identity group {group.get('id')} has unknown operators: {unknown[:8]}")
    unknown_identity_members = sorted(identity_members - operator_ids)
    if unknown_identity_members:
        structural_errors.append(f"identity index has unknown operators: {unknown_identity_members[:8]}")

    theme_definitions = themes.get("definitions") or {}
    themes_by_operator = themes.get("byOperator") or {}
    if set(themes_by_operator) != operator_ids:
        missing_theme_operators = sorted(operator_ids - set(themes_by_operator))
        extra_theme_operators = sorted(set(themes_by_operator) - operator_ids)
        structural_errors.append(
            "theme index differs from server operators "
            f"(missing={missing_theme_operators[:8]}, extra={extra_theme_operators[:8]})"
        )
    for theme_id, definition in theme_definitions.items():
        members = set(definition.get("members") or [])
        if len(members) < 3:
            structural_errors.append(f"theme {theme_id} has fewer than three members")
        if definition.get("memberCount") != len(members):
            structural_errors.append(f"theme {theme_id} memberCount is inconsistent")
        unknown = sorted(members - operator_ids)
        if unknown:
            structural_errors.append(f"theme {theme_id} has unknown operators: {unknown[:8]}")
        for operator_id in members:
            if theme_id not in (themes_by_operator.get(operator_id) or []):
                structural_errors.append(f"theme index is missing {theme_id} for {operator_id}")
                break
    uncovered_theme_operators = sorted(
        operator_id for operator_id in operator_ids if not themes_by_operator.get(operator_id)
    )
    if uncovered_theme_operators:
        structural_errors.append(f"theme bank leaves operators uncovered: {uncovered_theme_operators[:8]}")

    unknown_professions = sorted({
        record.get("profession")
        for record in operators.values()
        if record.get("profession") and record.get("professionText") == record.get("profession")
    })
    unknown_subprofessions = sorted({
        record.get("subProfessionId")
        for record in operators.values()
        if record.get("subProfessionId")
        and record.get("subProfessionText") == record.get("subProfessionId")
    })

    missing_art_manifest = []
    pending_operator_art = []
    missing_e1 = []
    missing_final = []
    missing_silhouettes = []
    missing_fragments = []
    missing_faction_logos = set()
    powers_without_logo = set()
    missing_skill_icons = set()

    for operator in operators.values():
        operator_id = operator["id"]
        art = operator_art.get(operator_id)
        if not art:
            missing_art_manifest.append(operator_id)
        else:
            if art.get("pendingAsset"):
                pending_operator_art.append({
                    "id": operator_id,
                    "asset": art["pendingAsset"],
                })
            if not public_asset_exists(art.get("e1")):
                missing_e1.append(operator_id)
            if not public_asset_exists(art.get("final")):
                missing_final.append(operator_id)

        power = operator.get("power") or {}
        logo_url = power.get("logoUrl")
        if not logo_url:
            powers_without_logo.add(power.get("id") or "unknown")
        elif not public_asset_exists(logo_url):
            missing_faction_logos.add(logo_url)

        clue = clues.get(operator_id) or {}
        if not public_asset_exists(clue.get("silhouetteUrl")):
            missing_silhouettes.append(operator_id)
        for fragment_url in clue.get("fragmentUrls") or []:
            if not public_asset_exists(fragment_url):
                missing_fragments.append({"id": operator_id, "url": fragment_url})
        for skill in clue.get("skills") or []:
            target_url = skill.get("iconTargetUrl") or skill.get("iconUrl")
            if target_url and not public_asset_exists(target_url):
                missing_skill_icons.add(target_url)

    required_assets = {
        "operatorArtManifest": sorted(missing_art_manifest),
        "pendingOperatorArt": sorted(
            pending_operator_art,
            key=lambda item: (item["id"], item["asset"]),
        ),
        "e1Images": sorted(missing_e1),
        "finalImages": sorted(missing_final),
        "silhouettes": sorted(missing_silhouettes),
        "fragments": sorted(missing_fragments, key=lambda item: (item["id"], item["url"])),
        "factionLogos": sorted(missing_faction_logos),
    }
    required_asset_count = sum(len(values) for values in required_assets.values())
    manual_review = {
        "unknownProfessions": unknown_professions,
        "unknownSubprofessions": unknown_subprofessions,
        "powersWithoutLogo": sorted(powers_without_logo),
        "themeCandidates": sorted(
            f"{theme_id}:{operator_id}"
            for theme_id, operator_ids_to_review in (themes.get("manualReview") or {}).items()
            for operator_id in operator_ids_to_review
        ),
    }
    manual_review_count = sum(len(values) for values in manual_review.values())

    if structural_errors:
        status = "invalid"
    elif manual_review_count:
        status = "manual_review_required"
    elif required_asset_count:
        status = "asset_refresh_required"
    else:
        status = "ready"

    return {
        "schemaVersion": 1,
        "status": status,
        "source": source,
        "counts": {
            "operators": len(operators),
            "publicNames": len(names),
            "archives": len(archives),
            "clues": len(clues),
            "familiarityRecords": len(familiarity),
            "identityGroups": len(identities.get("groups") or []),
            "themes": len(theme_definitions),
            "anomalyRules": len(anomaly_definitions),
            "anomalyQuestions": len(anomaly_question_list),
            "anomalyBuckets": len(anomaly_buckets),
            "operatorArtRecords": len(operator_art),
            "requiredAssetGaps": required_asset_count,
            "optionalSkillIconGaps": len(missing_skill_icons),
            "manualReviewItems": manual_review_count,
            "attentionProviders": len(attention_coverage),
        },
        "structuralErrors": structural_errors,
        "manualReview": manual_review,
        "requiredAssets": required_assets,
        "optionalSkillIcons": sorted(missing_skill_icons),
        "attentionCoverage": attention_coverage,
        "generatedData": {
            relative_path: file_digest(relative_path)
            for relative_path in GENERATED_DATA_FILES
        },
    }


def compact_version(report):
    return {
        "schemaVersion": report["schemaVersion"],
        "status": report["status"],
        "source": report["source"],
        "counts": report["counts"],
        "manualReview": report["manualReview"],
        "requiredAssets": report["requiredAssets"],
        "optionalSkillIcons": report["optionalSkillIcons"],
        "attentionCoverage": report["attentionCoverage"],
        "generatedData": report["generatedData"],
    }


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repository", default="unknown")
    parser.add_argument("--source-revision", default="unknown")
    parser.add_argument("--source-commit-time")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--version", type=Path, default=DEFAULT_VERSION)
    parser.add_argument(
        "--strict-assets",
        action="store_true",
        help="fail when client-derived assets or translation mappings need attention",
    )
    args = parser.parse_args()

    source = {
        "repository": args.source_repository,
        "revision": args.source_revision,
    }
    if args.source_commit_time:
        source["commitTime"] = args.source_commit_time

    report = validate(source)
    write_json(args.report, report)
    write_json(args.version, compact_version(report))
    print(json.dumps({
        "status": report["status"],
        "counts": report["counts"],
        "report": str(args.report),
        "version": str(args.version),
    }, ensure_ascii=False, indent=2))

    if report["structuralErrors"]:
        raise SystemExit(1)
    if args.strict_assets and report["status"] != "ready":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
