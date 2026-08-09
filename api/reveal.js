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
  const out = game.reveal(url.searchParams.get("token"));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (out.error) res.statusCode = 400;
  res.end(JSON.stringify(out));
};
