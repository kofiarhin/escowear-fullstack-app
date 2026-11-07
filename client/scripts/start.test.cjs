const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "start.cjs"), "utf8");

// Exercise startup's ordering: CRA loads the frontend PORT after the shell
// environment is captured, while the root file contains backend-only settings.
function start({ root = "", shell = {}, frontend = {} } = {}) {
  const env = { ...shell };
  const pkg = {};
  const logs = [];
  const modules = {
    "node:fs": { existsSync: () => !!root, readFileSync: () => root },
    "node:path": path,
    dotenv: require("dotenv"),
    "../package.json": pkg,
    "react-scripts/config/webpackDevServer.config": () => ({}),
  };
  const fakeRequire = (name) => {
    if (name === "react-scripts/config/env") {
      for (const [key, value] of Object.entries(frontend)) env[key] ??= value;
      return;
    }
    if (name === "react-scripts/scripts/start") return;
    assert.ok(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  };
  fakeRequire.resolve = name => name;
  fakeRequire.cache = { "react-scripts/config/webpackDevServer.config": {} };
  vm.runInNewContext(source, {
    require: fakeRequire, __dirname, process: { env }, URL,
    console: { log: message => logs.push(message) },
  });
  return { proxy: pkg.proxy, env, logs };
}

test("frontend port 3000 proxies to root backend port 5100 without a client override", () => {
  const result = start({ root: "PORT=5100\nJWT_SECRET=server-only-value", frontend: { PORT: "3000" } });
  assert.equal(result.proxy, "http://127.0.0.1:5100");
  assert.equal(result.env.PORT, "3000");
  assert.equal(result.env.JWT_SECRET, undefined);
  assert.ok(!result.logs.join().includes("server-only-value"));
});

test("backend shell port takes precedence and explicit proxy override remains supported", () => {
  assert.equal(start({ root: "PORT=5100", shell: { PORT: "5200" }, frontend: { PORT: "3000" } }).proxy, "http://127.0.0.1:5200");
  assert.equal(start({ root: "PORT=5100", frontend: { ESCOWEAR_DEV_API_URL: "http://127.0.0.1:5300" } }).proxy, "http://127.0.0.1:5300");
});

test("missing backend port uses the server default, not the frontend port", () => {
  assert.equal(start({ frontend: { PORT: "3000" } }).proxy, "http://127.0.0.1:5000");
});
