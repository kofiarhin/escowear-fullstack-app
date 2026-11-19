const HomepageClassics = require("../Models/HomepageClassics.model");
const Product = require("../Models/Product.model");
const { buildProductFilter } = require("./productsController");

const CLASSICS_ID = "homepage";
const MAX_CLASSICS = 6;
const TITLE_MAX = 40;
const SEARCH_TERM_MAX = 60;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const PUT_FIELDS = ["entries", "expectedVersion"];
const ENTRY_FIELDS = ["title", "searchTerm", "productId"];

// Shown until an admin saves for the first time. Each default card borrows the
// newest published product matching its search term, as the homepage always has.
// client/src/Pages/Home/homeContent.js keeps the same list as an offline fallback.
const DEFAULT_CLASSICS = [
  { title: "Air Force 1", searchTerm: "air force" },
  { title: "Dunk", searchTerm: "dunk" },
  { title: "Air Max", searchTerm: "air max" },
  { title: "Samba", searchTerm: "samba" },
  { title: "Spezial", searchTerm: "spezial" },
  { title: "Campus", searchTerm: "campus" },
];

const withProductName = (product) => {
  if (typeof product.name === "string" && product.name.trim()) return product;
  if (typeof product.title !== "string" || !product.title.trim()) return product;
  return { ...product, name: product.title };
};

// The cover is the product's primary image, falling back to its first gallery image.
const coverImage = (product) => {
  if (typeof product.image === "string" && product.image.trim()) return product.image;
  return (product.images || []).find((image) => typeof image === "string" && image.trim()) || "";
};

// Public cards expose only what the tile renders, never full catalogue records.
const publicProduct = (product) => ({ _id: String(product._id), name: product.name || "", image: coverImage(product) });

const invalid = (fields) => ({ status: 400, error: "Invalid classics selection", code: "INVALID_CLASSICS_SELECTION", fields });

const textError = (value, label, max) => {
  if (typeof value !== "string") return `${label} is required`;
  const text = value.trim();
  if (!text) return `${label} is required`;
  if (text.length > max) return `${label} must be ${max} characters or fewer`;
  if (CONTROL_CHARACTERS.test(text)) return `${label} contains invalid characters`;
  return null;
};

const validateEntry = (entry, index, errors) => {
  const prefix = `entries.${index}`;
  if (!entry || Array.isArray(entry) || typeof entry !== "object") {
    errors[prefix] = "Each card must be an object";
    return;
  }
  const unknown = Object.keys(entry).filter((key) => !ENTRY_FIELDS.includes(key));
  if (unknown.length) errors[`${prefix}.${unknown[0]}`] = "This field is not allowed";
  const titleError = textError(entry.title, "Title", TITLE_MAX);
  if (titleError) errors[`${prefix}.title`] = titleError;
  const searchError = textError(entry.searchTerm, "Search term", SEARCH_TERM_MAX);
  if (searchError) errors[`${prefix}.searchTerm`] = searchError;
  if (typeof entry.productId !== "string" || !OBJECT_ID.test(entry.productId)) errors[`${prefix}.productId`] = "Choose a catalogue product";
};

const validateClassics = (body) => {
  if (!body || Array.isArray(body) || typeof body !== "object") return invalid({ body: "Expected an object" });
  const unknown = Object.keys(body).filter((key) => !PUT_FIELDS.includes(key));
  if (unknown.length) return invalid({ [unknown[0]]: "This field is not allowed" });

  const errors = {};
  const { entries, expectedVersion } = body;
  if (!Array.isArray(entries)) errors.entries = "Provide a list of cards";
  else if (entries.length > MAX_CLASSICS) errors.entries = `Choose at most ${MAX_CLASSICS} cards`;
  else {
    entries.forEach((entry, index) => validateEntry(entry, index, errors));
    if (!Object.keys(errors).length) {
      const ids = entries.map((entry) => entry.productId.toLowerCase());
      if (new Set(ids).size !== ids.length) errors.entries = "Each product can only be used for one card";
    }
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) errors.expectedVersion = "Provide the version you last loaded";
  if (Object.keys(errors).length) return invalid(errors);
  return {
    entries: entries.map((entry) => ({ title: entry.title.trim(), searchTerm: entry.searchTerm.trim(), productId: entry.productId.toLowerCase() })),
    expectedVersion,
  };
};

