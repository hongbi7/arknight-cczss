# -*- coding: utf-8 -*-
"""Extract the exact outfit illustrations referenced by anomaly questions."""

import argparse
import io
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

from extract_operator_art import find_bundle, read_sprite, save_webp


PROJECT_ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_PATH = PROJECT_ROOT / "server-data" / "anomaly-questions.json"
PUBLIC_ROOT = PROJECT_ROOT / "public"
DEFAULT_REPORT = PROJECT_ROOT / ".update-work" / "anomaly-skin-art-report.json"
MIRROR_REPOSITORY = "https://github.com/fexli/ArknightsResource.git"
MIRROR_RAW_ROOT = "https://raw.githubusercontent.com/fexli/ArknightsResource"
MAX_DOWNLOAD_BYTES = 48 * 1024 * 1024


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
    # 品牌主题映射覆盖全部成员；题库只引用其中被出题的部分，这里取并集。
    brand_art_path = PROJECT_ROOT / "server-data" / "operator-brand-art.json"
    if brand_art_path.is_file():
        brand_art = json.loads(brand_art_path.read_text(encoding="utf-8"))
        for records in (brand_art.get("brands") or {}).values():
            for operator_id, record in records.items():
                key = (operator_id, record.get("portraitId"))
                if not all(key) or not record.get("imageUrl"):
                    continue
                result.setdefault(key, {
                    "operatorId": operator_id,
                    "portraitId": record["portraitId"],
                    "imageUrl": record["imageUrl"],
                })
    return [result[key] for key in sorted(result)]


def public_path(url):
    if not url or not url.startswith("/"):
        raise ValueError(f"Invalid public anomaly skin URL: {url}")
    path = (PUBLIC_ROOT / url.lstrip("/")).resolve()
    path.relative_to(PUBLIC_ROOT.resolve())
    return path


def bundle_candidates(game_root, operator_id, portrait_id):
    """Skin sprites usually live in skinpack/<operatorId>.ab, but cross-charId
    skins (e.g. Amiya's char_1001_amiya2) and newer clients that ship skins in
    charpack/chararts need fallbacks derived from the portraitId prefix."""
    bases = [operator_id]
    base = (portrait_id or "").split("#", 1)[0]
    parts = base.split("_")
    while len(parts) > 2:
        if "_".join(parts) not in bases:
            bases.append("_".join(parts))
        parts = parts[:-1]
    for name in bases:
        for category in ("skinpack", "charpack", "chararts"):
            bundle = find_bundle(game_root, category, name)
            if bundle:
                yield bundle


_mirror_revision_cache = None


def mirror_revision():
    global _mirror_revision_cache
    if not _mirror_revision_cache:
        result = subprocess.run(
            ["git", "ls-remote", MIRROR_REPOSITORY, "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
        _mirror_revision_cache = result.stdout.split()[0] if result.stdout.split() else ""
    return _mirror_revision_cache


def mirror_portrait(portrait_id):
    """Best-effort fallback for skins the local client cannot provide."""
    revision = mirror_revision()
    if not revision:
        return None
    asset_name = re.sub(r"[#+$]", "_", portrait_id)
    encoded = urllib.parse.quote(f"charpack/{asset_name}.png", safe="/")
    url = f"{MIRROR_RAW_ROOT}/{revision}/{encoded}"
    headers = {"User-Agent": "arknight-cczss-data-updater/1.0"}
    github_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read(MAX_DOWNLOAD_BYTES + 1)
            if len(payload) > MAX_DOWNLOAD_BYTES:
                return None
            image = Image.open(io.BytesIO(payload))
            image.load()
            return image.convert("RGBA")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code in {429, 500, 502, 503, 504} and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            return None
    return None


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
        image = None
        asset = None
        for bundle in bundle_candidates(args.game_root, art["operatorId"], art["portraitId"]):
            image, asset = read_sprite(bundle, [art["portraitId"]])
            if image is not None:
                break
        source = f"bundle:{asset}" if image is not None else None
        if image is None:
            image = mirror_portrait(art["portraitId"])
            if image is not None:
                source = "mirror"
        if image is None:
            failures.append({
                "operatorId": art["operatorId"],
                "portraitId": art["portraitId"],
                "imageUrl": art["imageUrl"],
            })
            continue
        save_webp(image, output_path, 980, 980, 86)
        extracted.append({"imageUrl": art["imageUrl"], "asset": source})
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
