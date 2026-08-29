# -*- coding: utf-8 -*-
"""Orchestrate repeatable Arknights data and client-asset updates."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GAMEDATA_REPOSITORY = "https://github.com/Kengxxiao/ArknightsGameData.git"
DEFAULT_CACHE_DIR = PROJECT_ROOT / ".cache" / "arknights-gamedata"
DEFAULT_REPORT = PROJECT_ROOT / ".update-work" / "data-update-report.json"
REQUIRED_TABLES = (
    "character_table.json",
    "handbook_info_table.json",
    "handbook_team_table.json",
    "range_table.json",
    "skill_table.json",
    "gacha_table.json",
    "uniequip_table.json",
    "building_data.json",
    "charword_table.json",
    "skin_table.json",
)


def run(command, env=None, cwd=PROJECT_ROOT, capture=False):
    printable = " ".join(str(part) for part in command)
    print(f"\n> {printable}", flush=True)
    return subprocess.run(
        [str(part) for part in command],
        cwd=cwd,
        env=env,
        check=True,
        text=True,
        capture_output=capture,
    )


def git_output(path, *arguments):
    result = run(("git", "-C", path, *arguments), capture=True)
    return result.stdout.strip()


def find_excel_root(source_root):
    source_root = source_root.resolve()
    candidates = (
        source_root,
        source_root / "zh_CN" / "gamedata" / "excel",
        source_root / "cn" / "gamedata" / "excel",
        source_root / "gamedata" / "excel",
    )
    for candidate in candidates:
        if all((candidate / name).is_file() for name in REQUIRED_TABLES):
            return candidate
    searched = "\n".join(f"- {candidate}" for candidate in candidates)
    raise FileNotFoundError(f"GameData excel tables were not found. Searched:\n{searched}")


def prepare_gamedata_cache(cache_dir, repository, skip_fetch):
    cache_dir = cache_dir.resolve()
    if cache_dir.exists():
        if not (cache_dir / ".git").is_dir():
            entries = list(cache_dir.iterdir())
            suffix = " and is not empty" if entries else ""
            raise RuntimeError(
                f"Existing GameData cache is not a Git repository{suffix}: {cache_dir}. "
                "Move it aside or pass --gamedata-root explicitly."
            )
        dirty = git_output(cache_dir, "status", "--porcelain")
        if dirty:
            raise RuntimeError(
                f"GameData cache contains local changes and was left untouched: {cache_dir}"
            )
        actual_remote = git_output(cache_dir, "remote", "get-url", "origin")
        if actual_remote.rstrip("/") != repository.rstrip("/"):
            raise RuntimeError(
                f"GameData cache remote is {actual_remote!r}, expected {repository!r}. "
                "Pass --gamedata-root if this is intentional."
            )
        if not skip_fetch:
            run(("git", "-C", cache_dir, "sparse-checkout", "set", "zh_CN/gamedata/excel"))
            run(("git", "-C", cache_dir, "pull", "--ff-only"))
        return cache_dir

    if skip_fetch:
        raise FileNotFoundError(f"--skip-fetch was used but the cache does not exist: {cache_dir}")
    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    run((
        "git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
        repository, cache_dir,
    ))
    run(("git", "-C", cache_dir, "sparse-checkout", "set", "zh_CN/gamedata/excel"))
    return cache_dir


def content_revision(excel_root):
    digest = hashlib.sha256()
    for name in REQUIRED_TABLES:
        digest.update(name.encode("utf-8"))
        digest.update((excel_root / name).read_bytes())
    return f"sha256:{digest.hexdigest()}"


def source_metadata(excel_root, configured_repository):
    try:
        repository_root = git_output(excel_root, "rev-parse", "--show-toplevel")
        revision = git_output(repository_root, "rev-parse", "HEAD")
        commit_time = git_output(repository_root, "show", "-s", "--format=%cI", "HEAD")
        try:
            repository = git_output(repository_root, "remote", "get-url", "origin")
        except subprocess.CalledProcessError:
            repository = configured_repository
        return {
            "repository": repository or configured_repository,
            "revision": revision,
            "commitTime": commit_time,
        }
    except subprocess.CalledProcessError:
        return {
            "repository": "local-files",
            "revision": content_revision(excel_root),
        }


def build_structured_data(excel_root):
    env = os.environ.copy()
    env["ARKNIGHTS_GAMEDATA_ROOT"] = str(excel_root)
    run((sys.executable, PROJECT_ROOT / "scripts" / "build_data.py"), env=env)
    run((
        sys.executable,
        PROJECT_ROOT / "scripts" / "build_archives.py",
        excel_root / "handbook_info_table.json",
    ))


def build_anomaly_data(excel_root):
    env = os.environ.copy()
    env["ARKNIGHTS_GAMEDATA_ROOT"] = str(excel_root)
    run((sys.executable, PROJECT_ROOT / "scripts" / "build_anomaly_data.py"), env=env)


def build_anomaly_skin_art(game_root, force_assets):
    command = [
        sys.executable,
        PROJECT_ROOT / "scripts" / "extract_anomaly_skin_art.py",
        "--game-root", game_root,
    ]
    if force_assets:
        command.append("--force")
    run(command)


def build_client_assets(game_root, excel_root, force_assets):
    extract_command = [
        sys.executable,
        PROJECT_ROOT / "scripts" / "extract_operator_art.py",
        "--build-all",
        "--game-root", game_root,
        "--operators", PROJECT_ROOT / "server-data" / "operators.json",
        "--skin-table", excel_root / "skin_table.json",
        "--public-root", PROJECT_ROOT / "public",
    ]
    if not force_assets:
        extract_command.append("--missing-only")
    run(extract_command)

    gameplay_command = [
        sys.executable,
        PROJECT_ROOT / "scripts" / "build_gameplay_assets.py",
        "--game-root", game_root,
    ]
    if force_assets:
        gameplay_command.append("--force")
    run(gameplay_command)

    # Faction and skill manifests are client-derived. Rebuild once more so new
    # manifest entries become visible in the server-only operator records.
    build_structured_data(excel_root)


def build_public_assets(excel_root):
    run((
        sys.executable,
        PROJECT_ROOT / "scripts" / "fetch_public_assets.py",
        "--skin-table", excel_root / "skin_table.json",
        "--report", PROJECT_ROOT / ".update-work" / "public-asset-report.json",
    ))
    # Public Logo and skill files affect URLs emitted by build_data.py.
    build_structured_data(excel_root)


def validate(metadata, report_path, strict_assets):
    command = [
        sys.executable,
        PROJECT_ROOT / "scripts" / "validate_data_update.py",
        "--source-repository", metadata["repository"],
        "--source-revision", metadata["revision"],
        "--report", report_path,
    ]
    if metadata.get("commitTime"):
        command.extend(("--source-commit-time", metadata["commitTime"]))
    if strict_assets:
        command.append("--strict-assets")
    run(command)
    return json.loads(report_path.read_text(encoding="utf-8"))


def run_tests(report, full_update):
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("Node.js and npm are required to validate generated data")
    run((node, "--check", PROJECT_ROOT / "lib" / "game.js"))
    run((node, "--check", PROJECT_ROOT / "lib" / "anomaly.js"))
    if full_update or report.get("status") == "ready":
        run((npm, "test"))
    else:
        print(
            "\nSkipped asset-dependent npm tests because the cloud update needs a local asset refresh.",
            flush=True,
        )


def resolve_path(path):
    return path if path.is_absolute() else PROJECT_ROOT / path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gamedata-root", type=Path)
    parser.add_argument("--gamedata-repository", default=DEFAULT_GAMEDATA_REPOSITORY)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--game-root", type=Path)
    parser.add_argument(
        "--data-only",
        action="store_true",
        help="rebuild public GameData-derived JSON without reading the game client",
    )
    parser.add_argument(
        "--force-assets",
        action="store_true",
        help="refresh existing illustrations and clue images, not only missing ones",
    )
    parser.add_argument(
        "--skip-public-assets",
        action="store_true",
        help="do not query the public resource mirror before client fallback",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    if args.data_only and args.game_root:
        parser.error("--data-only and --game-root cannot be used together")
    if not args.data_only and not args.game_root:
        parser.error("A full update requires --game-root; use --data-only for cloud updates")

    if args.gamedata_root:
        source_root = resolve_path(args.gamedata_root)
    else:
        source_root = prepare_gamedata_cache(
            resolve_path(args.cache_dir),
            args.gamedata_repository,
            args.skip_fetch,
        )
    excel_root = find_excel_root(source_root)
    metadata = source_metadata(excel_root, args.gamedata_repository)
    report_path = resolve_path(args.report)

    print(json.dumps({
        "excelRoot": str(excel_root),
        "source": metadata,
        "mode": "data-only" if args.data_only else "full",
    }, ensure_ascii=False, indent=2), flush=True)

    build_structured_data(excel_root)
    if not args.skip_public_assets:
        build_public_assets(excel_root)
    game_root = None
    if not args.data_only:
        game_root = resolve_path(args.game_root)
        if not game_root.is_dir():
            raise FileNotFoundError(f"Arknights game root does not exist: {game_root}")
        build_client_assets(game_root, excel_root, args.force_assets)

    build_anomaly_data(excel_root)
    if game_root:
        build_anomaly_skin_art(game_root, args.force_assets)

    report = validate(metadata, report_path, strict_assets=not args.data_only)
    run_tests(report, full_update=not args.data_only)
    print(json.dumps({
        "result": report["status"],
        "operators": report["counts"]["operators"],
        "sourceRevision": metadata["revision"],
        "report": str(report_path),
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
