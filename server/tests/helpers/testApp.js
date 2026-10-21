// Builds the real Express app wired to in-memory models, and a tiny fetch-based
// HTTP client. No MongoDB connection is opened.
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { createMemoryModel } = require("./memoryModel");

process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

const { createApp } = require("../../server");
const { getOrderConfig } = require("../../config/orders");

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };

const createModels = () => ({
  Order: createMemoryModel({ uniques: ["orderNumber", "idempotencyKeyHash"] }),
  OrderEvent: createMemoryModel({ uniques: ["dedupeKey"] }),
  EmailOutbox: createMemoryModel({ uniques: ["dedupeKey"] }),
  Product: createMemoryModel(),
  User: createMemoryModel({ uniques: ["email"] }),
  TrackingChallenge: createMemoryModel(),
});

const sampleProduct = (overrides = {}) => ({
  _id: new Types.ObjectId(),
  name: "Nike Air Max Dn8",
  brand: "Nike",
  price: 164.99,
  currency: "GBP",
  sizes: ["8", "9", "UK 10"],
  inStock: true,
  status: "active",
  image: "https://example.test/dn8.jpg",
  retailer: { slug: "nike", name: "Nike" },
  productUrl: "https://example.test/products/dn8",
  ...overrides,
});

const validOrderBody = (productId, overrides = {}) => ({
  customer: { name: "Ama Mensah", email: "Ama.Mensah@Example.test", phone: "024 123 4567" },
  shippingAddress: {
    recipient: "Kojo Mensah",
    phone: "+233 20 765 4321",
    line1: "12 Ring Road East",
    landmark: "Near the Total station",
    city: "Accra",
    region: "Greater Accra",
  },
  items: [{ productId: String(productId), size: "UK 9", quantity: 2 }],
  termsAccepted: true,
  termsVersion: "2026-10-draft",
  ...overrides,
});

const userToken = (userId) => jwt.sign({ id: String(userId) }, process.env.JWT_SECRET, { expiresIn: "1h" });

// `models` may be real Mongoose models (see realDb.js); defaults to in-memory.
const startTestApp = async ({ config: configOverrides = {}, deps = {}, models = createModels() } = {}) => {
  const config = { ...getOrderConfig({}), publicBaseUrl: "https://shop.example.test", ...configOverrides };
  const app = createApp({
    products: { Product: models.Product },
    orders: { models, config, logger: silentLogger, ...deps.orders },
    admin: { models, config, logger: silentLogger, ...deps.admin },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (method, path, { body, headers = {}, token } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, body: json, headers: response.headers };
  };

  const addUser = async (overrides = {}) =>
    models.User.create({ name: "Registered Customer", email: `user-${crypto.randomUUID()}@example.test`, password: "hashed", role: "customer", ...overrides });

  const close = () => new Promise((resolve) => server.close(resolve));
  return { app, models, config, request, addUser, close, base };
};

const newIdempotencyKey = () => crypto.randomUUID();

module.exports = { createModels, newIdempotencyKey, sampleProduct, silentLogger, startTestApp, userToken, validOrderBody };
