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

for (const script of ["build_data.py", "build_anomaly_data.py"]) {
  const result = spawnSync(python, [path.join(__dirname, script)], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
