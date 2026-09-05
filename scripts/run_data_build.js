const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const venvConfig = path.join(ROOT, ".venv", "pyvenv.cfg");
const venvPython = process.platform === "win32"
  ? path.join(ROOT, ".venv", "Scripts", "python.exe")
  : path.join(ROOT, ".venv", "bin", "python");

const hasConfig = fs.existsSync(venvConfig);
const hasPython = fs.existsSync(venvPython);
if (hasConfig !== hasPython) {
  console.error("Incomplete .venv detected; keep it untouched and repair or move it before building data.");
  process.exit(1);
}

const python = hasConfig
  ? venvPython
  : (process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"));

function hasExcelTables(candidate) {
  const tables = [
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
  ];
  return tables.every((table) => fs.existsSync(path.join(candidate, table)));
}

function resolveLocalGameDataRoot() {
  const configured = process.env.ARKNIGHTS_GAMEDATA_ROOT;
  const candidates = [];
  if (configured) {
    candidates.push(configured);
    candidates.push(path.join(configured, "zh_CN", "gamedata", "excel"));
    candidates.push(path.join(configured, "cn", "gamedata", "excel"));
    candidates.push(path.join(configured, "gamedata", "excel"));
  }
  candidates.push(path.join(ROOT, ".gamedata"));
  candidates.push(path.join(ROOT, ".gamedata", "excel"));
  candidates.push(path.join(ROOT, ".gamedata", "zh_CN", "gamedata", "excel"));
  candidates.push(path.join(ROOT, ".gamedata", "cn", "gamedata", "excel"));
  candidates.push(path.join(ROOT, ".cache", "arknights-gamedata"));
  candidates.push(path.join(ROOT, ".cache", "arknights-gamedata", "zh_CN", "gamedata", "excel"));
  candidates.push(path.join(ROOT, ".cache", "arknights-gamedata", "cn", "gamedata", "excel"));
  return candidates.find(hasExcelTables) || candidates[0] || path.join(ROOT, ".gamedata");
}

const result = spawnSync(python, [
  path.join(__dirname, "update_game_data.py"),
  "--data-only",
  "--skip-public-assets",
  "--gamedata-root",
  resolveLocalGameDataRoot(),
], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status || 1);
