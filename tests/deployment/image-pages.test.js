const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildImagePages,
  MANIFEST_KIND,
  MAX_FILE_BYTES,
} = require("../../scripts/build_image_pages.js");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arknight-image-pages-"));
  fs.mkdirSync(path.join(root, "public", "img", "operators"), { recursive: true });
  return root;
}

function writeImage(root, relativePath, content = "image") {
  const filePath = path.join(root, "public", "img", ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function outputDirectory(root) {
  return path.join(root, "output", "cloudflare-pages");
}

function withFixture(callback) {
  const root = makeFixture();
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function main() {
  withFixture((root) => {
    writeImage(root, "operators/a.webp", "portrait-a");
    writeImage(root, "icons/logo.SVG", "logo");
    fs.mkdirSync(path.join(root, "server-data"), { recursive: true });
    fs.writeFileSync(path.join(root, "server-data", "operators.json"), "private archive");
    fs.writeFileSync(path.join(root, "public", "index.html"), "application page");

    const first = buildImagePages({ repoRoot: root });
    const destination = outputDirectory(root);
    const manifestPath = path.join(destination, "assets-manifest.json");
    const manifestText = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    assert.strictEqual(manifest.schemaVersion, 1);
    assert.strictEqual(manifest.kind, MANIFEST_KIND);
    assert.deepStrictEqual(manifest.files.map((file) => file.path), ["/img/icons/logo.SVG", "/img/operators/a.webp"]);
    assert.strictEqual(fs.readFileSync(path.join(destination, "img", "operators", "a.webp"), "utf8"), "portrait-a");
    assert.strictEqual(fs.existsSync(path.join(destination, "server-data", "operators.json")), false);
    assert.strictEqual(fs.existsSync(path.join(destination, "public", "index.html")), false);
    assert.match(fs.readFileSync(path.join(destination, "404.html"), "utf8"), /404 Not Found/);
    assert.match(fs.readFileSync(path.join(destination, "_headers"), "utf8"), /Access-Control-Allow-Origin: \*/);
    assert.strictEqual(first.report.files, 6);
    assert.strictEqual(first.report.samplePath, "/img/icons/logo.SVG");

    fs.writeFileSync(path.join(destination, "stale-file.txt"), "remove me");
    const second = buildImagePages({ repoRoot: root });
    assert.strictEqual(second.manifest.assetSetSha256, first.manifest.assetSetSha256);
    assert.strictEqual(fs.readFileSync(manifestPath, "utf8"), manifestText);
    assert.strictEqual(fs.existsSync(path.join(destination, "stale-file.txt")), false);
  });

  withFixture((root) => {
    writeImage(root, "operators/a.webp");
    fs.writeFileSync(path.join(root, "public", "img", "notes.txt"), "not an image");
    assert.throws(() => buildImagePages({ repoRoot: root }), /non-image file/);
    assert.strictEqual(fs.existsSync(outputDirectory(root)), false);
  });

  withFixture((root) => {
    writeImage(root, "operators/unsafe%name.webp");
    assert.throws(() => buildImagePages({ repoRoot: root }), /cannot be represented safely/);
    assert.strictEqual(fs.existsSync(outputDirectory(root)), false);
  });

  withFixture((root) => {
    writeImage(root, "operators/too-large.webp", Buffer.alloc(MAX_FILE_BYTES + 1));
    assert.throws(() => buildImagePages({ repoRoot: root }), /25 MiB file limit/);
    assert.strictEqual(fs.existsSync(outputDirectory(root)), false);
  });

  withFixture((root) => {
    writeImage(root, "operators/a.webp");
    fs.mkdirSync(outputDirectory(root), { recursive: true });
    fs.writeFileSync(path.join(outputDirectory(root), "assets-manifest.json"), JSON.stringify({ kind: "someone-elses-output" }));
    assert.throws(() => buildImagePages({ repoRoot: root }), /unknown output directory/);
  });

  withFixture((root) => {
    const target = writeImage(root, "operators/a.webp");
    const linked = path.join(root, "public", "img", "operators", "linked.webp");
    try {
      fs.symlinkSync(target, linked, "file");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") return;
      throw error;
    }
    assert.throws(() => buildImagePages({ repoRoot: root }), /symbolic link/);
  });

  withFixture((root) => {
    writeImage(root, "operators/a.webp");
    const publicDirectory = path.join(root, "public");
    const targetDirectory = path.join(root, "public-target");
    fs.renameSync(publicDirectory, targetDirectory);
    try {
      fs.symlinkSync(targetDirectory, publicDirectory, "junction");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") return;
      throw error;
    }
    assert.throws(() => buildImagePages({ repoRoot: root }), /Public directory must not be a symbolic link/);
  });

  console.log("Cloudflare Pages image export tests passed");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
