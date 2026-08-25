"""Extract Arknights operator illustrations from the local PC game bundles.

The game installation is read-only. Extracted images are written only to the
requested output directory. Install scripts/requirements-art.txt into
.tools/unitypy before running the batch build.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UNITYPY_ROOT = PROJECT_ROOT / ".tools" / "unitypy"
if UNITYPY_ROOT.is_dir():
    sys.path.insert(0, str(UNITYPY_ROOT))

import UnityPy  # noqa: E402
import lz4.block  # noqa: E402
from UnityPy.enums.BundleFile import CompressionFlags  # noqa: E402
from UnityPy.helpers import CompressionHelper  # noqa: E402


# Adapted from isHarryh/Ark-Unpacker src/lz4ak/Block.py (BSD-3-Clause).
# Copyright (c) 2022, Harry Huang. All rights reserved.
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the source retains this notice,
# binary distributions reproduce it in accompanying materials, and neither the
# copyright holder nor contributors are used to endorse derived products.
# THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. IN NO EVENT
# SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES ARISING
# FROM ITS USE.
#
# The routine converts Arknights' reversed LZ4 sequence fields back to standard
# LZ4 so UnityPy can read the current PC bundles.
def _read_extra_length(data, cursor, limit):
    length = 0
    while cursor < limit:
        value = data[cursor]
        length += value
        cursor += 1
        if value != 0xFF:
            break
    return length, cursor


def decompress_lz4ak(compressed_data, uncompressed_size):
    input_pos = 0
    output_pos = 0
    fixed = bytearray(compressed_data)
    compressed_size = len(compressed_data)

    while input_pos < compressed_size:
        literal_length = fixed[input_pos] & 0xF
        match_length = (fixed[input_pos] >> 4) & 0xF
        fixed[input_pos] = (literal_length << 4) | match_length
        input_pos += 1

        if literal_length == 0xF:
            extra, input_pos = _read_extra_length(fixed, input_pos, compressed_size)
            literal_length += extra
        input_pos += literal_length
        output_pos += literal_length
        if output_pos >= uncompressed_size:
            break

        offset = (fixed[input_pos] << 8) | fixed[input_pos + 1]
        fixed[input_pos] = offset & 0xFF
        fixed[input_pos + 1] = (offset >> 8) & 0xFF
        input_pos += 2

        if match_length == 0xF:
            extra, input_pos = _read_extra_length(fixed, input_pos, compressed_size)
            match_length += extra
        output_pos += match_length + 4

    return lz4.block.decompress(fixed, uncompressed_size=uncompressed_size)


CompressionHelper.DECOMPRESSION_MAP[CompressionFlags.LZHAM] = decompress_lz4ak


def safe_name(value):
    value = re.sub(r"[^0-9A-Za-z_.-]+", "_", value or "unnamed")
    return value.strip("._") or "unnamed"


def object_summary(reader):
    data = reader.read()
    name = getattr(data, "m_Name", getattr(data, "name", ""))
    result = {"type": reader.type.name, "name": name, "pathId": reader.path_id}
    for attr, key in (("m_Width", "width"), ("m_Height", "height")):
        value = getattr(data, attr, None)
        if value is not None:
            result[key] = value
    return result


def probe_bundle(bundle_path):
    env = UnityPy.load(str(bundle_path))
    return [object_summary(reader) for reader in env.objects]


def extract_images(bundle_path, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    env = UnityPy.load(str(bundle_path))
    written = []
    for reader in env.objects:
        if reader.type.name not in {"Texture2D", "Sprite"}:
            continue
        data = reader.read()
        name = getattr(data, "m_Name", getattr(data, "name", ""))
        image = getattr(data, "image", None)
        if image is None:
            continue
        path = output_dir / f"{safe_name(name)}_{reader.path_id}.png"
        image.save(path)
        written.append(str(path))
    return written


def extract_sprite_set(bundle_path, output_dir, prefix=""):
    output_dir.mkdir(parents=True, exist_ok=True)
    env = UnityPy.load(str(bundle_path))
    written = []
    for reader in env.objects:
        if reader.type.name != "Sprite":
            continue
        data = reader.read()
        name = getattr(data, "m_Name", getattr(data, "name", ""))
        if prefix and not name.startswith(prefix):
            continue
        image = data.image.convert("RGBA")
        clean_name = name[len(prefix):] if prefix else name
        clean_name = clean_name.removesuffix("_icon")
        path = output_dir / f"{safe_name(clean_name)}.webp"
        image.save(path, "WEBP", lossless=True, method=3)
        written.append(str(path))
    return written


def find_bundle(game_root, category, operator_id):
    candidates = [
        game_root / "Arknights_Data" / "PersistentData" / "Bundles" / category / f"{operator_id}.ab",
        game_root / "Arknights_Data" / "StreamingAssets" / "AB" / "Windows" / category / f"{operator_id}.ab",
    ]
    return next((path for path in candidates if path.is_file()), None)


def read_sprite(bundle_path, preferred_names):
    if not bundle_path:
        return None, None
    env = UnityPy.load(str(bundle_path))
    sprites = []
    for reader in env.objects:
        if reader.type.name != "Sprite":
            continue
        data = reader.read()
        name = getattr(data, "m_Name", getattr(data, "name", ""))
        sprites.append((name, data))

    by_name = {name.lower(): (name, data) for name, data in sprites}
    for preferred in preferred_names:
        item = by_name.get((preferred or "").lower())
        if item:
            return item[1].image, item[0]
    return None, None


def latest_skin_map(skin_table):
    table = json.loads(skin_table.read_text(encoding="utf-8"))
    result = {}
    for skin in table.get("charSkins", {}).values():
        display = skin.get("displaySkin") or {}
        get_time = display.get("getTime") or 0
        if not skin.get("isBuySkin") or get_time <= 0:
            continue
        operator_id = skin.get("charId")
        previous = result.get(operator_id)
        rank = (get_time, display.get("sortId") or 0)
        if not previous or rank > previous["rank"]:
            result[operator_id] = {
                "rank": rank,
                # portraitId is the canonical full illustration. spPortraitId
                # is an optional special/censored variant and is not the art
                # shown by the regular personnel archive.
                "portraitId": skin.get("portraitId") or skin.get("spPortraitId"),
                "skinName": display.get("skinName") or "最新时装",
                "skinGroup": display.get("skinGroupName") or "时装",
            }
    return result


def save_webp(image, path, max_width, max_height, quality):
    image = image.convert("RGBA")
    image.thumbnail((max_width, max_height))
    path.parent.mkdir(parents=True, exist_ok=True)
    # Method 3 keeps the one-off data build practical while retaining almost
    # all of the visual quality of the much slower maximum-compression mode.
    image.save(path, "WEBP", quality=quality, method=3)


def public_asset_exists(public_root, url):
    if not url or not url.startswith("/"):
        return False
    path = (public_root / url.lstrip("/")).resolve()
    try:
        path.relative_to(public_root.resolve())
    except ValueError:
        return False
    return path.is_file()


def build_operator_art(game_root, operators_path, skin_table_path, public_root, missing_only=False):
    operators = json.loads(operators_path.read_text(encoding="utf-8"))
    skins = latest_skin_map(skin_table_path)
    e1_dir = public_root / "img" / "operators" / "e1"
    final_dir = public_root / "img" / "operators" / "final"
    manifest_path = public_root / "data" / "operator-art.json"
    e1_dir.mkdir(parents=True, exist_ok=True)
    final_dir.mkdir(parents=True, exist_ok=True)

    existing_manifest = {}
    if missing_only and manifest_path.is_file():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    manifest = {}
    failures = []
    reused = 0
    for index, operator in enumerate(operators.values(), 1):
        operator_id = operator["id"]
        existing = existing_manifest.get(operator_id)
        if (
            existing
            and not existing.get("pendingAsset")
            and public_asset_exists(public_root, existing.get("e1"))
            and public_asset_exists(public_root, existing.get("final"))
        ):
            manifest[operator_id] = existing
            reused += 1
            continue

        char_bundle = find_bundle(game_root, "chararts", operator_id)
        skin_bundle = find_bundle(game_root, "skinpack", operator_id)

        e1_image, e1_asset = read_sprite(
            char_bundle,
            [f"{operator_id}_1", operator_id],
        )
        if e1_image is None:
            # A handful of collaboration or special operators store their base
            # illustration in skinpack rather than chararts.
            e1_image, e1_asset = read_sprite(
                skin_bundle,
                [f"{operator_id}_1", operator_id],
            )
        if e1_image is None:
            failures.append({"id": operator_id, "stage": "e1"})
            print(f"[{index}/{len(operators)}] missing E1: {operator_id}", flush=True)
            continue

        e1_path = e1_dir / f"{operator_id}.webp"
        save_webp(e1_image, e1_path, 760, 900, 84)
        final_image = None
        final_asset = None
        latest = skins.get(operator_id)
        if latest:
            final_image, final_asset = read_sprite(skin_bundle, [latest["portraitId"]])

        final_kind = "skin"
        final_title = latest["skinName"] if latest else "精英二阶段"
        final_group = latest["skinGroup"] if latest else "精英档案"
        if final_image is None:
            final_image, final_asset = read_sprite(char_bundle, [f"{operator_id}_2"])
            final_kind = "e2"
            final_title = "精英二阶段"
            final_group = "精英档案"
        if final_image is None:
            final_kind = "e1"
            final_title = "精英一阶段"
            final_group = "基础档案"

        if final_kind == "e1":
            final_url = f"/img/operators/e1/{operator_id}.webp"
        else:
            final_path = final_dir / f"{operator_id}.webp"
            save_webp(final_image, final_path, 1240, 1240, 86)
            final_url = f"/img/operators/final/{operator_id}.webp"

        manifest[operator_id] = {
            "e1": f"/img/operators/e1/{operator_id}.webp",
            "final": final_url,
            "finalKind": final_kind,
            "finalTitle": final_title,
            "finalGroup": final_group,
            "e1Asset": e1_asset,
            "finalAsset": final_asset or e1_asset,
        }
        print(
            f"[{index}/{len(operators)}] {operator_id}: {e1_asset} -> {final_kind}:{final_asset or e1_asset}",
            flush=True,
        )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "records": len(manifest),
        "reused": reused,
        "extracted": len(manifest) - reused,
        "failures": failures,
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path, nargs="?")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sprite-set", action="store_true")
    parser.add_argument("--sprite-prefix", default="")
    parser.add_argument("--build-all", action="store_true")
    parser.add_argument("--game-root", type=Path)
    parser.add_argument("--operators", type=Path, default=PROJECT_ROOT / "server-data" / "operators.json")
    parser.add_argument("--skin-table", type=Path, default=PROJECT_ROOT / ".skin-table.json")
    parser.add_argument("--public-root", type=Path, default=PROJECT_ROOT / "public")
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="keep valid manifest entries and only extract newly missing operator art",
    )
    args = parser.parse_args()

    if args.build_all:
        if not args.game_root or not args.game_root.is_dir():
            parser.error("--build-all requires a valid --game-root")
        if not args.operators.is_file() or not args.skin_table.is_file():
            parser.error("Operator data or skin table does not exist")
        build_operator_art(
            args.game_root,
            args.operators,
            args.skin_table,
            args.public_root,
            missing_only=args.missing_only,
        )
        return
    if not args.bundle or not args.bundle.is_file():
        parser.error(f"Bundle does not exist: {args.bundle}")
    if args.probe:
        print(json.dumps(probe_bundle(args.bundle), ensure_ascii=False, indent=2))
    if args.output:
        extractor = extract_sprite_set if args.sprite_set else extract_images
        if args.sprite_set:
            result = extractor(args.bundle, args.output, args.sprite_prefix)
        else:
            result = extractor(args.bundle, args.output)
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
