const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { currentRelease, healthPayload, releaseFromFile } = require("../../lib/health.js");
const smoke = require("../../scripts/check_deployment.js");

const ROOT = path.resolve(__dirname, "../..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error("server did not start within 15 seconds"));
        return;
      }
      try {
        const response = await fetch(baseUrl + "/api/health");
        if (response.ok) {
          clearInterval(interval);
          resolve();
        }
      } catch (error) {
        // The child is still loading server-only data.
      }
    }, 100);
    child.once("exit", (code, signal) => {
      clearInterval(interval);
      reject(new Error("server exited before readiness (code " + code + ", signal " + signal + ")"));
    });
  });
}

async function withServer(environment, callback) {
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, ["server.js", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const baseUrl = "http://127.0.0.1:" + port;
  try {
    await waitForServer(child, baseUrl);
    await callback(baseUrl);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

async function runSmoke(args) {
  const originalArgv = process.argv;
  const originalLog = console.log;
  let output = "";
  process.argv = [process.execPath, "scripts/check_deployment.js", ...args];
  console.log = (message) => { output += String(message) + "\n"; };
  try {
    await smoke.main();
    return { error: null, output };
  } catch (error) {
    return { error, output };
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
}

async function withSmokeFixture(includeAnomalyToken, callback) {
  const commit = "89abcdef0123456789abcdef0123456789abcdef";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (url.pathname === "/api/health") {
      res.setHeader("Cache-Control", "public, no-store, no-store");
      return res.end(JSON.stringify({ status: "ok", release: commit }));
    }
    if (url.pathname === "/api/new") {
      return res.end(JSON.stringify({ mode: url.searchParams.get("mode"), token: "fixture-token" }));
    }
    if (url.pathname === "/api/anomaly/new") {
      const body = { question: { options: [{}, {}, {}, {}] } };
      if (includeAnomalyToken) body.token = "fixture-token";
      return res.end(JSON.stringify(body));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const port = await listen(server);
  try {
    await callback("http://127.0.0.1:" + port, commit);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "arknight-health-"));
  const fixturePath = path.join(fixtureDirectory, "deployment-version.json");
  const commit = "0123456789abcdef0123456789abcdef01234567";
  try {
    assert.strictEqual(releaseFromFile(fixturePath), "local");
    fs.writeFileSync(fixturePath, JSON.stringify({ commit }));
    assert.strictEqual(releaseFromFile(fixturePath), commit);
    assert.deepStrictEqual(healthPayload(fixtureDirectory), { status: "ok", release: commit });
    assert.strictEqual(currentRelease(fixtureDirectory), commit);
    fs.writeFileSync(fixturePath, JSON.stringify({ commit: "not-a-commit" }));
    assert.strictEqual(releaseFromFile(fixturePath), "local");
    assert.deepStrictEqual(healthPayload(fixtureDirectory), { status: "ok", release: "local" });
    assert.strictEqual(currentRelease(fixtureDirectory), "local");
  } finally {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  }

  await withServer({ SERVE_STATIC: "false" }, async (baseUrl) => {
    const health = await fetch(baseUrl + "/api/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.headers.get("cache-control"), "no-store");
    assert.deepStrictEqual(await health.json(), healthPayload(ROOT));

    const head = await fetch(baseUrl + "/api/health", { method: "HEAD" });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.headers.get("cache-control"), "no-store");
    assert.strictEqual(await head.text(), "");

    const method = await fetch(baseUrl + "/api/health", { method: "POST" });
    assert.strictEqual(method.status, 405);
    assert.strictEqual(method.headers.get("allow"), "GET, HEAD");
    assert.deepStrictEqual(await method.json(), { error: "method_not_allowed" });

    const staticResponse = await fetch(baseUrl + "/");
    assert.strictEqual(staticResponse.status, 404);
  });

  await withSmokeFixture(true, async (baseUrl, commit) => {
    const success = await runSmoke(["--base-url", baseUrl, "--expected-commit", commit]);
    assert.strictEqual(success.error, null, success.output);
    assert.match(success.output, /anomaly opening passed/);

    const wrongCommit = await runSmoke(["--base-url", baseUrl, "--expected-commit", "0123456789abcdef0123456789abcdef01234567"]);
    assert.match(wrongCommit.error.message, /does not match/);
  });
  await withSmokeFixture(false, async (baseUrl, commit) => {
    const missingToken = await runSmoke(["--base-url", baseUrl, "--expected-commit", commit]);
    assert.match(missingToken.error.message, /anomaly opening did not return a playable session/);
  });

  console.log("deployment health tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
