// Exercises registration, login, and orders with in-memory test models only.
// It never connects to MongoDB and cannot modify customer data.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("/app/node_modules/express");
const bcrypt = require("/app/node_modules/bcryptjs");
const jwt = require("/app/node_modules/jsonwebtoken");

process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const users = new Map();
const orders = [];
let nextUserId = 1;
let nextOrderId = 1;

class TestUser {
  constructor(data) {
    this._id = `test-user-${nextUserId++}`;
    this.name = data.name;
    this.email = String(data.email).toLowerCase();
    this.password = data.password;
  }

  async save() {
    if (users.has(this.email)) {
      const error = new Error("duplicate email");
      error.code = 11000;
      throw error;
    }
    this.password = await bcrypt.hash(this.password, 4);
    users.set(this.email, this);
    return this;
  }

  toObject() {
    return {
      _id: this._id,
      name: this.name,
      email: this.email,
      password: this.password,
    };
  }

  static async findOne(query) {
    if (query.email) return users.get(String(query.email).toLowerCase()) || null;
    if (query._id) return [...users.values()].find((user) => user._id === query._id) || null;
    return null;
  }
}

class TestOrder {
  constructor(data) {
    this._id = `test-order-${nextOrderId++}`;
    this.user = data.user;
    this.products = data.products;
    this.status = "Pending";
  }

  async save() {
    orders.push(this);
    return this;
  }

  static async find(query) {
    return orders.filter((order) => order.user === query.user);
  }
}

const replaceModule = (path, exports) => {
  const resolved = require.resolve(path);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
};

replaceModule("/app/server/Models/User.model", TestUser);
replaceModule("/app/server/Models/Order.model", TestOrder);

const usersRoutes = require("/app/server/routes/usersRoute");
const ordersRoutes = require("/app/server/routes/ordersRoute");
const app = express();
app.use(express.json());
app.use("/api/users", usersRoutes);
app.use("/api/orders", ordersRoutes);

let server;
(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const email = `escowear-smoke-${Date.now()}@example.test`;

  const register = await fetch(`${base}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Escowear Smoke Test", email, password: "Test-password-123!" }),
  });
  assert.equal(register.status, 201);
  const registered = await register.json();
  assert.equal(registered.email, email);
  assert.equal("password" in registered, false);
  console.log("PASS registration without password disclosure");

  const login = await fetch(`${base}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Test-password-123!" }),
  });
  assert.equal(login.status, 200);
  const credentials = await login.json();
  assert.ok(credentials.token);
  assert.equal(jwt.verify(credentials.token, process.env.JWT_SECRET).id, registered._id);
  console.log("PASS login and JWT");

  const authorization = { authorization: `Bearer ${credentials.token}` };
  const before = await fetch(`${base}/api/orders`, { headers: authorization });
  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), []);
  console.log("PASS authenticated empty orders");

  const create = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify([{ productId: "507f1f77bcf86cd799439011", size: "9", name: "Smoke sneaker", price: 99 }]),
  });
  assert.equal(create.status, 201);
  console.log("PASS order creation");

  const after = await fetch(`${base}/api/orders`, { headers: authorization });
  assert.equal(after.status, 200);
  const createdOrders = await after.json();
  assert.equal(createdOrders.length, 1);
  assert.equal(createdOrders[0].products[0].productId, "507f1f77bcf86cd799439011");
  console.log("PASS authenticated order retrieval");
})()
  .catch((error) => {
    console.error("FAIL auth/orders smoke test:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
