const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parsePagesBaseUrl,
  validateManifest,
  verifyImagePages,
} = require("../../scripts/check_image_pages.js");
const { buildImagePages } = require("../../scripts/build_image_pages.js");

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arknight-image-pages-check-"));
  fs.mkdirSync(path.join(root, "public", "img", "operators"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "img", "operators", "a.webp"), "a-image");
  fs.writeFileSync(path.join(root, "public", "img", "operators", "b.webp"), "b-image-is-larger");
  return root;
}

function localFiles(root) {
  const imageRoot = path.join(root, "public", "img");
  return ["operators/a.webp", "operators/b.webp"].map((relative) => {
    const content = fs.readFileSync(path.join(imageRoot, relative));
    return { path: "/img/" + relative, size: content.length, sha256: hash(content) };
  });
}

function manifestFor(root) {
  const files = localFiles(root);
  return { schemaVersion: 1, kind: "arknight-image-pages", files, assetSetSha256: hash(JSON.stringify(files)) };
}

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

function fetchFor(root, manifest, options = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/assets-manifest.json") return response(200, JSON.stringify(manifest), { "content-type": "application/json" });
    if (parsed.pathname.startsWith("/img/__missing-")) return response(options.missingStatus || 404, "missing");
    const relative = parsed.pathname.slice("/img/".length);
    const source = path.join(root, "public", "img", ...relative.split("/"));
    if (!fs.existsSync(source)) return response(404, "missing");
    return response(200, options.htmlImage ? "<html>not an image</html>" : fs.readFileSync(source), {
      "content-type": options.htmlImage ? "text/html" : "image/webp",
      "access-control-allow-origin": "*",
    });
  };
}

async function withFixture(callback) {
  const root = fixture();
  try {
    await callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function main() {
  assert.strictEqual(parsePagesBaseUrl("https://ABCDEF12.game-images.pages.dev").startsWith("https://abcdef12.game-images.pages.dev"), true);
  for (const value of ["https://game-images.pages.dev", "http://abcdef12.game-images.pages.dev", "https://preview.game-images.pages.dev", "https://abcdef12.game-images.pages.dev/path"]) {
    assert.throws(() => parsePagesBaseUrl(value), /Pages deployment|unique/);
  }

  await withFixture(async (root) => {
    const manifest = manifestFor(root);
    const result = await verifyImagePages({
      baseUrl: "https://abcdef12.game-images.pages.dev",
      localRoot: root,
      fetchImpl: fetchFor(root, manifest),
      missingSuffix: "fixture",
    });
    assert.strictEqual(result.files, 2);
    assert.deepStrictEqual(result.samples, ["/img/operators/a.webp", "/img/operators/b.webp"]);
    assert.strictEqual(result.digest, manifest.assetSetSha256);
    const expected = await verifyImagePages({
      baseUrl: "https://abcdef12.game-images.pages.dev",
      localRoot: root,
      fetchImpl: fetchFor(root, manifest),
      expectedDigest: manifest.assetSetSha256,
      missingSuffix: "expected-digest",
    });
    assert.strictEqual(expected.digest, manifest.assetSetSha256);
    await assert.rejects(() => verifyImagePages({
      baseUrl: "https://abcdef12.game-images.pages.dev",
      localRoot: root,
      fetchImpl: fetchFor(root, manifest),
      expectedDigest: "a".repeat(64),
      missingSuffix: "wrong-expected-digest",
    }), /expectedDigest/);
    await assert.rejects(() => verifyImagePages({
      baseUrl: "https://abcdef12.game-images.pages.dev",
      localRoot: root,
      fetchImpl: fetchFor(root, manifest),
      expectedDigest: "not-a-digest",
    }), /64-character hexadecimal/);
  });

  await withFixture(async (root) => {
    const imageRoot = path.join(root, "public", "img", "operators");
    for (const name of ["Z-last.webp", "_under.webp", "9-number.webp", "a-lower.webp"]) {
      fs.writeFileSync(path.join(imageRoot, name), name);
    }
    const built = buildImagePages({ repoRoot: root });
    const manifest = JSON.parse(fs.readFileSync(path.join(built.report.outputDirectory, "assets-manifest.json"), "utf8"));
    const result = await verifyImagePages({
      baseUrl: "https://abcdef12.game-images.pages.dev",
      localRoot: root,
      fetchImpl: fetchFor(root, manifest),
      missingSuffix: "built-output",
    });
    assert.strictEqual(result.digest, manifest.assetSetSha256);
    assert.deepStrictEqual(manifest.files.map((file) => file.path), manifest.files.map((file) => file.path).slice().sort());
  });

  await withFixture(async (root) => {
    const manifest = manifestFor(root);
    manifest.files[0].size += 1;
    manifest.assetSetSha256 = hash(JSON.stringify(manifest.files));
    await assert.rejects(() => verifyImagePages({ baseUrl: "https://abcdef12.game-images.pages.dev", localRoot: root, fetchImpl: fetchFor(root, manifest) }), /manifest differ/);
  });

  for (const files of [
    [{ path: "/img/../secret.webp", size: 1, sha256: "a".repeat(64) }],
    [{ path: "/img/operators/name:alternate.webp", size: 1, sha256: "a".repeat(64) }],
    [{ path: "/img/a.webp", size: 1, sha256: "a".repeat(64) }, { path: "/img/a.webp", size: 1, sha256: "a".repeat(64) }],
  ]) {
    const manifest = { schemaVersion: 1, kind: "arknight-image-pages", files, assetSetSha256: hash(JSON.stringify(files)) };
    assert.throws(() => validateManifest(manifest), /unsafe segment|duplicate|Invalid image manifest path/);
  }

  await withFixture(async (root) => {
    const manifest = manifestFor(root);
    await assert.rejects(() => verifyImagePages({ baseUrl: "https://abcdef12.game-images.pages.dev", localRoot: root, fetchImpl: fetchFor(root, manifest, { htmlImage: true }) }), /image content type/);
    await assert.rejects(() => verifyImagePages({ baseUrl: "https://abcdef12.game-images.pages.dev", localRoot: root, fetchImpl: fetchFor(root, manifest, { missingStatus: 200 }) }), /must return HTTP 404/);
  });

  console.log("Cloudflare Pages image check tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
