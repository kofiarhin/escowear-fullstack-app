// Additive, owner-reviewed index provisioning. This is intentionally separate
// from application startup because production connects with autoIndex disabled.
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../db/db");

const run = async () => {
  await connectDB();
  const HeroSlide = require("../Models/HeroSlide.model");
  await HeroSlide.createCollection().catch((error) => {
    if (error.codeName !== "NamespaceExists") throw error;
  });
  await HeroSlide.createIndexes();
  const indexes = await HeroSlide.collection.indexes();
  console.log(`HeroSlide: ${indexes.map((index) => index.name).join(", ")}`);
};

run()
  .catch((error) => {
    console.error(`Hero slide index creation failed (code ${Number.isInteger(error.code) ? error.code : "unavailable"}); stop and inspect privately`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
