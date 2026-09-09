#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".avif"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_FILES = 20000;
const CONTROL_FILE_COUNT = 4;
const MANIFEST_KIND = "arknight-image-pages";

function fail(message) {
  throw new Error(message);
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizePath(value) {
  return path.resolve(value);
}

function assertDirectoryNotLink(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink()) fail(label + " must not be a symbolic link");
  if (!stat.isDirectory()) fail(label + " must be a directory");
  return true;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    let position = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead) {
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function scanImages(imageDirectory) {
  const files = [];

  function scan(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const sourcePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink()) fail("Image source contains a symbolic link: " + sourcePath);
      if (stat.isDirectory()) {
        scan(sourcePath);
        continue;
      }
      if (!stat.isFile()) fail("Image source contains a non-regular file: " + sourcePath);
      const extension = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) fail("Image source contains a non-image file: " + sourcePath);
      if (stat.size > MAX_FILE_BYTES) {
        fail("Image exceeds Cloudflare Pages 25 MiB file limit: " + sourcePath);
      }
      const relativePath = path.relative(imageDirectory, sourcePath).split(path.sep).join("/");
      if (/[:\\\\?%#\x00-\x1F\x7F]/.test(relativePath)) {
        fail("Image source path cannot be represented safely in an asset URL: " + sourcePath);
      }
      files.push({
        sourcePath,
        path: "/img/" + relativePath,
        size: stat.size,
        sha256: sha256File(sourcePath),
      });
    }
  }

  scan(imageDirectory);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (files.length + CONTROL_FILE_COUNT > MAX_OUTPUT_FILES) {
    fail("Cloudflare Pages output exceeds the " + MAX_OUTPUT_FILES + " file limit");
  }
  return files;
}

function assetSetSha256(files) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(files), "utf8");
  return hash.digest("hex");
}

function outputPaths(options = {}) {
  const repoRoot = normalizePath(options.repoRoot || path.resolve(__dirname, ".."));
  const outputParent = path.join(repoRoot, "output");
  const outputDirectory = path.join(outputParent, "cloudflare-pages");
  if (options.outputDir && normalizePath(options.outputDir) !== outputDirectory) {
    fail("Output directory is fixed at " + outputDirectory);
  }
  return { repoRoot, outputParent, outputDirectory };
}

function existingOutputIsSafe(outputParent, outputDirectory) {
  assertDirectoryNotLink(outputParent, "Output parent directory");
  if (!fs.existsSync(outputDirectory)) return false;
  assertDirectoryNotLink(outputDirectory, "Output directory");

  const resolvedParent = fs.realpathSync(outputParent);
  const resolvedOutput = fs.realpathSync(outputDirectory);
  if (!isWithin(resolvedParent, resolvedOutput) || path.basename(resolvedOutput) !== "cloudflare-pages") {
    fail("Output directory resolves outside the expected output directory");
  }
  const manifestPath = path.join(outputDirectory, "assets-manifest.json");
  let manifestStat;
  try {
    manifestStat = fs.lstatSync(manifestPath);
  } catch (error) {
    if (error.code === "ENOENT") fail("Refusing to replace an unknown output directory: " + outputDirectory);
    throw error;
  }
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    fail("Refusing to replace an output directory with an unsafe manifest");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("Refusing to replace an output directory with an invalid manifest");
  }
  if (!manifest || manifest.kind !== MANIFEST_KIND) {
    fail("Refusing to replace an unknown output directory: " + outputDirectory);
  }
  return true;
}

function prepareOutput(outputParent, outputDirectory) {
  const parentExists = assertDirectoryNotLink(outputParent, "Output parent directory");
  if (!parentExists) fs.mkdirSync(outputParent, { recursive: true, mode: 0o755 });
  if (existingOutputIsSafe(outputParent, outputDirectory)) {
    fs.rmSync(outputDirectory, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  }
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o755 });
}

function writeControlFiles(outputDirectory, manifest) {
  fs.writeFileSync(path.join(outputDirectory, "index.html"), [
    "<!doctype html>",
    "<html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>Arknights Guess image assets</title>",
    "<p>Static image assets for Arknights Guess.</p>",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(outputDirectory, "404.html"), [
    "<!doctype html>",
    "<html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>404</title><h1>404 Not Found</h1>",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(outputDirectory, "_headers"), [
    "/*",
    "  Access-Control-Allow-Origin: *",
    "  X-Content-Type-Options: nosniff",
    "  X-Robots-Tag: noindex",
    "/img/*",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/assets-manifest.json",
    "  Cache-Control: no-store",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(outputDirectory, "assets-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function buildImagePages(options = {}) {
  const { repoRoot, outputParent, outputDirectory } = outputPaths(options);
  assertDirectoryNotLink(repoRoot, "Repository root");
  const publicDirectory = path.join(repoRoot, "public");
  if (!assertDirectoryNotLink(publicDirectory, "Public directory")) {
    fail("Public directory does not exist: " + publicDirectory);
  }
  const imageDirectory = path.join(repoRoot, "public", "img");
  if (!assertDirectoryNotLink(imageDirectory, "Image source directory")) {
    fail("Image source directory does not exist: " + imageDirectory);
  }

  const files = scanImages(imageDirectory);
  const manifestFiles = files.map(({ path: assetPath, size, sha256 }) => ({ path: assetPath, size, sha256 }));
  const digest = assetSetSha256(manifestFiles);
  const manifest = {
    schemaVersion: 1,
    kind: MANIFEST_KIND,
    assetSetSha256: digest,
    files: manifestFiles,
  };

  prepareOutput(outputParent, outputDirectory);
  for (const file of files) {
    const destination = path.join(outputDirectory, ...file.path.slice(1).split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    fs.copyFileSync(file.sourcePath, destination);
    const copiedStat = fs.statSync(destination);
    if (copiedStat.size !== file.size || sha256File(destination) !== file.sha256) {
      fail("Image changed while the export was running: " + file.sourcePath);
    }
  }
  writeControlFiles(outputDirectory, manifest);

  const report = {
    outputDirectory,
    files: files.length + CONTROL_FILE_COUNT,
    imageFiles: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    digest,
    samplePath: files.length ? files[0].path : null,
  };
  return { manifest, report };
}

function usage() {
  console.log("Usage: node scripts/build_image_pages.js [--help]");
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  if (process.argv.length > 2) fail("Only --help is supported");
  const { report } = buildImagePages();
  console.log("Cloudflare Pages image export complete.");
  console.log("Files: " + report.files + " (" + report.imageFiles + " images)");
  console.log("Bytes: " + report.bytes);
  console.log("Asset set SHA-256: " + report.digest);
  console.log("Output: " + report.outputDirectory);
  console.log("Manifest sample: " + (report.samplePath || "(no images)"));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("Cloudflare Pages image export failed: " + error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTROL_FILE_COUNT,
  IMAGE_EXTENSIONS,
  MANIFEST_KIND,
  MAX_FILE_BYTES,
  MAX_OUTPUT_FILES,
  assetSetSha256,
  buildImagePages,
  outputPaths,
  scanImages,
};
