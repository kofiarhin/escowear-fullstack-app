// Creates the user and order-workflow indexes. Additive only: Model.createIndexes() never
// drops or rewrites existing indexes or documents. Production runs connect with
// autoIndex disabled, so this must be run deliberately by an operator after a
// verified backup and explicit approval:
//
//   ESCOWEAR_MONGO_URI=... node server/scripts/ensureOrderIndexes.js
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../db/db");

const MODELS = ["User", "Order", "OrderEvent", "EmailOutbox", "TrackingChallenge"];

const run = async () => {
  await connectDB();
  // Missing models must fail the release check rather than silently skip indexes.
  const models = MODELS.map((name) => require(`../Models/${name}.model`));
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
    // Duplicate-key messages can contain a customer's email address.
    console.error(`Index creation failed (code ${Number.isInteger(error.code) ? error.code : "unavailable"}); stop the release and inspect privately`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
