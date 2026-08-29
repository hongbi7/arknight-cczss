const anomaly = require("../../lib/anomaly.js");
const { prepare, send } = require("./_helpers.js");

module.exports = function handler(req, res) {
  if (!prepare(req, res, ["GET"])) return;
  const url = new URL(req.url, "http://localhost");
  const out = anomaly.newAudit(url.searchParams.get("domain") || "mixed");
  send(res, out);
};
