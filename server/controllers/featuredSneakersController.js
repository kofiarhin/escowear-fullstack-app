const FeaturedSneakers = require("../Models/FeaturedSneakers.model");
const Product = require("../Models/Product.model");

const FEATURED_ID = "homepage";
const MAX_FEATURED = 4;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const PUT_FIELDS = ["productIds", "expectedVersion"];

// Existing catalogue documents may use title; normalize responses without writes.
const withProductName = (product) => {
  if (typeof product.name === "string" && product.name.trim()) return product;
  if (typeof product.title !== "string" || !product.title.trim()) return product;
  return { ...product, name: product.title };
};

const uniqueIds = (ids = []) => Array.from(new Set(ids.map((id) => String(id).toLowerCase())));

const invalid = (fields) => ({ status: 400, error: "Invalid featured selection", code: "INVALID_FEATURED_SELECTION", fields });

const validateSelection = (body) => {
  if (!body || Array.isArray(body) || typeof body !== "object") return invalid({ body: "Expected an object" });
  const unknown = Object.keys(body).filter((key) => !PUT_FIELDS.includes(key));
  if (unknown.length) return invalid({ [unknown[0]]: "This field is not allowed" });

  const errors = {};
  const { productIds, expectedVersion } = body;
  if (!Array.isArray(productIds)) errors.productIds = "Provide a list of product ids";
  else if (productIds.length > MAX_FEATURED) errors.productIds = `Choose at most ${MAX_FEATURED} products`;
  else if (!productIds.every((id) => typeof id === "string" && OBJECT_ID.test(id))) errors.productIds = "Every product id must be a valid catalogue id";
  else if (uniqueIds(productIds).length !== productIds.length) errors.productIds = "Each product can only be featured once";
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) errors.expectedVersion = "Provide the version you last loaded";
  if (Object.keys(errors).length) return invalid(errors);
  return { productIds: productIds.map((id) => id.toLowerCase()), expectedVersion };
};

const createFeaturedSneakersController = ({ FeaturedSneakers: FeaturedModel = FeaturedSneakers, Product: ProductModel = Product } = {}) => {
  const send = (res, status, payload) => res.status(status).json(payload);

  const readConfig = async () => {
    const config = await FeaturedModel.findById(FEATURED_ID).lean();
    if (!config) return { productIds: [], version: 0, updatedAt: null };
    return { productIds: uniqueIds(config.productIds || []), version: config.version, updatedAt: config.updatedAt || null };
  };

  // One bounded query, then order in memory: MongoDB does not preserve $in order.
  const findProducts = async (ids, filter = {}) => {
    if (!ids.length) return new Map();
    const products = await ProductModel.find({ _id: { $in: ids }, ...filter }).lean();
    return new Map(products.map((product) => [String(product._id).toLowerCase(), withProductName(product)]));
  };

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
    return { item: { productIds: config.productIds, version: config.version, updatedAt, products }, warnings };
  };

  const getPublicFeatured = async (req, res) => {
    try {
      const config = await readConfig();
      const byId = await findProducts(config.productIds, { status: { $ne: "draft" } });
      // Unavailable products leave a gap rather than being back-filled from the catalogue.
      const items = config.productIds.map((id) => byId.get(id)).filter(Boolean).slice(0, MAX_FEATURED);
      return send(res, 200, { items, version: config.version });
    } catch {
      return send(res, 500, { error: "Unable to load featured sneakers", code: "FEATURED_READ_FAILED" });
    }
  };

  const getAdminFeatured = async (req, res) => {
    try {
      const config = await readConfig();
      return send(res, 200, adminView(config, await findProducts(config.productIds)));
    } catch {
      return send(res, 500, { error: "Unable to load featured selection", code: "FEATURED_READ_FAILED" });
    }
  };

  const saveFeatured = async (req, res) => {
    const validated = validateSelection(req.body);
    if (validated.error) return send(res, validated.status, { error: validated.error, code: validated.code, fields: validated.fields });
    const { productIds, expectedVersion } = validated;
    const stale = () => send(res, 409, { error: "Featured sneakers changed elsewhere. Refresh and try again.", code: "STALE_FEATURED_SELECTION" });
    try {
      const byId = await findProducts(productIds);
      const unavailable = productIds.filter((id) => !byId.has(id) || byId.get(id).status === "draft");
      if (unavailable.length) {
        return send(res, 422, { error: "One or more products are unavailable", code: "INELIGIBLE_FEATURED_PRODUCTS", fields: { productIds: "Remove draft or deleted products before saving" }, unavailable });
      }

      const changes = { productIds, updatedBy: req.user?._id };
      let saved;
      if (expectedVersion === 0) {
        // The fixed _id makes a racing first save fail with a duplicate key.
        try {
          saved = await FeaturedModel.create({ _id: FEATURED_ID, ...changes, version: 1 });
        } catch (error) {
          if (error?.code === 11000) return stale();
          throw error;
        }
      } else {
        saved = await FeaturedModel.findOneAndUpdate(
          { _id: FEATURED_ID, version: expectedVersion },
          { $set: changes, $inc: { version: 1 } },
          { new: true }
        ).lean();
        if (!saved) return stale();
      }
      return send(res, 200, adminView({ productIds, version: saved.version, updatedAt: saved.updatedAt }, byId));
    } catch {
      return send(res, 500, { error: "Unable to save featured selection", code: "FEATURED_SAVE_FAILED" });
    }
  };

  return { getAdminFeatured, getPublicFeatured, saveFeatured };
};

module.exports = { FEATURED_ID, MAX_FEATURED, createFeaturedSneakersController, validateSelection };
