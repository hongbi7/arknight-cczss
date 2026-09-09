#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".avif"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const PAGES_DEPLOYMENT_HOST = /^[0-9a-f]{8,64}\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/i;

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    let bytesRead;
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

function parsePagesBaseUrl(value) {
  if (typeof value !== "string" || !value) fail("--base-url is required");
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    fail("--base-url must be an absolute URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    fail("--base-url must be an HTTPS Cloudflare Pages deployment origin");
  }
  if (!PAGES_DEPLOYMENT_HOST.test(url.hostname)) {
    fail("--base-url must use a unique <deployment>.<project>.pages.dev hostname");
  }
  return url.origin;
}

function assertImagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/img/") || value.includes("\\") || value.includes(":") || value.includes("?") || value.includes("#") || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("Invalid image manifest path: " + String(value));
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    fail("Invalid image manifest path encoding: " + value);
  }
  if (decoded !== value) fail("Image manifest paths must not be percent-encoded: " + value);
  const parts = value.slice("/img/".length).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    fail("Image manifest path contains an unsafe segment: " + value);
  }
  if (!IMAGE_EXTENSIONS.has(path.posix.extname(value).toLowerCase())) {
    fail("Image manifest path has a non-image extension: " + value);
  }
  return value;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("assets-manifest.json must be an object");
  if (manifest.schemaVersion !== 1 || manifest.kind !== "arknight-image-pages") {
    fail("assets-manifest.json has an unsupported schema or kind");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) {
    fail("assets-manifest.json has an invalid file count");
  }
  if (typeof manifest.assetSetSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.assetSetSha256)) {
    fail("assets-manifest.json has an invalid assetSetSha256");
  }
  const files = manifest.files.map((file, index) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) fail("Invalid file entry at index " + index);
    const assetPath = assertImagePath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
      fail("Invalid image size for " + assetPath);
    }
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(file.sha256)) {
      fail("Invalid image SHA-256 for " + assetPath);
    }
    return { path: assetPath, size: file.size, sha256: file.sha256.toLowerCase() };
  });
  const paths = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const current = files[index];
    if (paths.has(current.path)) fail("assets-manifest.json contains a duplicate path: " + current.path);
    paths.add(current.path);
    if (index && compareText(files[index - 1].path, current.path) > 0) {
      fail("assets-manifest.json files must be sorted by path");
    }
  }
  const digest = sha256(JSON.stringify(files));
  if (digest !== manifest.assetSetSha256.toLowerCase()) fail("assets-manifest.json assetSetSha256 does not match its files");
  return { files, digest };
}

function assertDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) fail(label + " must not be a symbolic link");
  if (!stat.isDirectory()) fail(label + " must be a directory");
}

function scanLocalImages(localRoot) {
  const root = path.resolve(localRoot);
  assertDirectory(root, "Local root");
  const publicRoot = path.join(root, "public");
  const imageRoot = path.join(publicRoot, "img");
  assertDirectory(publicRoot, "Local public directory");
  assertDirectory(imageRoot, "Local image directory");
  const files = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const source = path.join(directory, entry.name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) fail("Local image directory contains a symbolic link: " + source);
      if (stat.isDirectory()) {
        scan(source);
        continue;
      }
      if (!stat.isFile()) fail("Local image directory contains a non-regular file: " + source);
      const relative = path.relative(imageRoot, source).split(path.sep).join("/");
      const assetPath = assertImagePath("/img/" + relative);
      if (stat.size > MAX_FILE_BYTES) fail("Local image exceeds 25 MiB: " + source);
      files.push({ path: assetPath, size: stat.size, sha256: sha256File(source) });
    }
  }
  scan(imageRoot);
  files.sort((left, right) => compareText(left.path, right.path));
  if (files.length > MAX_FILES) fail("Local image directory exceeds the 20000-file limit");
  return { files, publicRoot: fs.realpathSync(publicRoot), localRoot: root };
}

async function readResponse(response, maximumBytes) {
  if (!response || !response.headers) fail("Fetch returned an invalid response");
  const contentLength = response.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    fail("Response exceeds the allowed size");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maximumBytes) fail("Response exceeds the allowed size");
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
      if (length > maximumBytes) {
        await reader.cancel();
        fail("Response exceeds the allowed size");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function fetchWithLimit(fetchImpl, url, maximumBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { "Cache-Control": "no-store" }, signal: controller.signal });
    return { response, body: await readResponse(response, maximumBytes) };
  } finally {
    clearTimeout(timeout);
  }
}

