"""Build sudden-mode faction logos and opaque clue images from local assets."""

import argparse
import io
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRAGMENT_FACE_GUARD_RATIO = 0.42
FRAGMENT_DIFF_THRESHOLD = 48
FRAGMENT_OPAQUE_THRESHOLD = 192
FRAGMENT_UNSAFE_PIXEL_TOLERANCE = 8
FRAGMENT_SAMPLE_COUNT = 160
FRAGMENT_ZONE_TOP_RANGES = (
    (0.76, 0.84),
    (FRAGMENT_FACE_GUARD_RATIO, 0.68),
)
FRAGMENT_LOWER_FALLBACK_TOP_RANGE = (0.50, 0.68)
FRAGMENT_LOWER_STRUCTURE_MIN = 0.12
FRAGMENT_LOWER_DETAIL_MIN = 0.16
FRAGMENT_LOWER_VISIBILITY_MIN = 0.20
SKIN_HUE_TABLE = [255 if value <= 34 or value >= 246 else 0 for value in range(256)]
SKIN_SATURATION_TABLE = [255 if 18 <= value <= 190 else 0 for value in range(256)]
SKIN_VALUE_TABLE = [255 if value >= 72 else 0 for value in range(256)]
FRAGMENT_SAMPLE_SIZE = 24


def ellipse_mask(size):
    mask = Image.new("L", (size, size), 0)
    margin = max(1, round(size * 0.08))
    ImageDraw.Draw(mask).ellipse((margin, margin, size - margin - 1, size - margin - 1), fill=255)
    return mask


FRAGMENT_SAMPLE_FOCUS_MASK = ellipse_mask(FRAGMENT_SAMPLE_SIZE)
FRAGMENT_SAMPLE_FOCUS_COVERAGE = ImageStat.Stat(FRAGMENT_SAMPLE_FOCUS_MASK).mean[0] / 255


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


def fragment_feature_maps(image):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    edge_map = rgb.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_map = ImageChops.multiply(edge_map, alpha)
    hue, saturation, value = rgb.convert("HSV").split()
    skin_mask = ImageChops.multiply(hue.point(SKIN_HUE_TABLE), saturation.point(SKIN_SATURATION_TABLE))
    skin_mask = ImageChops.multiply(skin_mask, value.point(SKIN_VALUE_TABLE))
    skin_mask = ImageChops.multiply(skin_mask, alpha)
    return alpha, edge_map, skin_mask


