const anomaly = require("../../lib/anomaly.js");
const { prepare, readJson, send } = require("./_helpers.js");

module.exports = function handler(req, res) {
  if (!prepare(req, res, ["POST"])) return;
  readJson(req, res, (payload) => send(res, anomaly.scan(payload.token)));
};
