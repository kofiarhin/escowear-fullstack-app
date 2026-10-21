// Creates the order-workflow indexes. Additive only: Model.createIndexes() never
// drops or rewrites existing indexes or documents. Production runs connect with
// autoIndex disabled, so this must be run deliberately by an operator after a
// verified backup and explicit approval:
//
//   ESCOWEAR_MONGO_URI=... node server/scripts/ensureOrderIndexes.js
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../db/db");

const MODELS = ["Order", "OrderEvent", "EmailOutbox", "TrackingChallenge"];

const run = async () => {
  await connectDB();
  const models = MODELS.map((name) => {
    try {
      return require(`../Models/${name}.model`);
    } catch {
      return null;
    }
  }).filter(Boolean);
  for (const Model of models) {
    await Model.createCollection().catch((error) => {
      if (error.codeName !== "NamespaceExists") throw error;
    });
    await Model.createIndexes();
    const indexes = await Model.collection.indexes();
    console.log(`${Model.modelName}: ${indexes.map((index) => index.name).join(", ")}`);
  }
};

run()
  .catch((error) => {
    console.error(`Index creation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
