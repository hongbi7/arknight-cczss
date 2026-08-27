const game = require("../lib/game.js");
const { setApiHeaders } = require("./_headers.js");

module.exports = function handler(req, res) {
  setApiHeaders(res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  const mode = url.searchParams.get("mode") === "sudden" ? "sudden" : "endless";
  const recentThemes = (url.searchParams.get("themes") || "")
    .split(",")
    .map((themeId) => themeId.trim())
    .filter(Boolean)
    .slice(0, 40);
  const out = game.newGame(mode, url.searchParams.get("attempts"), url.searchParams.get("v"), recentThemes);
  out.mode = mode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(out));
};