def fragment_image(image, seed, ratio, fragment_index=0, feature_maps=None):
    image = image.convert("RGBA")
    alpha, edge_map, skin_mask = feature_maps or fragment_feature_maps(image)
    bounds = alpha.getbbox()
    if not bounds:
        return silhouette_image(image)
    left, top, right, bottom = bounds
    width = max(32, int((right - left) * ratio))
    height = max(32, int((bottom - top) * ratio))
    width = min(width, right - left)
    height = min(height, bottom - top)
    content_height = bottom - top
    safe_top = min(
        bottom - height,
        top + math.ceil(content_height * FRAGMENT_FACE_GUARD_RATIO),
    )
    rng = random.Random(seed)
    def collect_candidates(top_range):
        zone_start_ratio, zone_end_ratio = top_range
        zone_start = max(safe_top, top + round(content_height * zone_start_ratio))
        zone_end = min(bottom - height, top + round(content_height * zone_end_ratio))
        if zone_end < zone_start:
            return []
        zone_candidates = []
        for _ in range(FRAGMENT_SAMPLE_COUNT):
            x = rng.randint(left, max(left, right - width))
            y = rng.randint(zone_start, zone_end)
            box = (x, y, x + width, y + height)
            sample_alpha = alpha.crop(box).resize((FRAGMENT_SAMPLE_SIZE, FRAGMENT_SAMPLE_SIZE))
            sample_alpha = ImageChops.multiply(sample_alpha, FRAGMENT_SAMPLE_FOCUS_MASK)
            coverage = min(
                ImageStat.Stat(sample_alpha).mean[0] / (255 * FRAGMENT_SAMPLE_FOCUS_COVERAGE),
                1,
            )
            if coverage < 0.08:
                continue
            sample_image = image.crop(box).convert("RGB").resize(
                (FRAGMENT_SAMPLE_SIZE, FRAGMENT_SAMPLE_SIZE)
            )
            color_stats = ImageStat.Stat(sample_image, mask=sample_alpha)
            color_detail = sum(color_stats.stddev) / (3 * 64)
            visibility = max(color_stats.mean) / 255
            sample_edges = edge_map.crop(box).resize((FRAGMENT_SAMPLE_SIZE, FRAGMENT_SAMPLE_SIZE))
            structure = min(
                ImageStat.Stat(sample_edges, mask=sample_alpha).mean[0] / 64,
                1,
            )
            sample_skin = skin_mask.crop(box).resize((FRAGMENT_SAMPLE_SIZE, FRAGMENT_SAMPLE_SIZE))
            sample_skin = ImageChops.multiply(sample_skin, FRAGMENT_SAMPLE_FOCUS_MASK)
            skin_coverage = ImageStat.Stat(sample_skin).mean[0] / (
                255 * FRAGMENT_SAMPLE_FOCUS_COVERAGE
            )
            skin_ratio = min(skin_coverage / max(coverage, 0.01), 1)
            if fragment_index == 0 and skin_ratio > 0.68 and structure < 0.32:
                continue
            score = (
                math.sqrt(coverage) * 0.46
                + min(color_detail, 1) * 0.20
                + structure * 0.24
                + visibility * 0.10
            )
            score -= max(0, skin_ratio - 0.20) * 0.28
            if fragment_index == 0:
                score += structure * 0.08
            zone_candidates.append((score, structure, color_detail, visibility, box))
        return zone_candidates

    zone_index = min(fragment_index, len(FRAGMENT_ZONE_TOP_RANGES) - 1)
    candidates = collect_candidates(FRAGMENT_ZONE_TOP_RANGES[zone_index])
    if fragment_index == 0:
        candidates = [
            candidate
            for candidate in candidates
            if (
                candidate[1] >= FRAGMENT_LOWER_STRUCTURE_MIN
                or candidate[2] >= FRAGMENT_LOWER_DETAIL_MIN
            )
            and candidate[3] >= FRAGMENT_LOWER_VISIBILITY_MIN
        ]
        if not candidates:
            candidates = collect_candidates(FRAGMENT_LOWER_FALLBACK_TOP_RANGE)
    if not candidates:
        fallback_box = (left, safe_top, left + width, safe_top + height)
        candidates.append((0, 0, 0, 0, fallback_box))
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, _, _, _, reveal_box = rng.choice(candidates[:min(3, len(candidates))])

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
    ImageDraw.Draw(reveal_mask).rectangle((0, 0, image.width, safe_top), fill=0)
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
            feature_maps = fragment_feature_maps(image)
            ratios = (0.16, 0.24)
            for index, url in enumerate(clue.get("fragmentUrls") or []):
                fragment = fragment_image(
                    image,
                    f"{operator_id}:{index}",
                    ratios[min(index, 1)],
                    fragment_index=index,
                    feature_maps=feature_maps,
                )
                output = public_root / url.lstrip("/")
                save_webp(fragment, output, (420, 500), lossless=False)
                written += 1
    return written, missing


