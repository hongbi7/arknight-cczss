const http = require("http");
const fs = require("fs");
const path = require("path");
const apiNew = require("./api/new.js");
const apiGuess = require("./api/guess.js");
const apiReveal = require("./api/reveal.js");
const apiChoices = require("./api/choices.js");
const apiPick = require("./api/pick.js");
const apiClue = require("./api/clue.js");

function cliArg(name) {
  const prefix = "--" + name;
  const inline = process.argv.find((arg) => arg.startsWith(prefix + "="));
  if (inline) return inline.slice(prefix.length + 1);
  const index = process.argv.indexOf(prefix);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

const PORT = Number(cliArg("port")) || Number(process.env.PORT) || 3000;
const HOST = cliArg("host") || process.env.HOST || "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(pathname, req, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("Not Found");
    }
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/new") return apiNew(req, res);
  if (url.pathname === "/api/guess") return apiGuess(req, res);
  if (url.pathname === "/api/reveal") return apiReveal(req, res);
  if (url.pathname === "/api/choices") return apiChoices(req, res);
  if (url.pathname === "/api/pick") return apiPick(req, res);
  if (url.pathname === "/api/clue") return apiClue(req, res);
  serveStatic(url.pathname, req, res);
});

server.listen(PORT, HOST, () => {
  console.log("Arknights guess game running at http://" + HOST + ":" + PORT);
});