const createClassicsController = ({ HomepageClassics: ClassicsModel = HomepageClassics, Product: ProductModel = Product } = {}) => {
  const send = (res, status, payload) => res.status(status).json(payload);

  const storedEntries = (entries = []) =>
    entries.map((entry) => ({ title: entry.title, searchTerm: entry.searchTerm, productId: String(entry.productId).toLowerCase() }));

  // Defaults resolve their representative product from the live catalogue; a
  // term with no unused published match keeps its card with no product. Search
  // also matches brand and category, so one product can match several terms;
  // skipping used ids keeps the defaults saveable (duplicates are rejected).
  const defaultEntries = async () => {
    const matches = await Promise.all(
      DEFAULT_CLASSICS.map(({ searchTerm }) => ProductModel.find(buildProductFilter({ search: searchTerm })).sort({ createdAt: -1, _id: -1 }).limit(MAX_CLASSICS).lean())
    );
    const used = new Set();
    return DEFAULT_CLASSICS.map((entry, index) => {
      const product = (matches[index] || []).find((candidate) => !used.has(String(candidate._id).toLowerCase()));
      if (!product) return { ...entry, productId: null, product: null };
      const productId = String(product._id).toLowerCase();
      used.add(productId);
      return { ...entry, productId, product: withProductName(product) };
    });
  };

  const readConfig = async () => {
    const config = await ClassicsModel.findById(CLASSICS_ID).lean();
    if (!config) return { configured: false, entries: await defaultEntries(), version: 0, updatedAt: null };
    return { configured: true, entries: storedEntries(config.entries), version: config.version, updatedAt: config.updatedAt || null };
  };

  // One bounded query, then match in memory: MongoDB does not preserve $in order.
  const findProducts = async (ids, filter = {}) => {
    if (!ids.length) return new Map();
    const products = await ProductModel.find({ _id: { $in: ids }, ...filter }).lean();
    return new Map(products.map((product) => [String(product._id).toLowerCase(), withProductName(product)]));
  };

  const productsFor = async (config, filter) => {
    if (!config.configured) return new Map(config.entries.filter((entry) => entry.product).map((entry) => [entry.productId, entry.product]));
    return findProducts(config.entries.map((entry) => entry.productId), filter);
  };

  const adminView = (config, byId) => {
    const warnings = [];
    const products = [];
    config.entries.forEach(({ productId }) => {
      if (!productId) return;
      const product = byId.get(productId);
      if (!product) warnings.push({ productId, reason: "missing" });
      else {
        if (product.status === "draft") warnings.push({ productId, reason: "draft" });
        products.push(product);
      }
    });
    const updatedAt = config.updatedAt ? new Date(config.updatedAt).toISOString() : null;
    const entries = config.entries.map(({ title, searchTerm, productId }) => ({ title, searchTerm, productId }));
    return { item: { configured: config.configured, entries, version: config.version, updatedAt, products }, warnings };
  };

  const getPublicClassics = async (req, res) => {
    try {
      const config = await readConfig();
      const byId = await productsFor(config, { status: { $ne: "draft" } });
      // Saved cards whose product is now draft or deleted are hidden rather than
      // back-filled; unsaved defaults keep their card even without a product.
      const items = config.entries
        .map((entry) => ({ title: entry.title, searchTerm: entry.searchTerm, product: entry.productId ? byId.get(entry.productId) || null : null }))
        .filter((entry) => entry.product || !config.configured)
        .slice(0, MAX_CLASSICS)
        .map((entry) => ({ ...entry, product: entry.product ? publicProduct(entry.product) : null }));
      return send(res, 200, { items, configured: config.configured, version: config.version });
    } catch {
      return send(res, 500, { error: "Unable to load classics", code: "CLASSICS_READ_FAILED" });
    }
  };

  const getAdminClassics = async (req, res) => {
    try {
      const config = await readConfig();
      return send(res, 200, adminView(config, await productsFor(config)));
    } catch {
      return send(res, 500, { error: "Unable to load classics selection", code: "CLASSICS_READ_FAILED" });
    }
  };

  const saveClassics = async (req, res) => {
    const validated = validateClassics(req.body);
    if (validated.error) return send(res, validated.status, { error: validated.error, code: validated.code, fields: validated.fields });
    const { entries, expectedVersion } = validated;
    const stale = () => send(res, 409, { error: "The Classics changed elsewhere. Refresh and try again.", code: "STALE_CLASSICS_SELECTION" });
    try {
      const productIds = entries.map((entry) => entry.productId);
      const byId = await findProducts(productIds);
      const unavailable = productIds.filter((id) => !byId.has(id) || byId.get(id).status === "draft");
      if (unavailable.length) {
        return send(res, 422, { error: "One or more products are unavailable", code: "INELIGIBLE_CLASSICS_PRODUCTS", fields: { entries: "Replace draft or deleted products before saving" }, unavailable });
      }

      const changes = { entries, updatedBy: req.user?._id };
      let saved;
      if (expectedVersion === 0) {
        // The fixed _id makes a racing first save fail with a duplicate key.
        try {
          saved = await ClassicsModel.create({ _id: CLASSICS_ID, ...changes, version: 1 });
        } catch (error) {
          if (error?.code === 11000) return stale();
          throw error;
        }
      } else {
        saved = await ClassicsModel.findOneAndUpdate(
          { _id: CLASSICS_ID, version: expectedVersion },
          { $set: changes, $inc: { version: 1 } },
          { new: true }
        ).lean();
        if (!saved) return stale();
      }
      return send(res, 200, adminView({ configured: true, entries, version: saved.version, updatedAt: saved.updatedAt }, byId));
    } catch {
      return send(res, 500, { error: "Unable to save classics selection", code: "CLASSICS_SAVE_FAILED" });
    }
  };

  return { getAdminClassics, getPublicClassics, saveClassics };
};

module.exports = { CLASSICS_ID, DEFAULT_CLASSICS, MAX_CLASSICS, SEARCH_TERM_MAX, TITLE_MAX, createClassicsController, validateClassics };
