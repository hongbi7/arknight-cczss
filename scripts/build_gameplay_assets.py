"""Build sudden-mode faction logos and opaque clue images from local assets."""

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def sprite_bundle(game_root, name):
    candidates = [
        game_root / "Arknights_Data" / "PersistentData" / "Bundles" / "spritepack" / name,
        game_root / "Arknights_Data" / "StreamingAssets" / "AB" / "Windows" / "spritepack" / name,
    ]
    return next((path for path in candidates if path.is_file()), None)


def save_webp(image, output, size, lossless=True):
    image = image.convert("RGBA")
    image.thumbnail(size)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "WEBP", lossless=lossless, quality=88, method=3)


def build_factions(game_root, public_root):
    import extract_operator_art as ark_assets

    bundle = sprite_bundle(game_root, "ui_camp_logo_0.ab")
    if not bundle:
        raise FileNotFoundError("ui_camp_logo_0.ab was not found")
    output_dir = public_root / "img" / "factions"
    manifest = {}
    env = ark_assets.UnityPy.load(str(bundle))
    for reader in env.objects:
        if reader.type.name != "Sprite":
            continue
        data = reader.read()
        name = getattr(data, "m_Name", getattr(data, "name", ""))
        if not name.lower().startswith("logo_"):
            continue
        power_id = name[5:].lower()
        output = output_dir / f"{power_id}.webp"
        save_webp(data.image, output, (240, 240))
        manifest[power_id] = f"/img/factions/{power_id}.webp"
    manifest_path = public_root / "data" / "faction-logos.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"factionLogos": len(manifest), "manifest": str(manifest_path)}, ensure_ascii=False))


def silhouette_image(image):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    result = Image.new("RGBA", image.size, (7, 14, 18, 0))
    result.putalpha(alpha)
    return result


def fragment_image(image, seed, ratio):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        return silhouette_image(image)
    left, top, right, bottom = bounds
    width = max(32, int((right - left) * ratio))
    height = max(32, int((bottom - top) * ratio))
    width = min(width, right - left)
    height = min(height, bottom - top)
    rng = random.Random(seed)
    candidates = []
    for _ in range(40):
        x = rng.randint(left, max(left, right - width))
        y = rng.randint(top, max(top, bottom - height))
        box = (x, y, x + width, y + height)
        score = ImageStat.Stat(alpha.crop(box).resize((24, 24))).mean[0]
        candidates.append((score, box))
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, reveal_box = rng.choice(candidates[:min(8, len(candidates))])

    x1, y1, x2, y2 = reveal_box
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    radius_x = (x2 - x1) / 2
    radius_y = (y2 - y1) / 2
    points = []
    for index in range(16):
        angle = math.tau * index / 16
        jitter = rng.uniform(0.82, 1.12)
        points.append((
            center_x + math.cos(angle) * radius_x * jitter,
            center_y + math.sin(angle) * radius_y * jitter,
        ))
    reveal_mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(reveal_mask).polygon(points, fill=255)
    reveal_mask = reveal_mask.filter(ImageFilter.GaussianBlur(max(1.0, min(width, height) * 0.025)))
    reveal_mask = ImageChops.multiply(reveal_mask, alpha)
    return Image.composite(image, silhouette_image(image), reveal_mask)


def build_art_clues(clues, public_root, force=False):
    written = 0
    missing = []
    for operator_id, clue in clues.items():
        source = public_root / "img" / "operators" / "e1" / f"{operator_id}.webp"
        if not source.is_file():
            missing.append(operator_id)
            continue
        outputs = [public_root / clue["silhouetteUrl"].lstrip("/")]
        outputs.extend(public_root / url.lstrip("/") for url in clue.get("fragmentUrls") or [])
        if not force and outputs and all(output.is_file() for output in outputs):
            written += len(outputs)
            continue
        with Image.open(source) as image:
            silhouette = public_root / clue["silhouetteUrl"].lstrip("/")
            save_webp(silhouette_image(image), silhouette, (420, 500))
            written += 1
            ratios = (0.16, 0.24)
            for index, url in enumerate(clue.get("fragmentUrls") or []):
                fragment = fragment_image(image, f"{operator_id}:{index}", ratios[min(index, 1)])
                output = public_root / url.lstrip("/")
                save_webp(fragment, output, (420, 500), lossless=False)
                written += 1
    return written, missing


def build_skill_clues(game_root, clues, public_root):
    import extract_operator_art as ark_assets

    needed = {}
    expected_urls = set()
    for clue in clues.values():
        for skill in clue.get("skills") or []:
            url = skill.get("iconTargetUrl") or skill.get("iconUrl")
            if not url:
                continue
            expected_urls.add(url)
            for candidate in skill.get("iconCandidates") or []:
                needed.setdefault(candidate.lower(), set()).add(url)

    written_urls = set()
    for index in range(5):
        bundle = sprite_bundle(game_root, f"skill_icons_{index}.ab")
        if not bundle:
            continue
        env = ark_assets.UnityPy.load(str(bundle))
        for reader in env.objects:
            if reader.type.name != "Sprite":
                continue
            data = reader.read()
            name = getattr(data, "m_Name", getattr(data, "name", "")).lower()
            urls = needed.get(name)
            if not urls:
                continue
            for url in urls:
                if url in written_urls:
                    continue
                output = public_root / url.lstrip("/")
                save_webp(data.image, output, (160, 160))
                written_urls.add(url)
    return len(written_urls), sorted(expected_urls - written_urls)


def build_clues(game_root, public_root, clues_path, force=False):
    clues = json.loads(clues_path.read_text(encoding="utf-8"))
    art_written, art_missing = build_art_clues(clues, public_root, force=force)
    skills_written, skill_missing = build_skill_clues(game_root, clues, public_root)
    missing_urls = set(skill_missing)
    for clue in clues.values():
        for skill in clue.get("skills") or []:
            target_url = skill.get("iconTargetUrl") or skill.get("iconUrl")
            skill["iconUrl"] = None if target_url in missing_urls else target_url
    clues_path.write_text(
        json.dumps(clues, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({
        "artWritten": art_written,
        "artMissingOperators": art_missing,
        "skillIconsWritten": skills_written,
        "skillIconsMissing": len(skill_missing),
        "skillIconMissingUrls": skill_missing[:20],
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--public-root", type=Path, default=PROJECT_ROOT / "public")
    parser.add_argument("--clues", type=Path, default=PROJECT_ROOT / "server-data" / "operator-clues.json")
    parser.add_argument("--factions-only", action="store_true")
    parser.add_argument("--clues-only", action="store_true")
    parser.add_argument("--force", action="store_true", help="overwrite generated clue art")
    args = parser.parse_args()
    if not args.game_root.is_dir():
        parser.error("--game-root must point to the Arknights game directory")
    if not args.clues_only:
        build_factions(args.game_root, args.public_root)
    if not args.factions_only:
        if not args.clues.is_file():
            parser.error(f"clue data does not exist: {args.clues}")
        build_clues(args.game_root, args.public_root, args.clues, force=args.force)


if __name__ == "__main__":
    main()
