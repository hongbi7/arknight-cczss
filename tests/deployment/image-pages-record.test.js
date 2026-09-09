const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { recordImagePagesRelease, validateContext } = require("../../scripts/record_image_pages.js");

const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);
const BASE_URL = "https://abcdef12.arknight-guess-images.pages.dev";

function environment(overrides = {}) {
  return {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "hongbi7/arknight-cczss",
    GITHUB_SHA: SHA,
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_TOKEN: "not-a-real-token",
    CLOUDFLARE_PAGES_PROJECT: "arknight-guess-images",
    PAGES_DEPLOYMENT_URL: BASE_URL,
    ...overrides,
  };
}

function verified() {
  return async (options) => {
    assert.strictEqual(options.baseUrl, BASE_URL);
    return { digest: DIGEST, samples: ["/img/operators/a.webp"] };
  };
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function main() {
  for (const env of [
    environment({ GITHUB_EVENT_NAME: "pull_request" }),
    environment({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" }),
    environment({ CLOUDFLARE_PAGES_PROJECT: "other-project" }),
  ]) {
    assert.throws(() => validateContext(env), /main-branch|belong/);
  }

  let calls = 0;
  await assert.rejects(() => recordImagePagesRelease({
    env: environment(),
    verifyImagePages: async () => {
      throw new Error("remote manifest differs");
    },
    fetchImpl: async () => {
      calls += 1;
      return response(201, {});
    },
  }), /remote manifest differs/);
  assert.strictEqual(calls, 0, "verification failure must not create a GitHub deployment");

  const summaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "arknight-image-pages-record-"));
  const summaryPath = path.join(summaryDirectory, "summary.md");
  const requests = [];
  try {
    const result = await recordImagePagesRelease({
      env: environment({ GITHUB_STEP_SUMMARY: summaryPath }),
      verifyImagePages: verified(),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith("/deployments")) return response(201, { id: 88, sha: SHA });
        if (url.endsWith("/deployments/88/statuses")) return response(201, { id: 99, state: "success", environment_url: BASE_URL });
        throw new Error("unexpected GitHub API URL");
      },
    });
    assert.strictEqual(result.deploymentId, 88);
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[0].url, "https://api.github.com/repos/hongbi7/arknight-cczss/deployments");
    assert.strictEqual(requests[1].url, "https://api.github.com/repos/hongbi7/arknight-cczss/deployments/88/statuses");
    assert.strictEqual(requests[0].options.headers.Authorization, "Bearer not-a-real-token");
    assert.strictEqual(requests[0].options.redirect, "error");
    assert.deepStrictEqual(JSON.parse(requests[0].options.body), {
      ref: SHA,
      auto_merge: false,
      required_contexts: [],
      task: "deploy:images",
      environment: "cloudflare-images",
      transient_environment: false,
      production_environment: false,
      payload: {
        schemaVersion: 1,
        kind: "arknight-image-pages-release",
        commit: SHA,
        repository: "hongbi7/arknight-cczss",
        workflow: "production-ci.yml",
        runId: 123456,
        runAttempt: 2,
        project: "arknight-guess-images",
        baseUrl: BASE_URL,
        assetSetSha256: DIGEST,
        samplePath: "/img/operators/a.webp",
      },
    });
    assert.deepStrictEqual(JSON.parse(requests[1].options.body), {
      state: "success",
      auto_inactive: false,
      environment_url: BASE_URL,
      log_url: "https://github.com/hongbi7/arknight-cczss/actions/runs/123456",
    });
    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.match(summary, /Cloudflare Pages image release/);
    assert.ok(!summary.includes("not-a-real-token"));
  } finally {
    fs.rmSync(summaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  const creationRequests = [];
  await assert.rejects(() => recordImagePagesRelease({
    env: environment(),
    verifyImagePages: verified(),
    fetchImpl: async (url, options) => {
      creationRequests.push({ url, options });
      return response(201, { id: 5, sha: "c".repeat(40) });
    },
  }), /expected deployment ID and commit SHA/);
  assert.strictEqual(creationRequests.length, 1, "a mismatched deployment SHA must not receive a success status");

  const statusRequests = [];
  await assert.rejects(() => recordImagePagesRelease({
    env: environment(),
    verifyImagePages: verified(),
    fetchImpl: async (url, options) => {
      statusRequests.push({ url, options });
      if (url.endsWith("/deployments")) return response(201, { id: 6, sha: SHA });
      return response(500, { message: "status rejected" });
    },
  }), /status creation returned HTTP 500/);
  assert.strictEqual(statusRequests.length, 2);

  await assert.rejects(() => recordImagePagesRelease({
    env: environment(),
    verifyImagePages: verified(),
    fetchImpl: async (url) => {
      if (url.endsWith("/deployments")) return response(201, { id: 7, sha: SHA });
      return response(201, { id: 10, state: "success", environment_url: "https://wrong.pages.dev" });
    },
  }), /expected success status and environment URL/);

  console.log("Cloudflare Pages image release record tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
