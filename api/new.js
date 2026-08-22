const game = require("../lib/game.js");

module.exports = function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  const mode = url.searchParams.get("mode") === "sudden" ? "sudden" : "endless";
  const out = game.newGame(mode, url.searchParams.get("attempts"));
  out.mode = mode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(out));
};
