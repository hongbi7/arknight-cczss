const anomaly = require("../../lib/anomaly.js");
const { prepare, send } = require("./_helpers.js");

module.exports = function handler(req, res) {
  if (!prepare(req, res, ["GET"])) return;
  send(res, anomaly.auditThemes());
};
