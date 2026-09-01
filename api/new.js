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
    // 40 条轮换历史外，允许携带三次珊瑚海岸计数和一个首轮五族完成标记；首项为珊瑚海岸时表示上一局刚出现。
    .slice(0, 44);
  const out = game.newGame(mode, url.searchParams.get("attempts"), url.searchParams.get("v"), recentThemes);
  out.mode = mode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(out));
};