def validate_art_fragments(clues, public_root):
    checked = 0
    issues = []
    threshold_table = [0] * FRAGMENT_DIFF_THRESHOLD + [255] * (256 - FRAGMENT_DIFF_THRESHOLD)
    opaque_table = [0] * FRAGMENT_OPAQUE_THRESHOLD + [255] * (256 - FRAGMENT_OPAQUE_THRESHOLD)
    for operator_id, clue in clues.items():
        silhouette_path = public_root / clue["silhouetteUrl"].lstrip("/")
        if not silhouette_path.is_file():
            issues.append(f"{operator_id}: missing silhouette")
            continue
        with Image.open(silhouette_path) as silhouette_source:
            silhouette = silhouette_source.convert("RGBA")
        lossy_buffer = io.BytesIO()
        silhouette.save(lossy_buffer, "WEBP", lossless=False, quality=88, method=3)
        lossy_buffer.seek(0)
        with Image.open(lossy_buffer) as lossy_source:
            lossy_silhouette = lossy_source.convert("RGBA")
        bounds = silhouette.getchannel("A").getbbox()
        if not bounds:
            issues.append(f"{operator_id}: empty silhouette")
            continue
        _, top, _, bottom = bounds
        safe_top = top + math.ceil((bottom - top) * FRAGMENT_FACE_GUARD_RATIO)
        for fragment_url in clue.get("fragmentUrls") or []:
            fragment_path = public_root / fragment_url.lstrip("/")
            if not fragment_path.is_file():
                issues.append(f"{operator_id}: missing fragment {fragment_path.name}")
                continue
            with Image.open(fragment_path) as fragment_source:
                fragment = fragment_source.convert("RGBA")
            checked += 1
            if fragment.size != silhouette.size:
                issues.append(f"{operator_id}: fragment size does not match silhouette")
                continue
            difference = ImageChops.difference(
                fragment.convert("RGB"),
                lossy_silhouette.convert("RGB"),
            )
            red, green, blue = difference.split()
            strongest_difference = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            reveal_mask = strongest_difference.point(threshold_table)
            opaque_mask = silhouette.getchannel("A").point(opaque_table)
            reveal_mask = ImageChops.multiply(reveal_mask, opaque_mask)
            reveal_bounds = reveal_mask.getbbox()
            if not reveal_bounds:
                issues.append(f"{operator_id}: fragment has no visible reveal")
                continue
            unsafe_mask = reveal_mask.crop((0, 0, fragment.width, safe_top))
            unsafe_mask = unsafe_mask.filter(ImageFilter.MinFilter(5))
            unsafe_histogram = unsafe_mask.histogram()
            unsafe_pixels = sum(unsafe_histogram[1:])
            if unsafe_pixels > FRAGMENT_UNSAFE_PIXEL_TOLERANCE:
                issues.append(
                    f"{operator_id}: fragment has {unsafe_pixels} revealed pixels "
                    f"above safe row {safe_top}"
                )
    return checked, issues


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
    art_checked, art_issues = validate_art_fragments(clues, public_root)
    if art_issues:
        raise RuntimeError("invalid art fragments:\n" + "\n".join(art_issues[:20]))
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
        "artFragmentsChecked": art_checked,
        "skillIconsWritten": skills_written,
        "skillIconsMissing": len(skill_missing),
        "skillIconMissingUrls": skill_missing[:20],
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-root", type=Path)
    parser.add_argument("--public-root", type=Path, default=PROJECT_ROOT / "public")
    parser.add_argument("--clues", type=Path, default=PROJECT_ROOT / "server-data" / "operator-clues.json")
    parser.add_argument("--factions-only", action="store_true")
    parser.add_argument("--clues-only", action="store_true")
    parser.add_argument("--art-clues-only", action="store_true")
    parser.add_argument("--force", action="store_true", help="overwrite generated clue art")
    args = parser.parse_args()
    if not args.clues.is_file() and not args.factions_only:
        parser.error(f"clue data does not exist: {args.clues}")
    if args.art_clues_only:
        clues = json.loads(args.clues.read_text(encoding="utf-8"))
        art_written, art_missing = build_art_clues(clues, args.public_root, force=args.force)
        art_checked, art_issues = validate_art_fragments(clues, args.public_root)
        if art_issues:
            raise RuntimeError("invalid art fragments:\n" + "\n".join(art_issues[:20]))
        print(json.dumps({
            "artWritten": art_written,
            "artMissingOperators": art_missing,
            "artFragmentsChecked": art_checked,
        }, ensure_ascii=False, indent=2))
        return
    if not args.game_root or not args.game_root.is_dir():
        parser.error("--game-root must point to the Arknights game directory")
    if not args.clues_only:
        build_factions(args.game_root, args.public_root)
    if not args.factions_only:
        build_clues(args.game_root, args.public_root, args.clues, force=args.force)


if __name__ == "__main__":
    main()
