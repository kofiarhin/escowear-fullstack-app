const HomepageLatestReleases = require("../Models/HomepageLatestReleases.model");
const Product = require("../Models/Product.model");
const { buildProductFilter } = require("./productsController");

const LATEST_RELEASES_ID = "homepage";
const MAX_LATEST_RELEASES = 8;
// Before the first admin save the homepage keeps its original behaviour: the
// four newest published catalogue products.
const DEFAULT_LATEST_COUNT = 4;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const PUT_FIELDS = ["productIds", "expectedVersion"];

// Existing catalogue documents may use title; normalize responses without writes.
const withProductName = (product) => {
  if (typeof product.name === "string" && product.name.trim()) return product;
  if (typeof product.title !== "string" || !product.title.trim()) return product;
  return { ...product, name: product.title };
};

const uniqueIds = (ids = []) => Array.from(new Set(ids.map((id) => String(id).toLowerCase())));

const invalid = (fields) => ({ status: 400, error: "Invalid latest releases selection", code: "INVALID_LATEST_RELEASES_SELECTION", fields });

const validateLatestReleases = (body) => {
  if (!body || Array.isArray(body) || typeof body !== "object") return invalid({ body: "Expected an object" });
  const unknown = Object.keys(body).filter((key) => !PUT_FIELDS.includes(key));
  if (unknown.length) return invalid({ [unknown[0]]: "This field is not allowed" });

  const errors = {};
  const { productIds, expectedVersion } = body;
  if (!Array.isArray(productIds)) errors.productIds = "Provide a list of product ids";
  else if (productIds.length > MAX_LATEST_RELEASES) errors.productIds = `Choose at most ${MAX_LATEST_RELEASES} products`;
  else if (!productIds.every((id) => typeof id === "string" && OBJECT_ID.test(id))) errors.productIds = "Every product id must be a valid catalogue id";
  else if (uniqueIds(productIds).length !== productIds.length) errors.productIds = "Each product can only appear once";
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) errors.expectedVersion = "Provide the version you last loaded";
  if (Object.keys(errors).length) return invalid(errors);
  return { productIds: productIds.map((id) => id.toLowerCase()), expectedVersion };
};

const createLatestReleasesController = ({ HomepageLatestReleases: LatestModel = HomepageLatestReleases, Product: ProductModel = Product } = {}) => {
  const send = (res, status, payload) => res.status(status).json(payload);

  // Same query and sort as the public catalogue's first page.
  const newestProducts = async () => {
    const products = await ProductModel.find(buildProductFilter({})).sort({ createdAt: -1, _id: -1 }).limit(DEFAULT_LATEST_COUNT).lean();
    return products.map(withProductName);
  };

  const readConfig = async () => {
    const config = await LatestModel.findById(LATEST_RELEASES_ID).lean();
    if (!config) {
      const products = await newestProducts();
      const productIds = products.map((product) => String(product._id).toLowerCase());
      return { configured: false, productIds, version: 0, updatedAt: null, defaults: new Map(products.map((product, index) => [productIds[index], product])) };
    }
    return { configured: true, productIds: uniqueIds(config.productIds || []), version: config.version, updatedAt: config.updatedAt || null };
  };

  // One bounded query, then order in memory: MongoDB does not preserve $in order.
  const findProducts = async (ids, filter = {}) => {
    if (!ids.length) return new Map();
    const products = await ProductModel.find({ _id: { $in: ids }, ...filter }).lean();
    return new Map(products.map((product) => [String(product._id).toLowerCase(), withProductName(product)]));
  };

  // Defaults were just read from the published catalogue, so no second lookup.
  const productsFor = (config, filter) => (config.defaults ? config.defaults : findProducts(config.productIds, filter));

  const adminView = (config, byId) => {
    const warnings = [];
    const products = [];
    config.productIds.forEach((id) => {
      const product = byId.get(id);
      if (!product) warnings.push({ productId: id, reason: "missing" });
      else {
        if (product.status === "draft") warnings.push({ productId: id, reason: "draft" });
        products.push(product);
      }
    });
    const updatedAt = config.updatedAt ? new Date(config.updatedAt).toISOString() : null;
    return { item: { configured: config.configured, productIds: config.productIds, version: config.version, updatedAt, products }, warnings };
  };

  const getPublicLatestReleases = async (req, res) => {
    try {
      const config = await readConfig();
      const byId = await productsFor(config, { status: { $ne: "draft" } });
      // Unavailable products leave a gap rather than being back-filled from the catalogue.
      const items = config.productIds.map((id) => byId.get(id)).filter(Boolean).slice(0, MAX_LATEST_RELEASES);
      return send(res, 200, { items, configured: config.configured, version: config.version });
    } catch {
      return send(res, 500, { error: "Unable to load latest releases", code: "LATEST_RELEASES_READ_FAILED" });
    }
  };

  const getAdminLatestReleases = async (req, res) => {
    try {
      const config = await readConfig();
      return send(res, 200, adminView(config, await productsFor(config)));
    } catch {
      return send(res, 500, { error: "Unable to load latest releases selection", code: "LATEST_RELEASES_READ_FAILED" });
    }
  };

  const saveLatestReleases = async (req, res) => {
    const validated = validateLatestReleases(req.body);
    if (validated.error) return send(res, validated.status, { error: validated.error, code: validated.code, fields: validated.fields });
    const { productIds, expectedVersion } = validated;
    const stale = () => send(res, 409, { error: "Latest releases changed elsewhere. Refresh and try again.", code: "STALE_LATEST_RELEASES_SELECTION" });
    try {
      const byId = await findProducts(productIds);
      const unavailable = productIds.filter((id) => !byId.has(id) || byId.get(id).status === "draft");
      if (unavailable.length) {
        return send(res, 422, { error: "One or more products are unavailable", code: "INELIGIBLE_LATEST_RELEASES_PRODUCTS", fields: { productIds: "Remove draft or deleted products before saving" }, unavailable });
      }

      const changes = { productIds, updatedBy: req.user?._id };
      let saved;
      if (expectedVersion === 0) {
        // The fixed _id makes a racing first save fail with a duplicate key.
        try {
          saved = await LatestModel.create({ _id: LATEST_RELEASES_ID, ...changes, version: 1 });
        } catch (error) {
          if (error?.code === 11000) return stale();
          throw error;
        }
      } else {
        saved = await LatestModel.findOneAndUpdate(
          { _id: LATEST_RELEASES_ID, version: expectedVersion },
          { $set: changes, $inc: { version: 1 } },
          { new: true }
        ).lean();
        if (!saved) return stale();
      }
      return send(res, 200, adminView({ configured: true, productIds, version: saved.version, updatedAt: saved.updatedAt }, byId));
    } catch {
      return send(res, 500, { error: "Unable to save latest releases selection", code: "LATEST_RELEASES_SAVE_FAILED" });
    }
  };

  return { getAdminLatestReleases, getPublicLatestReleases, saveLatestReleases };
};

module.exports = { DEFAULT_LATEST_COUNT, LATEST_RELEASES_ID, MAX_LATEST_RELEASES, createLatestReleasesController, validateLatestReleases };