function assetUrl(baseUrl, assetPath) {
  return new URL(encodeURI(assetPath), baseUrl + "/").toString();
}

function compareFiles(remote, local) {
  if (remote.length !== local.length) fail("Remote and local image file counts differ");
  for (let index = 0; index < remote.length; index += 1) {
    const expected = remote[index];
    const actual = local[index];
    if (expected.path !== actual.path || expected.size !== actual.size || expected.sha256 !== actual.sha256) {
      fail("Remote and local image manifest differ at " + (expected.path || actual.path));
    }
  }
}

async function verifyImagePages(options = {}) {
  const baseUrl = parsePagesBaseUrl(options.baseUrl);
  const expectedDigest = options.expectedDigest == null ? null : String(options.expectedDigest).toLowerCase();
  if (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    fail("expectedDigest must be a 64-character hexadecimal SHA-256");
  }
  const local = scanLocalImages(options.localRoot || path.resolve(__dirname, ".."));
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") fail("A fetch implementation is required");
  const manifestRequest = await fetchWithLimit(fetchImpl, assetUrl(baseUrl, "/assets-manifest.json"), MAX_MANIFEST_BYTES);
  if (!manifestRequest.response.ok) fail("assets-manifest.json returned HTTP " + manifestRequest.response.status);
  let manifest;
  try {
    manifest = JSON.parse(manifestRequest.body.toString("utf8"));
  } catch (error) {
    fail("assets-manifest.json is not valid JSON");
  }
  const remote = validateManifest(manifest);
  compareFiles(remote.files, local.files);
  const localDigest = sha256(JSON.stringify(local.files));
  if (remote.digest !== localDigest) fail("Remote and local image asset-set digests differ");
  if (expectedDigest !== null && (remote.digest !== expectedDigest || localDigest !== expectedDigest)) {
    fail("Remote and local image asset-set digests do not match expectedDigest");
  }

  const samples = [];
  for (const file of [remote.files[0], ...remote.files.slice().sort((left, right) => right.size - left.size || compareText(left.path, right.path)).slice(0, 1), remote.files[remote.files.length - 1]]) {
    if (file && !samples.some((sample) => sample.path === file.path)) samples.push(file);
  }
  for (const file of samples) {
    const request = await fetchWithLimit(fetchImpl, assetUrl(baseUrl, file.path), MAX_FILE_BYTES);
    if (!request.response.ok) fail(file.path + " returned HTTP " + request.response.status);
    if (!String(request.response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) {
      fail(file.path + " did not return an image content type");
    }
    if (request.response.headers.get("access-control-allow-origin") !== "*") {
      fail(file.path + " must send Access-Control-Allow-Origin: *");
    }
    if (request.body.length !== file.size || sha256(request.body) !== file.sha256) fail(file.path + " bytes do not match the manifest");
  }
  const missingPath = "/img/__missing-" + (options.missingSuffix || crypto.randomBytes(12).toString("hex")) + ".webp";
  const missing = await fetchWithLimit(fetchImpl, assetUrl(baseUrl, missingPath), 1024 * 1024);
  if (missing.response.status !== 404) fail("Missing image path must return HTTP 404");
  return { baseUrl, files: remote.files.length, digest: remote.digest, localRoot: local.localRoot, publicRoot: local.publicRoot, samples: samples.map((sample) => sample.path) };
}

function option(name) {
  const prefix = "--" + name;
  const inline = process.argv.find((arg) => arg.startsWith(prefix + "="));
  if (inline) return inline.slice(prefix.length + 1);
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/check_image_pages.js --base-url https://<deployment>.<project>.pages.dev [--local-root DIR] [--expected-digest SHA256]");
    return;
  }
  const result = await verifyImagePages({
    baseUrl: option("base-url"),
    localRoot: option("local-root") || path.resolve(__dirname, ".."),
    expectedDigest: option("expected-digest"),
  });
  console.log("Cloudflare Pages image check passed.");
  console.log("Files: " + result.files);
  console.log("Asset set SHA-256: " + result.digest);
  console.log("Base URL: " + result.baseUrl);
  console.log("Local root: " + result.localRoot);
  console.log("Nginx public root: " + result.publicRoot);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Cloudflare Pages image check failed: " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { IMAGE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES, MAX_MANIFEST_BYTES, assetUrl, compareFiles, compareText, parsePagesBaseUrl, scanLocalImages, validateManifest, verifyImagePages };
