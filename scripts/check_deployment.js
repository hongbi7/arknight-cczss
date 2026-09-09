#!/usr/bin/env node
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const TIMEOUT_MS = 15000;

function usage() {
  console.log("Usage: node scripts/check_deployment.js [--base-url URL] [--expected-commit SHA]");
}

function option(name) {
  const prefix = "--" + name;
  const inline = process.argv.find((arg) => arg.startsWith(prefix + "="));
  if (inline) return inline.slice(prefix.length + 1);
  const index = process.argv.indexOf(prefix);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

function fail(message) {
  throw new Error(message);
}

function containsObviousAnswerLeak(value) {
  if (!value || typeof value !== "object") return false;
  const forbiddenKeys = new Set(["answer", "answerid", "answername", "secret", "target", "targetid", "targetname", "oddid", "ruleid"]);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenKeys.has(key.toLowerCase())) return true;
      stack.push(child);
    }
  }
  return false;
}

async function requestJson(baseUrl, pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) fail(pathname + " returned HTTP " + response.status);
    let body;
    try {
      body = await response.json();
    } catch (error) {
      fail(pathname + " did not return valid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(pathname + " returned an invalid JSON payload");
    }
    return { body, response };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const rawBaseUrl = option("base-url") || DEFAULT_BASE_URL;
  const expectedCommit = option("expected-commit");
  if (expectedCommit && !COMMIT_PATTERN.test(expectedCommit)) {
    fail("--expected-commit must be a 40-character hexadecimal commit SHA");
  }
  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch (error) {
    fail("--base-url must be an absolute URL");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    fail("--base-url must use http or https");
  }
  if (baseUrl.username || baseUrl.password) {
    fail("--base-url must not include a username or password");
  }

  const health = await requestJson(baseUrl, "/api/health");
  const cacheControl = (health.response.headers.get("cache-control") || "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  if (!cacheControl.includes("no-store")) {
    fail("/api/health must send Cache-Control: no-store");
  }
  if (health.body.status !== "ok" || typeof health.body.release !== "string") {
    fail("/api/health returned an invalid status payload");
  }
  if (expectedCommit && health.body.release.toLowerCase() !== expectedCommit.toLowerCase()) {
    fail("/api/health release does not match --expected-commit");
  }
  if (!expectedCommit && health.body.release !== "local" && !COMMIT_PATTERN.test(health.body.release)) {
    fail("/api/health returned an invalid release value");
  }
  console.log("Health check passed (release " + health.body.release + ").");

  const openings = [
    ["sudden", "/api/new?mode=sudden&v=3"],
    ["endless", "/api/new?mode=endless&v=3"],
    ["anomaly", "/api/anomaly/new?domain=mixed"],
  ];
  for (const [mode, pathname] of openings) {
    const result = await requestJson(baseUrl, pathname);
    if (containsObviousAnswerLeak(result.body)) fail(mode + " opening contains an answer-identifying field");
    if (mode === "anomaly") {
      if (typeof result.body.token !== "string" || !result.body.token) {
        fail("anomaly opening did not return a playable session");
      }
      if (!result.body.question || !Array.isArray(result.body.question.options) || result.body.question.options.length !== 4) {
        fail("anomaly opening did not return four options");
      }
    } else if (result.body.mode !== mode || typeof result.body.token !== "string" || !result.body.token) {
      fail(mode + " opening did not return a playable session");
    }
    console.log(mode + " opening passed.");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Deployment check failed: " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { containsObviousAnswerLeak, main, requestJson };
