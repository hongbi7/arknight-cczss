"""Fast regression checks for the data-update guard rails.

These tests inspect source/configuration only and do not rebuild or load the
large generated operator archives.
"""

import ast
import importlib.util
import re
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


class DataPipelineRegressionTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
