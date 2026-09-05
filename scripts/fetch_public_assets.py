# -*- coding: utf-8 -*-
"""Fill missing gameplay assets from a maintained public resource mirror."""

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

import build_gameplay_assets as clue_assets
from atomic_write import atomic_write_json


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPOSITORY = "https://github.com/fexli/ArknightsResource.git"
DEFAULT_RAW_ROOT = "https://raw.githubusercontent.com/fexli/ArknightsResource"
DEFAULT_REPORT = PROJECT_ROOT / ".update-work" / "public-asset-report.json"
MAX_DOWNLOAD_BYTES = 48 * 1024 * 1024


def resource_paths(directory, asset_name):
    variants = [asset_name]
    normalized = re.sub(r"[#+$]", "_", asset_name)
    if normalized not in variants:
        variants.append(normalized)
    return tuple(f"{directory}/{value}.png" for value in variants)


def resolve_revision(repository, requested_revision):
    if requested_revision:
        return requested_revision
    result = subprocess.run(
        ["git", "ls-remote", repository, "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    revision = result.stdout.split()[0] if result.stdout.split() else ""
    if not revision:
        raise RuntimeError(f"Could not resolve HEAD for {repository}")
    return revision


def latest_skin_map(skin_table_path):
    table = json.loads(skin_table_path.read_text(encoding="utf-8"))
    result = {}
    for skin in table.get("charSkins", {}).values():
        display = skin.get("displaySkin") or {}
        get_time = display.get("getTime") or 0
        if not skin.get("isBuySkin") or get_time <= 0:
            continue
        operator_id = skin.get("charId")
        rank = (get_time, display.get("sortId") or 0)
        previous = result.get(operator_id)
        if not previous or rank > previous["rank"]:
            result[operator_id] = {
                "rank": rank,
                "portraitId": skin.get("portraitId") or skin.get("spPortraitId"),
                "skinName": display.get("skinName") or "最新时装",
                "skinGroup": display.get("skinGroupName") or "时装",
            }
    return result


def public_asset_exists(public_root, url):
    if not url or not url.startswith("/"):
        return False
    path = (public_root / url.lstrip("/")).resolve()
    try:
        path.relative_to(public_root.resolve())
    except ValueError:
        return False
    return path.is_file()


def resolve_final_asset(operator, latest):
    """Return the asset that the current data says should be displayed."""
    if latest and latest.get("portraitId"):
        return latest["portraitId"]
    return f"{operator['id']}_{'2' if int(operator.get('rarity') or 0) >= 4 else '1'}"


class PublicAssetFetcher:
    def __init__(self, raw_root, revision):
        self.raw_root = raw_root.rstrip("/")
        self.revision = revision
        self.downloaded = []
        self.not_found = []
        self.errors = []

    def image(self, candidates):
        for relative_path in candidates:
            encoded = urllib.parse.quote(relative_path, safe="/")
            url = f"{self.raw_root}/{self.revision}/{encoded}"
            headers = {"User-Agent": "arknight-cczss-data-updater/1.0"}
            github_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
            if github_token:
                headers["Authorization"] = f"Bearer {github_token}"
            request = urllib.request.Request(
                url,
                headers=headers,
            )
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        content_length = int(response.headers.get("Content-Length") or 0)
                        if content_length > MAX_DOWNLOAD_BYTES:
                            raise RuntimeError(f"Public asset is unexpectedly large: {relative_path}")
                        payload = response.read(MAX_DOWNLOAD_BYTES + 1)
                        if len(payload) > MAX_DOWNLOAD_BYTES:
                            raise RuntimeError(f"Public asset exceeded size limit: {relative_path}")
                    image = Image.open(io.BytesIO(payload))
                    image.load()
                    self.downloaded.append(relative_path)
                    return image.convert("RGBA"), relative_path
                except urllib.error.HTTPError as error:
                    if error.code == 404:
                        self.not_found.append(relative_path)
                        break
                    if error.code in {429, 500, 502, 503, 504} and attempt < 2:
                        time.sleep(2 ** attempt)
                        continue
                    self.errors.append(f"{relative_path}: HTTP {error.code}")
                    break
                except Exception as error:  # Network mirrors are best-effort; validation decides readiness.
                    self.errors.append(f"{relative_path}: {error}")
                    break
        return None, None


def save_webp(image, path, max_width, max_height, quality):
    image.thumbnail((max_width, max_height))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=3)


def build_operator_art(fetcher, operators, skins, public_root):
    manifest_path = public_root / "data" / "operator-art.json"
    existing_manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.is_file()
        else {}
    )
    manifest = {}

    for operator in operators.values():
        operator_id = operator["id"]
        existing = existing_manifest.get(operator_id) or {}
        e1_url = f"/img/operators/e1/{operator_id}.webp"
        if not public_asset_exists(public_root, e1_url):
            image, source_asset = fetcher.image((
                f"charpack/{operator_id}_1.png",
                f"charpack/{operator_id}.png",
            ))
            if image is not None:
                save_webp(image, public_root / e1_url.lstrip("/"), 760, 900, 84)
                existing["e1Asset"] = Path(source_asset).stem

        if not public_asset_exists(public_root, e1_url):
            continue

        latest = skins.get(operator_id)
        if latest and latest.get("portraitId"):
            final_kind = "skin"
            final_title = latest["skinName"]
            final_group = latest["skinGroup"]
        elif int(operator.get("rarity") or 0) >= 4:
            final_kind = "e2"
            final_title = "精英二阶段"
            final_group = "精英档案"
        else:
            final_kind = "e1"
            final_title = "精英一阶段"
            final_group = "基础档案"
        desired_asset = resolve_final_asset(operator, latest)

        existing_final_ok = public_asset_exists(public_root, existing.get("final"))
        final_url = existing.get("final") if existing_final_ok else None
        final_asset = existing.get("finalAsset") if existing_final_ok else None
        pending_asset = None
        resolved_desired = existing_final_ok and final_asset == desired_asset

        if final_kind == "e1":
            final_url = e1_url
            final_asset = existing.get("e1Asset") or desired_asset
            resolved_desired = True
        elif final_asset != desired_asset or not existing_final_ok:
            image, source_path = fetcher.image(resource_paths("charpack", desired_asset))
            if image is not None:
                final_url = f"/img/operators/final/{operator_id}.webp"
                save_webp(image, public_root / final_url.lstrip("/"), 1240, 1240, 86)
                final_asset = desired_asset
                resolved_desired = True
            else:
                # Keep a usable old image, but record that it is stale.  A
                # partial mirror update must not silently bless old artwork.
                pending_asset = desired_asset
                if not final_url:
                    final_url = e1_url
                    final_asset = existing.get("e1Asset") or f"{operator_id}_1"

        record = {
            "e1": e1_url,
            "final": final_url,
            "finalKind": final_kind if resolved_desired else existing.get("finalKind", "e1"),
            "finalTitle": final_title if resolved_desired else existing.get("finalTitle", "基础档案"),
            "finalGroup": final_group if resolved_desired else existing.get("finalGroup", "基础档案"),
            "e1Asset": existing.get("e1Asset") or f"{operator_id}_1",
            "finalAsset": final_asset,
        }
        if pending_asset:
            record["pendingAsset"] = pending_asset
        manifest[operator_id] = record

    atomic_write_json(manifest_path, manifest, indent=2, trailing_newline=True)


