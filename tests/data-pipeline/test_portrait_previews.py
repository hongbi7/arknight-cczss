"""Check incremental portrait generation and the committed-asset guard."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("portrait_previews", ROOT / "scripts/build_portrait_previews.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PortraitPreviewTests(unittest.TestCase):
    def test_previews_are_small_incremental_and_detect_changed_or_missing_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "public/img/operators/e1/test.webp"
            source.parent.mkdir(parents=True)
            (root / "server-data").mkdir()
            (root / "server-data/operators.json").write_text(json.dumps({
                "Example": {"id": "test", "secretArchive": "must remain private"}
            }))
            # High-frequency noise resists compression at full resolution.
            image = Image.effect_noise((1000, 1000), 70).convert("RGBA")
            image.putalpha(160)
            image.save(source, "WEBP", lossless=True)
            result = builder.build(root)
            self.assertLess(result["previewBytes"], result["sourceBytes"] / 2)
            manifest_path = root / "public/data/portrait-previews.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["names"], {"Example": "test"})
            self.assertNotIn("secretArchive", manifest_path.read_text())
            cache = json.loads((root / "server-data/portrait-previews.json").read_text())
            entry = cache["images"]["/img/operators/e1/test.webp"]
            self.assertEqual(manifest["images"]["/img/operators/e1/test.webp"], entry["src"])
            self.assertNotIn("sourceSha256", manifest_path.read_text())
            output = root / "public" / entry["src"].lstrip("/")
            with Image.open(output) as preview:
                self.assertLessEqual(max(preview.size), 640)
                self.assertEqual(preview.getpixel((0, 0))[3], 160)
            modified = output.stat().st_mtime_ns
            self.assertEqual(builder.build(root)["generated"], 0)
            self.assertEqual(output.stat().st_mtime_ns, modified)
            builder.build(root, check=True)
            output.write_bytes(b"damaged")
            with self.assertRaises(ValueError):
                builder.build(root, check=True)
            builder.build(root)
            image.putpixel((0, 0), (0, 255, 0, 20))
            image.save(source, "WEBP", lossless=True)
            with self.assertRaises(ValueError):
                builder.build(root, check=True)
            builder.build(root)
            source.unlink()
            with self.assertRaises(ValueError):
                builder.build(root, check=True)


if __name__ == "__main__":
    unittest.main()
