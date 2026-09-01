const { once } = require("events");

module.exports = async function globalSetup() {
  if (process.env.E2E_BASE_URL) return undefined;

  process.env.NODE_ENV = "test";
  process.env.PORT = process.env.E2E_PORT || "3310";
  process.env.HOST = "127.0.0.1";
  const server = require("../../server.js");
  if (!server.listening) await once(server, "listening");

  return async () => {
    if (!server.listening) return;
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  };
};
