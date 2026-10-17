require("dotenv").config();

const mongoose = require("mongoose");
const {
  DESTINATION_DATABASE_NAME,
  PRODUCTS_COLLECTION,
  SOURCE_DATABASE_NAME,
  SOURCE_PROVIDER,
  buildSneakerQuery,
  planImport,
} = require("../importers/bangingPricesSneakers");

const SOURCE_PROJECTION = {
  canonicalKey: 1,
  store: 1,
  storeName: 1,
  title: 1,
  name: 1,
  brand: 1,
  price: 1,
  currency: 1,
  originalPrice: 1,
  discountPercent: 1,
  image: 1,
  images: 1,
  productUrl: 1,
  saleUrl: 1,
  category: 1,
  gender: 1,
  colors: 1,
  sizesRaw: 1,
  sizes: 1,
  inStock: 1,
  status: 1,
  lastSeenAt: 1,
};

const parseMode = (args) => {
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");

  if (dryRun === execute) {
    throw new Error("Choose exactly one mode: --dry-run or --execute");
  }

  return dryRun ? "dry-run" : "execute";
};

const requireEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const configuredDatabaseName = (uri) => {
  const schemeEnd = uri.indexOf("://");
  if (schemeEnd === -1) return null;

  const databaseStart = uri.indexOf("/", schemeEnd + 3);
  if (databaseStart === -1) return null;

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

const verifyConfiguredDatabaseName = (uri, expectedName, label) => {
  const configuredName = configuredDatabaseName(uri);
  if (configuredName !== expectedName) {
    throw new Error(
      `${label} URI database name mismatch: expected ${expectedName}, received ${configuredName || "none"}`,
    );
  }

  return configuredName;
};

const safeConnectionError = (error) => {
  const message = String(error?.message || "");

  if (/whitelist|could not connect to any servers/i.test(message)) {
    return "Atlas cluster unavailable; check the Atlas Network Access allowlist and cluster status";
  }

  if (/authentication failed|bad auth/i.test(message)) {
    return "MongoDB authentication failed";
  }

  if (/timed out|server selection/i.test(message)) {
    return "MongoDB server selection timed out";
  }

  return `MongoDB connection failed (${error?.name || "unknown error"})`;
};

const connect = async (uri) =>
  mongoose
    .createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      maxPoolSize: 2,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    })
    .asPromise();

const verifyDatabaseName = (connection, expectedName, label) => {
  const actualName = connection.db.databaseName;
  if (actualName !== expectedName) {
    throw new Error(
      `${label} database name mismatch: expected ${expectedName}, received ${actualName}`,
    );
  }

  return actualName;
};

const collectionExists = async (connection) =>
  connection.db
    .listCollections({ name: PRODUCTS_COLLECTION }, { nameOnly: true })
    .hasNext();

const getExistingCanonicalKeys = async (destinationCollection) => {
  const existing = await destinationCollection
    .find(
      { "source.provider": SOURCE_PROVIDER },
      { projection: { _id: 0, "source.canonicalKey": 1 } },
    )
    .toArray();

  return existing
    .map((document) => document.source?.canonicalKey)
    .filter(Boolean);
};

const summarizeCategories = (products) => {
  const counts = new Map();

  products.forEach((product) => {
    const category = String(product.category || "unknown").toLowerCase();
    counts.set(category, (counts.get(category) || 0) + 1);
  });

  return [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};

const createSourceIdentityIndex = async (destinationCollection) =>
  destinationCollection.createIndex(
    { "source.provider": 1, "source.canonicalKey": 1 },
    {
      name: "unique_source_product",
      unique: true,
      partialFilterExpression: {
        "source.provider": { $type: "string" },
        "source.canonicalKey": { $type: "string" },
      },
    },
  );

const insertInBatches = async (collection, documents, batchSize = 500) => {
  let inserted = 0;

  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = documents.slice(index, index + batchSize);
    const result = await collection.insertMany(batch, { ordered: false });
    inserted += result.insertedCount;
  }

  return inserted;
};

