"""Regression tests for partially updated public artwork mirrors."""

import importlib.util
import ast
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fetch = load_script("fetch_public_assets")
extract_tree = ast.parse((ROOT / "scripts" / "extract_operator_art.py").read_text(encoding="utf-8"))
extract_nodes = [
    node for node in extract_tree.body
    if isinstance(node, ast.FunctionDef) and node.name in {"public_asset_exists", "can_reuse_manifest"}
]
extract_namespace = {"Path": Path}
exec(compile(ast.Module(body=extract_nodes, type_ignores=[]), "extract_operator_art.py", "exec"), extract_namespace)


class PartialAssetRefreshTests(unittest.TestCase):
    def test_desired_skin_asset_is_data_fingerprint(self):
        operator = {"id": "char_001", "rarity": 6}
        self.assertEqual(fetch.resolve_final_asset(operator, {"portraitId": "skin_new"}), "skin_new")

    def test_missing_only_does_not_reuse_old_final_for_new_skin(self):
        with tempfile.TemporaryDirectory() as directory:
            public_root = Path(directory)
            (public_root / "img/operators/e1").mkdir(parents=True)
            (public_root / "img/operators/final").mkdir(parents=True)
            (public_root / "img/operators/e1/char_001.webp").write_bytes(b"e1")
            (public_root / "img/operators/final/char_001.webp").write_bytes(b"old")
            existing = {
                "e1": "/img/operators/e1/char_001.webp",
                "final": "/img/operators/final/char_001.webp",
                "finalAsset": "skin_old",
            }
            can_reuse = extract_namespace["can_reuse_manifest"]
            self.assertFalse(can_reuse(existing, public_root, "skin_new"))
            existing["finalAsset"] = "skin_new"
            self.assertTrue(can_reuse(existing, public_root, "skin_new"))

    def test_partial_mirror_marks_retained_old_final_as_pending(self):
        class MissingFetcher:
            @staticmethod
            def image(_candidates):
                return None, None

        with tempfile.TemporaryDirectory() as directory:
            public_root = Path(directory)
            manifest_path = public_root / "data/operator-art.json"
            e1_path = public_root / "img/operators/e1/char_001.webp"
            final_path = public_root / "img/operators/final/char_001.webp"
            manifest_path.parent.mkdir(parents=True)
            e1_path.parent.mkdir(parents=True)
            final_path.parent.mkdir(parents=True)
            e1_path.write_bytes(b"e1")
            final_path.write_bytes(b"old")
            manifest_path.write_text(
                '{"char_001":{"e1":"/img/operators/e1/char_001.webp",'
                '"final":"/img/operators/final/char_001.webp",'
                '"e1Asset":"char_001_1","finalAsset":"skin_old",'
                '"finalKind":"skin","finalTitle":"Old","finalGroup":"Old"}}',
                encoding="utf-8",
            )

            fetch.build_operator_art(
                MissingFetcher(),
                {"Operator": {"id": "char_001", "rarity": 6}},
                {"char_001": {"portraitId": "skin_new", "skinName": "New", "skinGroup": "New"}},
                public_root,
            )
            record = fetch.json.loads(manifest_path.read_text(encoding="utf-8"))["char_001"]

        self.assertEqual(record["finalAsset"], "skin_old")
        self.assertEqual(record["pendingAsset"], "skin_new")

    def test_pending_asset_is_not_reusable(self):
        existing = {"finalAsset": "skin_new", "pendingAsset": "skin_new"}
        self.assertFalse(extract_namespace["can_reuse_manifest"](existing, Path("."), "skin_new"))


if __name__ == "__main__":
    unittest.main()
