const { Types } = require("mongoose");
const { readMultipart, MultipartError } = require("../middlewares/multipart");
const { MAX_BYTES, createProductImageStorage } = require("../services/productImageStorage");
const { validateProductInput, validatePublishedProduct } = require("../validators/adminProductValidator");
const { canonicalBrand, getAvailableBrands } = require("../services/productBrands");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const productIdIsValid = (value) => typeof value === "string" && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value.toLowerCase();
const asLean = async (query) => (query && typeof query.lean === "function" ? query.lean() : query);
const toItem = (value) => (value?.toObject ? value.toObject() : value);
const sameId = (left, right) => String(left) === String(right);
const manual = (product) => product?.source?.provider === "manual";

const adminError = (res, status, code, error, fields) => res.status(status).json({ error, code, ...(fields ? { fields } : {}) });
const readVersion = (req) => {
  const raw = req.get("If-Unmodified-Since");
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time) : null;
};

const adminPagination = (query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const buildAdminFilter = (query = {}) => {
  const filter = {};
  const status = String(query.status || "").trim();
  const source = String(query.source || "").trim();
  if (status && !["draft", "active"].includes(status)) return null;
  if (source && !["manual", "imported"].includes(source)) return null;
  if (status) filter.status = status;
  if (source === "manual") filter["source.provider"] = "manual";
  if (source === "imported") filter["source.provider"] = { $ne: "manual" };
  const search = String(query.search || "").trim().slice(0, 100);
  if (search) {
    const expression = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: expression }, { title: expression }, { brand: expression }];
  }
  return filter;
};

const ownershipForGallery = async ({ product, user, values, ProductImageUpload }) => {
  if (!Object.hasOwn(values, "managedImages")) return null;
  const current = new Map((product.managedImages || []).map((image) => [image.publicId, image]));
  const ids = values.managedImages.map((image) => image.publicId);
  if (new Set(ids).size !== ids.length) return { fields: { images: "Each uploaded image can only be used once" } };
  const uploads = ids.length ? await ProductImageUpload.find({ publicId: { $in: ids } }).lean() : [];
  const byId = new Map(uploads.map((upload) => [upload.publicId, upload]));
  for (const image of values.managedImages) {
    const existing = current.get(image.publicId);
    if (existing && existing.secureUrl === image.secureUrl) continue;
    const upload = byId.get(image.publicId);
    if (!upload || !sameId(upload.ownerId, user._id) || upload.productId) return { fields: { images: "One or more images are not available to this product" } };
    if (upload.secureUrl !== image.secureUrl) return { fields: { images: "One or more uploaded images are invalid" } };
  }
  return { images: values.managedImages.map((image) => image.secureUrl), managedImages: values.managedImages.map((image) => ({ publicId: image.publicId, secureUrl: image.secureUrl })) };
};

