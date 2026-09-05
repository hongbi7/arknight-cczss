"""Fast regression checks for the data-update guard rails.

These tests inspect source/configuration only and do not rebuild or load the
large generated operator archives.
"""

import ast
import hashlib
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = ROOT / "scripts" / "validate_data_update.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_data_update", VALIDATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_updater():
    path = ROOT / "scripts" / "update_game_data.py"
    spec = importlib.util.spec_from_file_location("update_game_data", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_atomic_writer():
    path = ROOT / "scripts" / "atomic_write.py"
    spec = importlib.util.spec_from_file_location("atomic_write", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DataPipelineRegressionTests(unittest.TestCase):
    def test_atomic_writer_replaces_existing_file_with_lf_text(self):
        writer = load_atomic_writer()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "generated.json"
            target.write_bytes(b"old\r\n")
            writer.atomic_write_text(target, "new\n")
            self.assertEqual(target.read_bytes(), b"new\n")
            self.assertEqual(list(target.parent.glob(".generated.json.*.tmp")), [])

    def test_workflow_stages_every_generated_data_file(self):
        validator = load_validator()
        workflow = (ROOT / ".github" / "workflows" / "update-game-data.yml").read_text(encoding="utf-8")
        if "validate_data_update.py --list-generated-files" in workflow:
            self.assertIn('"${generated_data_files[@]}"', workflow)
            return
        staged = set(re.findall(r"(?m)(?:public|server-data)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", workflow))
        missing = sorted(set(validator.GENERATED_DATA_FILES) - staged)
        self.assertFalse(missing, f"workflow staging list omits generated files: {missing}")

    def test_anomaly_builder_does_not_read_theme_bank_as_input(self):
        source = (ROOT / "scripts" / "build_anomaly_data.py").read_text(encoding="utf-8")
        self.assertNotIn("operator-themes.json", source)
        tree = ast.parse(source)
        forbidden = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            if not isinstance(node.func, ast.Name) or node.func.id != "load_json":
                continue
            text = ast.unparse(node.args[0])
            if "operator-themes.json" in text:
                forbidden.append(text)
        self.assertFalse(forbidden, "anomaly builder reads operator-themes as an input")

    def test_local_asset_refresh_rebuilds_asset_sensitive_banks(self):
        source = (ROOT / "scripts" / "update_game_data.py").read_text(encoding="utf-8")
        convergence_pass = re.compile(
            r"if game_root:\s+"
            r"build_anomaly_skin_art\([^\n]+\)\s+"
            r"(?:#[^\n]*\s+)*"
            r"build_anomaly_data\(excel_root\)\s+"
            r"build_theme_bank\(excel_root\)",
        )
        self.assertRegex(source, convergence_pass)

    def test_version_digest_check_is_explicit(self):
        source = VALIDATOR_PATH.read_text(encoding="utf-8")
        self.assertIn("--verify-existing-version", source)
        self.assertIn("verify_version_manifest", source)
        self.assertNotIn("version_path=args.version,\n    )\n    write_json", source)

    def test_version_digest_check_detects_stale_record(self):
        validator = load_validator()
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "version.json"
            manifest.write_text(
                '{"generatedData": {"public/data/names.json": {"bytes": 1, "sha256": "old"}}}',
                encoding="utf-8",
            )
            errors = validator.verify_version_manifest(
                manifest,
                {"public/data/names.json": {"bytes": 2, "sha256": "new"}},
            )
        self.assertEqual(errors, ["version manifest digest mismatch: public/data/names.json"])

    def test_file_digest_normalizes_windows_line_endings(self):
        validator = load_validator()
        original_root = validator.PROJECT_ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative_path = "sample.json"
            (root / relative_path).write_bytes(b'{\r\n  "ok": true\r\n}\r\n')
            validator.PROJECT_ROOT = root
            try:
                digest = validator.file_digest(relative_path)
            finally:
                validator.PROJECT_ROOT = original_root
        normalized = b'{\n  "ok": true\n}\n'
        self.assertEqual(digest, {
            "bytes": len(normalized),
            "sha256": hashlib.sha256(normalized).hexdigest(),
        })

    def test_anomaly_fingerprint_normalizes_line_endings(self):
        builder_path = ROOT / "scripts" / "build_anomaly_data.py"
        spec = importlib.util.spec_from_file_location("build_anomaly_data", builder_path)
        module = importlib.util.module_from_spec(spec)
        scripts_path = str(builder_path.parent)
        added_path = scripts_path not in sys.path
        if added_path:
            sys.path.insert(0, scripts_path)
        try:
            spec.loader.exec_module(module)
        finally:
            if added_path:
                sys.path.remove(scripts_path)
        with tempfile.TemporaryDirectory() as directory:
            sample_path = Path(directory) / "sample.txt"
            sample_path.write_bytes(b"first\r\nsecond\rthird\n")
            self.assertEqual(module.normalized_text_bytes(sample_path), b"first\nsecond\nthird\n")

    def test_public_mirror_partial_summary_is_preserved_only_in_full_report(self):
        validator = load_validator()
        summary = validator.summarize_public_mirror({
            "status": "partial",
            "repository": "https://example.invalid/assets.git",
            "revision": "abc123",
            "downloaded": ["one.png"],
            "notFound": ["missing.png", "missing.png"],
            "errors": ["timeout.png: timed out"],
            "operatorsMissingE1": ["char_new", "char_new"],
        })
        self.assertEqual(summary["downloadedCount"], 1)
        self.assertEqual(summary["status"], "partial")
        self.assertEqual(summary["notFound"], ["missing.png"])
        self.assertEqual(summary["operatorsMissingE1"], ["char_new"])

        compact = validator.compact_version({
            "schemaVersion": 1,
            "status": "asset_refresh_required",
            "source": {},
            "counts": {},
            "manualReview": {},
            "requiredAssets": {},
            "optionalSkillIcons": [],
            "attentionCoverage": {},
            "generatedData": {},
            "publicMirror": summary,
        })
        self.assertNotIn("publicMirror", compact)

    def test_unavailable_public_mirror_keeps_last_known_revision(self):
        updater = load_updater()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_path = root / "public-report.json"
            version_path = root / "data-version.json"
            report_path.write_text(
                '{"status":"unavailable","repository":"https://example.invalid/assets.git"}',
                encoding="utf-8",
            )
            version_path.write_text(
                '{"source":{"assetRepository":"https://example.invalid/assets.git",'
                '"assetRevision":"known-revision"}}',
                encoding="utf-8",
            )
            metadata = {}
            updater.merge_public_asset_metadata(metadata, report_path, version_path)

        self.assertEqual(metadata, {
            "assetRepository": "https://example.invalid/assets.git",
            "assetRevision": "known-revision",
        })


if __name__ == "__main__":
    unittest.main()
