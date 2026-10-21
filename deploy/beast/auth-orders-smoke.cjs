// Exercises registration, login, and orders with in-memory test models only.
// It never connects to MongoDB and cannot modify customer data.
// Orders use the guest-checkout contract (IDE-114): server-priced items and an
// Idempotency-Key header; the legacy raw-product POST is no longer accepted.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("/app/node_modules/express");
const bcrypt = require("/app/node_modules/bcryptjs");
const jwt = require("/app/node_modules/jsonwebtoken");

process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const users = new Map();
let nextUserId = 1;

class TestUser {
  constructor(data) {
    this._id = (nextUserId++).toString(16).padStart(24, "0");
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
    if (query._id) return [...users.values()].find((user) => user._id === String(query._id)) || null;
    return null;
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

const usersRoutes = require("/app/server/routes/usersRoute");
const { Types } = require("/app/node_modules/mongoose");
const { createMemoryModel } = require("/app/server/tests/helpers/memoryModel");
const { createOrdersRouter } = require("/app/server/routes/ordersRoute");
const { getOrderConfig } = require("/app/server/config/orders");

const orderModels = {
  Order: createMemoryModel({ uniques: ["orderNumber", "idempotencyKeyHash"] }),
  OrderEvent: createMemoryModel(),
  EmailOutbox: createMemoryModel({ uniques: ["dedupeKey"] }),
  Product: createMemoryModel(),
  User: TestUser,
};
const productId = new Types.ObjectId();
orderModels.Product.docs.push({ _id: productId, name: "Smoke sneaker", price: 99, currency: "GBP", sizes: ["9"], inStock: true, status: "active" });
const ordersRoutes = createOrdersRouter({ models: orderModels, config: getOrderConfig({}) });
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
  assert.deepEqual((await before.json()).items, []);
  console.log("PASS authenticated empty orders");

  const create = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      customer: { name: "Escowear Smoke Test", email, phone: "0241234567" },
      shippingAddress: { line1: "1 Smoke Test Street", city: "Accra", region: "Greater Accra" },
      items: [{ productId: String(productId), size: "UK 9", quantity: 1, price: 0.01 }],
      termsAccepted: true,
      termsVersion: "smoke",
    }),
  });
  assert.equal(create.status, 201);
  assert.equal((await create.json()).status, "pending_contact");
  console.log("PASS server-priced order creation");

  const after = await fetch(`${base}/api/orders`, { headers: authorization });
  assert.equal(after.status, 200);
  const createdOrders = await after.json();
  assert.equal(createdOrders.items.length, 1);
  assert.equal(createdOrders.items[0].items[0].productId, String(productId));
  assert.equal(createdOrders.items[0].pricing.subtotalGBPMinor, 9900);
  console.log("PASS authenticated order retrieval");
})()
  .catch((error) => {
    console.error("FAIL auth/orders smoke test:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
