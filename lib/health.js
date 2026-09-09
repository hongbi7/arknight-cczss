const fs = require("fs");
const path = require("path");

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function releaseFromFile(versionPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(versionPath, "utf8"));
    if (parsed && typeof parsed.commit === "string" && COMMIT_PATTERN.test(parsed.commit)) {
      return parsed.commit.toLowerCase();
    }
  } catch (error) {
    // A missing or incomplete deployment marker is safe to report as local.
  }
  return "local";
}

function currentRelease(rootDirectory) {
  return releaseFromFile(path.join(rootDirectory, "deployment-version.json"));
}

function healthPayload(rootDirectory) {
  return { status: "ok", release: currentRelease(rootDirectory) };
}

function handleHealth(req, res, rootDirectory) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end(JSON.stringify({ error: "method_not_allowed" }));
  }
  if (req.method === "HEAD") return res.end();
  return res.end(JSON.stringify(healthPayload(rootDirectory)));
}

module.exports = { currentRelease, handleHealth, healthPayload, releaseFromFile };
