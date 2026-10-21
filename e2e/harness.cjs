// Isolated end-to-end harness (IDE-118). Runs the real Express app and the
// production React build against in-memory models and a capturing mail
// transport. It never connects to MongoDB, never sends email and holds no
// real customer, bank or payment data. Test-only routes live under /__e2e
// on this harness, never in server.js.
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

process.env.NODE_ENV = "production"; // serve client/build like the container does
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const express = require("express");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { createApp } = require("../server/server");
const { createMemoryModel } = require("../server/tests/helpers/memoryModel");
const { getOrderConfig } = require("../server/config/orders");
const { createOrderService } = require("../server/services/orderService");
const { runEmailWorkerTick } = require("../server/services/emailWorker");

const TEST_PAYMENT_CHANNEL = "E2E TEST CHANNEL\\nThis is not a real account.";

const start = async ({ port = 0, logger = { error() {}, log() {} } } = {}) => {
  if (!fs.existsSync(path.join(__dirname, "..", "client", "build", "index.html"))) {
    throw new Error("client/build is missing: run `npm run build --prefix client` first");
  }
  const models = {
    Order: createMemoryModel({ uniques: ["orderNumber", "idempotencyKeyHash"] }),
    OrderEvent: createMemoryModel(),
    EmailOutbox: createMemoryModel({ uniques: ["dedupeKey"] }),
    Product: createMemoryModel(),
    User: createMemoryModel({ uniques: ["email"] }),
    TrackingChallenge: createMemoryModel(),
  };
  const product = await models.Product.create({
    _id: new Types.ObjectId(),
    name: "E2E Test Runner",
    brand: "TestBrand",
    price: 99.99,
    currency: "GBP",
    sizes: ["8", "9", "10"],
    inStock: true,
    status: "active",
    image: "/images/default.jpg",
    category: "shoes",
  });
  const admin = await models.User.create({ name: "E2E Admin", email: "admin@e2e.test", password: "unused", role: "admin" });

  const config = { ...getOrderConfig({}), publicBaseUrl: "" };
  const inbox = [];
  const transport = {
    async send(message) {
      inbox.push({ ...message, at: new Date().toISOString() });
      return { providerMessageId: `e2e-${inbox.length}` };
    },
  };
  const orderService = createOrderService({ ...models, config, logger });
  const timer = setInterval(() => runEmailWorkerTick({ ...models, orderService, transport, logger }).catch(() => {}), 250);

  const outer = express();
  outer.get("/__e2e/outbox", (req, res) => res.json(inbox));
  outer.get("/__e2e/admin-session", (req, res) =>
    res.json({ id: String(admin._id), name: admin.name, email: admin.email, role: "admin", token: jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET, { expiresIn: "1h" }) })
  );
  outer.use(
    createApp({
      products: { Product: models.Product },
      orders: { models, config, logger },
      admin: { models, config, logger, env: { ESCOWEAR_PAYMENT_INSTRUCTIONS: TEST_PAYMENT_CHANNEL } },
    })
  );

  const server = outer.listen(port, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = () =>
    new Promise((resolve) => {
      clearInterval(timer);
      server.close(resolve);
    });
  return { url, stop, models, inbox, product };
};

if (require.main === module) {
  start({ port: Number(process.env.E2E_PORT) || 0, logger: console }).then(({ url, product }) => {
    console.log(`E2E harness listening on ${url} (product ${product._id})`);
  });
}

module.exports = { start, TEST_PAYMENT_CHANNEL };
