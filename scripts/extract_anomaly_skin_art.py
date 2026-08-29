# -*- coding: utf-8 -*-
"""Extract the exact outfit illustrations referenced by anomaly questions."""

import argparse
import json
import os
from pathlib import Path

from extract_operator_art import find_bundle, read_sprite, save_webp


PROJECT_ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_PATH = PROJECT_ROOT / "server-data" / "anomaly-questions.json"
PUBLIC_ROOT = PROJECT_ROOT / "public"
DEFAULT_REPORT = PROJECT_ROOT / ".update-work" / "anomaly-skin-art-report.json"


def default_game_root():
    configured = os.environ.get("ARKNIGHTS_GAME_ROOT")
    candidates = [
        Path(configured) if configured else None,
        Path(r"G:\game\Hypergryph Launcher\games\Arknights"),
    ]
    return next((path for path in candidates if path and path.is_dir()), None)


def referenced_skins():
    data = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    result = {}
    for question in data.get("questions") or []:
        for art in question.get("optionArt") or []:
            key = (art.get("operatorId"), art.get("portraitId"))
            if not all(key) or not art.get("imageUrl"):
                continue
            result[key] = art
    return [result[key] for key in sorted(result)]


def public_path(url):
    if not url or not url.startswith("/"):
        raise ValueError(f"Invalid public anomaly skin URL: {url}")
    path = (PUBLIC_ROOT / url.lstrip("/")).resolve()
    path.relative_to(PUBLIC_ROOT.resolve())
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-root", type=Path, default=default_game_root())
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not args.game_root or not args.game_root.is_dir():
        raise SystemExit("Arknights PC game root was not found; set ARKNIGHTS_GAME_ROOT")

    extracted = []
    reused = []
    failures = []
    skins = referenced_skins()
    for index, art in enumerate(skins, 1):
        output_path = public_path(art["imageUrl"])
        if output_path.is_file() and not args.force:
            reused.append(art["imageUrl"])
            continue
        bundle = find_bundle(args.game_root, "skinpack", art["operatorId"])
        image, asset = read_sprite(bundle, [art["portraitId"]])
        if image is None:
            failures.append({
                "operatorId": art["operatorId"],
                "portraitId": art["portraitId"],
                "imageUrl": art["imageUrl"],
            })
            continue
        save_webp(image, output_path, 980, 980, 86)
        extracted.append({"imageUrl": art["imageUrl"], "asset": asset})
        print(f"[{index}/{len(skins)}] {art['operatorId']} -> {output_path.name}", flush=True)

    report = {
        "schemaVersion": 1,
        "referenced": len(skins),
        "extracted": extracted,
        "reused": reused,
        "failures": failures,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "referenced": len(skins),
        "extracted": len(extracted),
        "reused": len(reused),
        "failures": len(failures),
        "report": str(args.report),
    }, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
