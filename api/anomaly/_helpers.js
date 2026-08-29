const { setApiHeaders } = require("../_headers.js");

function prepare(req, res, methods) {
  setApiHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", methods.concat("OPTIONS").join(","));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!methods.includes(req.method)) {
    res.statusCode = 405;
    res.setHeader("Allow", methods.join(", "));
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return false;
  }
  return true;
}

function send(res, out, statusCode) {
  res.statusCode = statusCode || (out && out.error ? 400 : 200);
  res.end(JSON.stringify(out));
}

function readJson(req, res, callback) {
  let body = "";
  let tooLarge = false;
  req.on("data", (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > 20000) tooLarge = true;
  });
  req.on("end", () => {
    if (tooLarge) return send(res, { error: "request_too_large" }, 413);
    try {
      callback(JSON.parse(body || "{}"));
    } catch (error) {
      send(res, { error: "bad_request" }, 400);
    }
  });
  req.on("error", () => send(res, { error: "bad_request" }, 400));
}

module.exports = { prepare, readJson, send };
