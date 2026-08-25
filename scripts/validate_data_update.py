# -*- coding: utf-8 -*-
"""Validate generated game data and write a deterministic update report."""

import argparse
import hashlib
import json
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
)


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
    names = load_json("public/data/names.json")
    operator_art = load_json("public/data/operator-art.json")

    operator_ids = {record.get("id") for record in operators.values() if record.get("id")}
    operator_names = set(operators)
    name_index = {record.get("n") for record in names if record.get("n")}

    structural_errors = []
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
            "operatorArtRecords": len(operator_art),
            "requiredAssetGaps": required_asset_count,
            "optionalSkillIconGaps": len(missing_skill_icons),
            "manualReviewItems": manual_review_count,
        },
        "structuralErrors": structural_errors,
        "manualReview": manual_review,
        "requiredAssets": required_assets,
        "optionalSkillIcons": sorted(missing_skill_icons),
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
