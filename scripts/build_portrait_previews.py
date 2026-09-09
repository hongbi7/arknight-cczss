"""Generate small card portraits; keep the existing illustrations for zooming."""

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image
from atomic_write import atomic_write_json

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = {"maxEdge": 640, "quality": 72, "method": 3}


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def build(root=ROOT, check=False):
    public = root / "public"
    portraits = public / "img/operators"
    manifest_path = public / "data/portrait-previews.json"
    cache_path = root / "server-data/portrait-previews.json"
    previous = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.is_file() else {}
    operators = json.loads((root / "server-data/operators.json").read_text(encoding="utf-8"))
    names = {name: operator["id"] for name, operator in sorted(operators.items())}
    entries = {}
    source_bytes = preview_bytes = generated = 0
    for source in sorted(portraits.rglob("*.webp")):
        relative = source.relative_to(portraits)
        if relative.parts[0] == "cards":
            continue
        url = "/img/operators/" + relative.as_posix()
        raw = source.read_bytes()
        source_hash = digest(raw)
        cached = previous.get("images", {}).get(url, {})
        destination_url = "/img/operators/cards/" + relative.as_posix()
        cached_url = cached.get("src")
        cached_path = public / cached_url.lstrip("/") if cached_url in (url, destination_url) else None
        valid = (
            previous.get("settings") == SETTINGS
            and cached.get("sourceSha256") == source_hash
            and cached_path is not None and cached_path.is_file()
            and digest(cached_path.read_bytes()) == cached.get("sha256")
            and cached_path.stat().st_size == cached.get("bytes")
        )
        if valid:
            entry = cached
        elif check:
            raise ValueError(f"Missing or stale portrait preview: {url}; run npm run build:portraits")
        else:
            with Image.open(io.BytesIO(raw)) as image:
                image = image.convert("RGBA")
                image.thumbnail((SETTINGS["maxEdge"], SETTINGS["maxEdge"]), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, "WEBP", quality=SETTINGS["quality"], method=SETTINGS["method"])
                encoded = output.getvalue()
                width, height = image.size
            # Already-small originals need no duplicate or larger derivative.
            if len(encoded) < len(raw):
                target = public / destination_url.lstrip("/")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(encoded)
            else:
                destination_url, encoded = url, raw
                with Image.open(io.BytesIO(raw)) as image:
                    width, height = image.size
            entry = {"src": destination_url, "width": width, "height": height,
                     "bytes": len(encoded), "sha256": digest(encoded), "sourceSha256": source_hash}
            generated += 1
        entries[url] = entry
        source_bytes += len(raw)
        preview_bytes += entry["bytes"]
    manifest = {"schemaVersion": 1, "settings": SETTINGS, "names": names, "images": entries}
    public_manifest = {"schemaVersion": 1, "names": names,
                       "images": {url: entry["src"] for url, entry in entries.items()}}
    if check:
        if manifest != previous:
            raise ValueError("Portrait preview manifest is stale; run npm run build:portraits")
        if not manifest_path.is_file() or json.loads(manifest_path.read_text(encoding="utf-8")) != public_manifest:
            raise ValueError("Public portrait index is stale; run npm run build:portraits")
    else:
        atomic_write_json(cache_path, manifest, separators=(",", ":"), trailing_newline=True)
        atomic_write_json(manifest_path, public_manifest, separators=(",", ":"), trailing_newline=True)
    return {"portraits": len(entries), "generated": generated,
            "sourceBytes": source_bytes, "previewBytes": preview_bytes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify committed previews without rebuilding")
    print(json.dumps(build(check=parser.parse_args().check)))
