#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { parsePagesBaseUrl, verifyImagePages } = require("./check_image_pages.js");

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value) fail(name + " is required");
  return value;
}

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value)) fail(name + " must be a positive integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(name + " is outside the safe integer range");
  return number;
}

function validateContext(env) {
  const eventName = required(env, "GITHUB_EVENT_NAME");
  const ref = required(env, "GITHUB_REF");
  if (!((eventName === "push" || eventName === "workflow_dispatch") && ref === "refs/heads/main")) {
    fail("Image Pages releases may only be recorded for a main-branch push or workflow dispatch");
  }
  const repository = required(env, "GITHUB_REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail("GITHUB_REPOSITORY must be an owner/name repository");
  const sha = required(env, "GITHUB_SHA").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) fail("GITHUB_SHA must be a 40-character hexadecimal commit SHA");
  const project = required(env, "CLOUDFLARE_PAGES_PROJECT").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(project)) fail("CLOUDFLARE_PAGES_PROJECT is invalid");
  const baseUrl = parsePagesBaseUrl(required(env, "PAGES_DEPLOYMENT_URL"));
  if (!new URL(baseUrl).hostname.endsWith("." + project + ".pages.dev")) {
    fail("PAGES_DEPLOYMENT_URL must belong to CLOUDFLARE_PAGES_PROJECT");
  }
  const expectedDigest = env.IMAGE_PAGES_ASSET_SET_SHA256 == null || env.IMAGE_PAGES_ASSET_SET_SHA256 === ""
    ? null
    : env.IMAGE_PAGES_ASSET_SET_SHA256.toLowerCase();
  if (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    fail("IMAGE_PAGES_ASSET_SET_SHA256 must be a 64-character hexadecimal SHA-256");
  }
  return {
    token: required(env, "GITHUB_TOKEN"),
    repository,
    sha,
    runId: positiveInteger(required(env, "GITHUB_RUN_ID"), "GITHUB_RUN_ID"),
    runAttempt: positiveInteger(required(env, "GITHUB_RUN_ATTEMPT"), "GITHUB_RUN_ATTEMPT"),
    project,
    baseUrl,
    expectedDigest,
  };
}

async function readResponse(response) {
  if (!response || !response.headers || typeof response.arrayBuffer !== "function") fail("GitHub API returned an invalid response");
  const contentLength = response.headers.get("content-length");
  if (contentLength && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
    fail("GitHub API response exceeds the allowed size");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RESPONSE_BYTES) fail("GitHub API response exceeds the allowed size");
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      length += chunk.length;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail("GitHub API response exceeds the allowed size");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function githubPost(fetchImpl, context, endpoint, body) {
  const url = GITHUB_API + "/repos/" + context.repository + endpoint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + context.token,
        "Content-Type": "application/json",
        "User-Agent": "arknight-image-pages-release",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    return { response, body: await readResponse(response) };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(body, label) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    fail(label + " did not return JSON");
  }
}

function verifyResult(result) {
  if (!result || !/^[0-9a-f]{64}$/i.test(result.digest)) fail("Image Pages verification returned an invalid digest");
  if (!Array.isArray(result.samples) || !result.samples.length || typeof result.samples[0] !== "string" || !result.samples[0].startsWith("/img/")) {
    fail("Image Pages verification returned no valid sample path");
  }
  return { digest: result.digest.toLowerCase(), samplePath: result.samples[0] };
}

function deploymentPayload(context, verified) {
  return {
    ref: context.sha,
    auto_merge: false,
    required_contexts: [],
    task: "deploy:images",
    environment: "cloudflare-images",
    transient_environment: false,
    production_environment: false,
    payload: {
      schemaVersion: 1,
      kind: "arknight-image-pages-release",
      commit: context.sha,
      repository: context.repository,
      workflow: "production-ci.yml",
      runId: context.runId,
      runAttempt: context.runAttempt,
      project: context.project,
      baseUrl: context.baseUrl,
      assetSetSha256: verified.digest,
      samplePath: verified.samplePath,
    },
  };
}

function writeSummary(env, context, verified, deploymentId) {
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const text = [
    "## Cloudflare Pages image release",
    "",
    "- Commit: `" + context.sha + "`",
    "- Project: `" + context.project + "`",
    "- Deployment URL: " + context.baseUrl,
    "- Asset-set SHA-256: `" + verified.digest + "`",
    "- Sample: `" + verified.samplePath + "`",
    "- GitHub deployment: `" + deploymentId + "`",
    "",
  ].join("\n");
  fs.appendFileSync(path.resolve(summaryPath), text, "utf8");
}

async function recordImagePagesRelease(options = {}) {
  const env = options.env || process.env;
  const context = validateContext(env);
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") fail("A fetch implementation is required");
  const verify = options.verifyImagePages || verifyImagePages;
  if (typeof verify !== "function") fail("An image Pages verifier is required");

  // No GitHub write happens until the pinned, unique Pages URL is fully verified.
  const verified = verifyResult(await verify({
    baseUrl: context.baseUrl,
    localRoot: options.localRoot || path.resolve(__dirname, ".."),
    fetchImpl: options.imageFetchImpl,
    expectedDigest: context.expectedDigest,
  }));
  const created = await githubPost(fetchImpl, context, "/deployments", deploymentPayload(context, verified));
  if (created.response.status !== 201) fail("GitHub deployment creation returned HTTP " + created.response.status);
  const deployment = parseJson(created.body, "GitHub deployment creation");
  if (!deployment || !Number.isSafeInteger(deployment.id) || deployment.id <= 0 || String(deployment.sha || "").toLowerCase() !== context.sha) {
    fail("GitHub deployment creation did not return the expected deployment ID and commit SHA");
  }
  const status = await githubPost(fetchImpl, context, "/deployments/" + deployment.id + "/statuses", {
    state: "success",
    auto_inactive: false,
    environment_url: context.baseUrl,
    log_url: "https://github.com/" + context.repository + "/actions/runs/" + context.runId,
  });
  if (status.response.status !== 201) fail("GitHub deployment status creation returned HTTP " + status.response.status);
  const deploymentStatus = parseJson(status.body, "GitHub deployment status creation");
  if (!deploymentStatus || !Number.isSafeInteger(deploymentStatus.id) || deploymentStatus.id <= 0 || deploymentStatus.state !== "success" || deploymentStatus.environment_url !== context.baseUrl) {
    fail("GitHub deployment status creation did not confirm the expected success status and environment URL");
  }
  writeSummary(env, context, verified, deployment.id);
  return {
    repository: context.repository,
    sha: context.sha,
    runId: context.runId,
    runAttempt: context.runAttempt,
    project: context.project,
    baseUrl: context.baseUrl,
    digest: verified.digest,
    samplePath: verified.samplePath,
    deploymentId: deployment.id,
    deploymentStatusId: deploymentStatus.id,
  };
}

async function main() {
  const result = await recordImagePagesRelease();
  console.log("Recorded verified Cloudflare Pages image deployment " + result.deploymentId + " for " + result.sha + ".");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Cloudflare Pages image release was not recorded: " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { GITHUB_API, deploymentPayload, recordImagePagesRelease, validateContext, verifyResult };
