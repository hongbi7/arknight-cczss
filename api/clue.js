const game = require("../lib/game.js");
const { setApiHeaders } = require("./_headers.js");

module.exports = function handler(req, res) {
  setApiHeaders(res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "method_not_allowed" }));
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 20000) req.destroy();
  });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body || "{}");
      const out = game.revealClue(payload.token, payload.clueId);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (!out || out.error) res.statusCode = 400;
      res.end(JSON.stringify(out));
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "bad_request" }));
    }
  });
};