const run = async () => {
  const mode = parseMode(process.argv.slice(2));
  const sourceUri = requireEnvironmentVariable("BANGING_PRICES_MONGO_URI");
  const destinationUri = requireEnvironmentVariable("ESCOWEAR_MONGO_URI");
  let sourceConnection;
  let destinationConnection;

  try {
    const configuredSourceDatabase = verifyConfiguredDatabaseName(
      sourceUri,
      SOURCE_DATABASE_NAME,
      "Source",
    );
    const configuredDestinationDatabase = verifyConfiguredDatabaseName(
      destinationUri,
      DESTINATION_DATABASE_NAME,
      "Destination",
    );

    console.log(`Configured source database: ${configuredSourceDatabase}`);
    console.log(
      `Configured destination database: ${configuredDestinationDatabase}`,
    );

    const [sourceResult, destinationResult] = await Promise.allSettled([
      connect(sourceUri),
      connect(destinationUri),
    ]);

    if (sourceResult.status === "fulfilled") {
      sourceConnection = sourceResult.value;
    } else {
      console.error(`Source connection: ${safeConnectionError(sourceResult.reason)}`);
    }

    if (destinationResult.status === "fulfilled") {
      destinationConnection = destinationResult.value;
    } else {
      console.error(
        `Destination connection: ${safeConnectionError(destinationResult.reason)}`,
      );
    }

    if (!sourceConnection || !destinationConnection) {
      throw new Error("Read-only connection check failed");
    }

    await Promise.all([
      sourceConnection.db.command({ ping: 1 }),
      destinationConnection.db.command({ ping: 1 }),
    ]);

    const sourceDatabase = verifyDatabaseName(
      sourceConnection,
      SOURCE_DATABASE_NAME,
      "Source",
    );
    const destinationDatabase = verifyDatabaseName(
      destinationConnection,
      DESTINATION_DATABASE_NAME,
      "Destination",
    );

    if (sourceDatabase === destinationDatabase) {
      throw new Error("Source and destination databases must be different");
    }

    const [sourceHasProducts, destinationHasProducts] = await Promise.all([
      collectionExists(sourceConnection),
      collectionExists(destinationConnection),
    ]);

    if (!sourceHasProducts) {
      throw new Error(
        `Source collection ${PRODUCTS_COLLECTION} does not exist`,
      );
    }

    console.log("Connection check passed");
    console.log(`Source database: ${sourceDatabase}`);
    console.log(`Destination database: ${destinationDatabase}`);
    console.log(`Source products collection: available`);
    console.log(
      `Destination products collection: ${destinationHasProducts ? "available" : "not yet created"}`,
    );

    const sourceCollection = sourceConnection.db.collection(
      PRODUCTS_COLLECTION,
    );
    const destinationCollection = destinationConnection.db.collection(
      PRODUCTS_COLLECTION,
    );
    const [totalSourceProducts, candidates] = await Promise.all([
      sourceCollection.countDocuments({}),
      sourceCollection
        .find(buildSneakerQuery(), { projection: SOURCE_PROJECTION })
        .toArray(),
    ]);
    const existingCanonicalKeys = destinationHasProducts
      ? await getExistingCanonicalKeys(destinationCollection)
      : [];
    const plan = planImport(candidates, existingCanonicalKeys);
    const inStock = candidates.filter(
      (product) => product.inStock !== false,
    ).length;

    console.log(`Mode: ${mode}`);
    console.log(`Total source products: ${totalSourceProducts}`);
    summarizeCategories(candidates).forEach(([category, count]) => {
      console.log(`Category ${category}: ${count}`);
    });
    console.log(`Sneaker candidates: ${plan.summary.candidates}`);
    console.log(`Currently in stock: ${inStock}`);
    console.log(`Valid for import: ${plan.summary.valid}`);
    console.log(`Invalid and skipped: ${plan.summary.invalid}`);
    console.log(
      `Duplicate source records: ${plan.summary.duplicateSourceRecords}`,
    );
    console.log(`Already imported: ${plan.summary.alreadyImported}`);
    console.log(`Would insert: ${plan.summary.wouldInsert}`);

    if (mode === "dry-run") {
      console.log("Dry run complete: no database writes were performed");
      return;
    }

    await createSourceIdentityIndex(destinationCollection);
    const inserted = await insertInBatches(
      destinationCollection,
      plan.documents,
    );
    console.log(`Import complete: inserted ${inserted} products`);
  } finally {
    await Promise.allSettled([
      sourceConnection?.close(),
      destinationConnection?.close(),
    ]);
  }
};

run().catch((error) => {
  console.error(`Sneaker import failed: ${error.message}`);
  process.exitCode = 1;
});