def build_faction_logos(fetcher, operators, public_root):
    manifest_path = public_root / "data" / "faction-logos.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    power_ids = set()
    for operator in operators.values():
        power = operator.get("power") or {}
        power_ids.update(value for value in (
            power.get("id"), power.get("parentId"), power.get("rootId"),
        ) if value and value != "none")

    for power_id in sorted(power_ids):
        url = f"/img/factions/{power_id}.webp"
        if public_asset_exists(public_root, manifest.get(power_id) or url):
            manifest[power_id] = url
            continue
        image, _ = fetcher.image((f"camplogo/logo_{power_id}.png",))
        if image is None:
            continue
        save_webp(image, public_root / url.lstrip("/"), 240, 240, 88)
        manifest[power_id] = url

    atomic_write_json(
        manifest_path,
        dict(sorted(manifest.items())),
        indent=2,
        trailing_newline=True,
    )


def build_skill_icons(fetcher, clues, public_root):
    handled_urls = set()
    for clue in clues.values():
        for skill in clue.get("skills") or []:
            target_url = skill.get("iconTargetUrl") or skill.get("iconUrl")
            if not target_url or target_url in handled_urls:
                continue
            handled_urls.add(target_url)
            if public_asset_exists(public_root, target_url):
                continue
            candidates = tuple(
                f"skills/{candidate}.png"
                for candidate in skill.get("iconCandidates") or []
            )
            image, _ = fetcher.image(candidates)
            if image is not None:
                save_webp(image, public_root / target_url.lstrip("/"), 160, 160, 88)


def write_report(path, report):
    atomic_write_json(path, report, indent=2, trailing_newline=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--operators", type=Path, default=PROJECT_ROOT / "server-data" / "operators.json")
    parser.add_argument("--clues", type=Path, default=PROJECT_ROOT / "server-data" / "operator-clues.json")
    parser.add_argument("--skin-table", type=Path, required=True)
    parser.add_argument("--public-root", type=Path, default=PROJECT_ROOT / "public")
    parser.add_argument("--repository", default=DEFAULT_REPOSITORY)
    parser.add_argument("--raw-root", default=DEFAULT_RAW_ROOT)
    parser.add_argument("--revision")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    operators = json.loads(args.operators.read_text(encoding="utf-8"))
    clues = json.loads(args.clues.read_text(encoding="utf-8"))
    try:
        revision = resolve_revision(args.repository, args.revision)
    except Exception as error:
        report = {
            "status": "unavailable",
            "repository": args.repository,
            "error": str(error),
        }
        write_report(args.report, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    fetcher = PublicAssetFetcher(args.raw_root, revision)
    build_operator_art(fetcher, operators, latest_skin_map(args.skin_table), args.public_root)
    build_faction_logos(fetcher, operators, args.public_root)
    build_skill_icons(fetcher, clues, args.public_root)
    art_retained, art_missing = clue_assets.build_art_clues(clues, args.public_root, force=False)

    not_found = sorted(set(fetcher.not_found))
    mirror_complete = not fetcher.errors and not not_found and not art_missing
    report = {
        "status": "complete" if mirror_complete else "partial",
        "repository": args.repository,
        "revision": revision,
        "downloaded": fetcher.downloaded,
        "notFound": not_found,
        "errors": fetcher.errors,
        "artCluesPresent": art_retained,
        "operatorsMissingE1": art_missing,
    }
    write_report(args.report, report)
    print(json.dumps({
        "status": report["status"],
        "revision": revision,
        "downloaded": len(fetcher.downloaded),
        "notFound": len(report["notFound"]),
        "errors": len(report["errors"]),
        "operatorsMissingE1": len(art_missing),
        "report": str(args.report),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