const createAdminProductsController = ({ Product, ProductImageUpload, imageStorage = createProductImageStorage(), logger = console }) => {
  const validateBrand = async (values) => {
    if (!Object.hasOwn(values, "brand") || !values.brand) return null;
    const canonical = await canonicalBrand(Product, values.brand);
    if (!canonical) return { brand: "Select a brand from the available brands" };
    values.brand = canonical;
    return null;
  };
  const syncColors = (values) => {
    if (Object.hasOwn(values, "colors")) values.color = values.colors[0] || "";
    else if (Object.hasOwn(values, "color")) values.colors = values.color ? [values.color] : [];
  };
  const getManualProduct = async (id, res) => {
    if (!productIdIsValid(id)) { adminError(res, 400, "INVALID_PRODUCT_ID", "Invalid product id"); return null; }
    const product = await asLean(Product.findById(id));
    if (!product) { adminError(res, 404, "PRODUCT_NOT_FOUND", "Product not found"); return null; }
    if (!manual(product)) { adminError(res, 409, "IMPORTED_PRODUCT_READ_ONLY", "Imported products cannot be changed here"); return null; }
    return product;
  };

  const listProducts = async (req, res) => {
    const filter = buildAdminFilter(req.query);
    if (!filter) return adminError(res, 400, "INVALID_FILTER", "Invalid product filter");
    try {
      const { page, limit, skip } = adminPagination(req.query);
      const [items, total] = await Promise.all([Product.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
      res.set("Cache-Control", "no-store");
      return res.json({ items, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
    } catch (error) { logger.error(`Admin product list failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to load products"); }
  };

  const getProduct = async (req, res) => {
    if (!productIdIsValid(req.params.id)) return adminError(res, 400, "INVALID_PRODUCT_ID", "Invalid product id");
    try {
      const item = await asLean(Product.findById(req.params.id));
      if (!item) return adminError(res, 404, "PRODUCT_NOT_FOUND", "Product not found");
      res.set("Cache-Control", "no-store");
      return res.json({ item });
    } catch (error) { logger.error(`Admin product read failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to load product"); }
  };

  const listBrands = async (_req, res) => {
    try {
      const items = await getAvailableBrands(Product);
      res.set("Cache-Control", "no-store");
      return res.json({ items });
    } catch (error) { logger.error(`Admin product brand list failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to load brands"); }
  };


  const createProduct = async (req, res) => {
    const checked = validateProductInput(req.body || {});
    if (checked.error) return adminError(res, checked.status, checked.code, checked.error, checked.fields);
    try {
      const brandFields = await validateBrand(checked.values);
      if (brandFields) return adminError(res, 422, "BRAND_INVALID", "Please correct the highlighted fields", brandFields);
      syncColors(checked.values);
      const gallery = await ownershipForGallery({ product: {}, user: req.user, values: checked.values, ProductImageUpload });
      if (gallery?.fields) return adminError(res, 422, "IMAGE_OWNERSHIP_INVALID", "Please correct the highlighted fields", gallery.fields);
      const payload = { ...checked.values, ...(gallery || {}), image: gallery?.images?.[0] || "", currency: "GBP", inStock: checked.values.inStock ?? false, status: "draft", source: { provider: "manual" } };
      const created = toItem(await Product.create(payload));
      if (gallery?.managedImages?.length) await ProductImageUpload.updateMany({ publicId: { $in: gallery.managedImages.map((image) => image.publicId) } }, { $set: { productId: created._id, orphanedAt: null } });
      return res.status(201).json({ item: created });
    } catch (error) { logger.error(`Admin product create failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to create product"); }
  };

  const updateProduct = async (req, res) => {
    const checked = validateProductInput(req.body || {}, { partial: true });
    if (checked.error) return adminError(res, checked.status, checked.code, checked.error, checked.fields);
    const expected = readVersion(req);
    if (!expected) return adminError(res, 409, "VERSION_REQUIRED", "Refresh this product before saving changes");
    try {
      const current = await getManualProduct(req.params.id, res);
      if (!current) return undefined;
      const brandFields = await validateBrand(checked.values);
      if (brandFields) return adminError(res, 422, "BRAND_INVALID", "Please correct the highlighted fields", brandFields);
      syncColors(checked.values);
      const gallery = await ownershipForGallery({ product: current, user: req.user, values: checked.values, ProductImageUpload });
      if (gallery?.fields) return adminError(res, 422, "IMAGE_OWNERSHIP_INVALID", "Please correct the highlighted fields", gallery.fields);
      const values = { ...checked.values, ...(gallery || {}) };
      if (gallery) values.image = gallery.images[0] || "";
      const merged = { ...current, ...values };
      if (current.status === "active") {
        const fields = validatePublishedProduct({ ...merged, inStock: true });
        if (fields) return adminError(res, 422, "VALIDATION_FAILED", "Please correct the highlighted fields", fields);
      }
      const item = await asLean(Product.findOneAndUpdate({ _id: current._id, updatedAt: expected }, { $set: values }, { new: true, runValidators: true }));
      if (!item) return adminError(res, 409, "STALE_PRODUCT", "This product was changed in another tab. Refresh and try again.");
      if (gallery) {
        const retained = new Set(gallery.managedImages.map((image) => image.publicId));
        const removed = (current.managedImages || []).map((image) => image.publicId).filter((id) => !retained.has(id));
        if (removed.length) await ProductImageUpload.updateMany({ publicId: { $in: removed }, productId: current._id }, { $set: { productId: null, orphanedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
        if (gallery.managedImages.length) await ProductImageUpload.updateMany({ publicId: { $in: gallery.managedImages.map((image) => image.publicId) } }, { $set: { productId: current._id, orphanedAt: null } });
      }
      return res.json({ item });
    } catch (error) { logger.error(`Admin product update failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to update product"); }
  };

  const publishProduct = async (req, res) => {
    const expected = readVersion(req);
    if (!expected) return adminError(res, 409, "VERSION_REQUIRED", "Refresh this product before publishing");
    try {
      const current = await getManualProduct(req.params.id, res);
      if (!current) return undefined;
      const fields = validatePublishedProduct(current);
      if (fields) return adminError(res, 422, "VALIDATION_FAILED", "Please correct the highlighted fields", fields);
      const item = await asLean(Product.findOneAndUpdate({ _id: current._id, updatedAt: expected }, { $set: { status: "active", currency: "GBP", image: current.images[0] } }, { new: true, runValidators: true }));
      if (!item) return adminError(res, 409, "STALE_PRODUCT", "This product was changed in another tab. Refresh and try again.");
      return res.json({ item });
    } catch (error) { logger.error(`Admin product publish failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to publish product"); }
  };

  const unpublishProduct = async (req, res) => {
    const expected = readVersion(req);
    if (!expected) return adminError(res, 409, "VERSION_REQUIRED", "Refresh this product before unpublishing");
    try {
      const current = await getManualProduct(req.params.id, res);
      if (!current) return undefined;
      const item = await asLean(Product.findOneAndUpdate({ _id: current._id, updatedAt: expected }, { $set: { status: "draft" } }, { new: true, runValidators: true }));
      if (!item) return adminError(res, 409, "STALE_PRODUCT", "This product was changed in another tab. Refresh and try again.");
      return res.json({ item });
    } catch (error) { logger.error(`Admin product unpublish failed: ${error.message}`); return adminError(res, 500, "SERVER_ERROR", "Unable to unpublish product"); }
  };

  const uploadImage = async (req, res) => {
    try {
      const { file } = await readMultipart(req, { maxBytes: MAX_BYTES, fileField: "image", allowedFields: [] });
      const uploaded = await imageStorage.upload(file.buffer);
      let pending;
      try {
        pending = toItem(await ProductImageUpload.create({ publicId: uploaded.publicId, secureUrl: uploaded.secureUrl, ownerId: req.user._id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }));
      } catch (error) {
        await imageStorage.destroy?.(uploaded.publicId);
        throw error;
      }
      return res.status(201).json({ image: { url: pending.secureUrl, publicId: pending.publicId } });
    } catch (error) {
      if (error instanceof MultipartError || error instanceof Error && error.code && error.status) return adminError(res, error.status, error.code, error.message);
      logger.error(`Admin product image upload failed: ${error.message}`);
      return adminError(res, 500, "SERVER_ERROR", "Unable to upload image");
    }
  };

  return { createProduct, getProduct, listBrands, listProducts, publishProduct, unpublishProduct, updateProduct, uploadImage };
};

module.exports = { adminPagination, buildAdminFilter, createAdminProductsController };
