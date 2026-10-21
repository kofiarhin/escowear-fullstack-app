// Operator-only admin provisioning (decision D4). There is deliberately no API
// for this: run it on the server with database access, after the owner has
// approved which existing account should become an admin.
//
//   node server/scripts/setUserRole.js --email someone@example.com --role admin --confirm
//
// Uses updateOne so the password hash is never touched.
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../db/db");
const User = require("../Models/User.model");

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm") args.confirm = true;
    else if (arg === "--email") args.email = argv[(index += 1)];
    else if (arg === "--role") args.role = argv[(index += 1)];
  }
  return args;
};

const run = async ({ email, role, confirm }, { UserModel = User, connect = connectDB, log = console.log } = {}) => {
  if (!email || !["admin", "customer"].includes(role)) {
    throw new Error("Usage: --email <address> --role admin|customer --confirm");
  }
  if (!confirm) throw new Error("Refusing to change roles without --confirm");
  await connect();
  const result = await UserModel.updateOne({ email: String(email).trim().toLowerCase() }, { $set: { role } });
  if (!result.matchedCount) throw new Error("No user with that email; ask them to register first");
  log(`Role for ${String(email).trim().toLowerCase()} set to ${role}`);
  return result;
};

if (require.main === module) {
  run(parseArgs(process.argv.slice(2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { parseArgs, run };
