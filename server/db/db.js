const mongoose = require("mongoose");

const EXPECTED_DATABASE_NAME = "escowear-sneaker-import-test";

const configuredDatabaseName = (uri) => {
  const schemeEnd = uri.indexOf("://");
  const databaseStart = uri.indexOf("/", schemeEnd + 3);

  if (schemeEnd === -1 || databaseStart === -1) return null;

  const encodedName = uri
    .slice(databaseStart + 1)
    .split("?", 1)[0]
    .trim();

  if (!encodedName) return null;

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return null;
  }
};

const getMongoUri = () => {
  const uri = process.env.ESCOWEAR_MONGO_URI?.trim();

  if (!uri) {
    throw new Error("Missing required environment variable ESCOWEAR_MONGO_URI");
  }

  const databaseName = configuredDatabaseName(uri);
  if (databaseName !== EXPECTED_DATABASE_NAME) {
    throw new Error(
      `Expected MongoDB database ${EXPECTED_DATABASE_NAME}, received ${databaseName || "none"}`
    );
  }

  return uri;
};

const connectDB = async () => {
  const connection = await mongoose.connect(getMongoUri(), {
    autoCreate: false,
    autoIndex: false,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });
  const databaseName = connection.connection.db.databaseName;

  if (databaseName !== EXPECTED_DATABASE_NAME) {
    await mongoose.disconnect();
    throw new Error(
      `Connected to unexpected MongoDB database ${databaseName || "unknown"}`
    );
  }

  console.log(`Connected to MongoDB database ${databaseName}`);
  return connection;
};

module.exports = {
  EXPECTED_DATABASE_NAME,
  connectDB,
  configuredDatabaseName,
};
