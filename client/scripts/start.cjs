// CRA can omit allowedHost when no private LAN address is detected or HOST
// is explicit. Keep its proxy host check enabled with a localhost fallback.
const fs = require("node:fs");
const path = require("node:path");
// A shell PORT overrides dotenv for the backend. Capture it before CRA loads
// the frontend's separate PORT from client/.env*.
const inheritedBackendPort = process.env.PORT;
process.env.NODE_ENV = "development";
require("react-scripts/config/env");

// Keep API and /images requests on the same backend when local ports differ.
// Parse (never load into process.env) the root file so server secrets cannot
// become frontend environment settings. Only the backend port is used here.
const backendEnvPath = path.resolve(__dirname, "../../.env");
const backendEnv = fs.existsSync(backendEnvPath)
  ? require("dotenv").parse(fs.readFileSync(backendEnvPath))
  : {};
const backendPort = inheritedBackendPort || backendEnv.PORT || "5000";
const proxy = process.env.ESCOWEAR_DEV_API_URL || `http://127.0.0.1:${backendPort}`;
require("../package.json").proxy = proxy;
console.log(`Escowear development API and images proxy: ${new URL(proxy).origin}`);

const configPath = require.resolve("react-scripts/config/webpackDevServer.config");
const createConfig = require(configPath);
require.cache[configPath].exports = (proxy, allowedHost) =>
  createConfig(proxy, allowedHost || "localhost");

require("react-scripts/scripts/start");
