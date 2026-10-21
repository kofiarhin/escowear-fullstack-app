// Opt-in real MongoDB harness. Set ESCOWEAR_TEST_MONGO_URI to a disposable
// local server, e.g. mongodb://127.0.0.1:27017 (no database name needed).
// Each run uses its own randomly named database and drops only that database.
// It refuses non-local hosts and the production database name.
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { EXPECTED_DATABASE_NAME } = require("../../db/db");

const RAW_URI = process.env.ESCOWEAR_TEST_MONGO_URI?.trim();

const skipReason = () => (RAW_URI ? false : "set ESCOWEAR_TEST_MONGO_URI to run real-MongoDB tests");

const connectTestDb = async () => {
  const url = new URL(RAW_URI);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`Refusing to run real-DB tests against non-local host ${url.hostname}`);
  }
  const dbName = `escowear-ci-${crypto.randomBytes(4).toString("hex")}-test`;
  if (dbName === EXPECTED_DATABASE_NAME) throw new Error("Refusing to use the production database name");
  url.pathname = `/${dbName}`;
  await mongoose.connect(url.toString(), { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== dbName) throw new Error("Connected to an unexpected database");

  const models = {
    Order: require("../../Models/Order.model"),
    OrderEvent: require("../../Models/OrderEvent.model"),
    EmailOutbox: require("../../Models/EmailOutbox.model"),
    Product: require("../../Models/Product.model"),
    User: require("../../Models/User.model"),
  };
  try {
    models.TrackingChallenge = require("../../Models/TrackingChallenge.model");
  } catch {
    // Model added in a later ticket.
  }
  // Same additive path as server/scripts/ensureOrderIndexes.js.
  for (const Model of Object.values(models)) {
    await Model.createCollection().catch((error) => {
      if (error.codeName !== "NamespaceExists") throw error;
    });
    await Model.createIndexes();
  }

  const reset = async () => {
    // Raw driver call: OrderEvent blocks Mongoose deletes by design.
    for (const Model of Object.values(models)) await Model.collection.deleteMany({});
  };
  const close = async () => {
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  };
  return { models, dbName, reset, close };
};

module.exports = { connectTestDb, skipReason };
