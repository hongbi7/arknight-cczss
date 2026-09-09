const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { deploymentPayload } = require("../../scripts/record_image_pages.js");

// Feed the publisher's actual JSON contract to the Python deployer. Separate
// hand-written fixtures previously hid a ref=SHA vs ref=main mismatch.
const context = {
  sha: "a".repeat(40),
  repository: "hongbi7/arknight-cczss",
  project: "arknight-image-test",
  baseUrl: "https://12345678.arknight-image-test.pages.dev",
  runId: 123456,
  runAttempt: 2,
};
const published = deploymentPayload(context, {
  digest: "b".repeat(64),
  samplePath: "/img/operators/final/sample.webp",
});
const python = `
import importlib.util, json, pathlib, sys
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location("pull_deploy", root / "deploy" / "pull_deploy.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
body = json.load(sys.stdin)
payload = body["payload"]
record = dict(body, id=998, sha=body["ref"])
config = {"repository": payload["repository"], "workflow": "production-ci.yml", "branch": "main",
          "root_dir": str(root), "deploy_user": "arkdeploy", "app_user": "arkguess",
          "image_pages": {"project": payload["project"]}}
def api(endpoint):
    if "/statuses?" in endpoint:
        return [{"state": "success", "environment_url": payload["baseUrl"]}]
    return [record]
deployer = module.PullDeployer(config, api_json=api)
run = {"id": payload["runId"], "attempt": payload["runAttempt"]}
accepted = deployer.image_pages_binding(payload["commit"], run)
assert accepted and accepted["payload"] == payload, "CI output was rejected by ECS"
wrong_attempt = dict(run, attempt=run["attempt"] + 1)
assert deployer.image_pages_binding(payload["commit"], wrong_attempt) is None, "wrong CI attempt was accepted"
print(json.dumps({"baseUrl": accepted["payload"]["baseUrl"], "commit": accepted["payload"]["commit"]}))
`;
const result = spawnSync(process.env.PYTHON || "python", ["-c", python], {
  cwd: path.resolve(__dirname, "..", ".."),
  input: JSON.stringify(published),
  encoding: "utf8",
  timeout: 20000,
});
if (result.error) throw result.error;
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
const accepted = JSON.parse(result.stdout);
assert.strictEqual(accepted.baseUrl, context.baseUrl);
assert.strictEqual(accepted.commit, context.sha);
console.log("Cloudflare Pages CI-to-ECS contract test passed");
