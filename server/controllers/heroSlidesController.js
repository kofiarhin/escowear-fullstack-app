const HeroSlide = require("../Models/HeroSlide.model");
const Product = require("../Models/Product.model");

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_ACTIVE_SLIDES = 8;
const CREATE_FIELDS = new Set(["productId", "headline", "description", "desktopImage", "mobileImage", "order", "isActive"]);
const PATCH_FIELDS = CREATE_FIELDS;

const hasControlCharacters = (value) => /[\u0000-\u001f\u007f]/.test(value);
const isObjectId = (value) => typeof value === "string" && OBJECT_ID.test(value);

const validImageSource = (value) => {
  if (typeof value !== "string" || value.length > 2048 || hasControlCharacters(value) || value !== value.trim()) return false;
  if (!value) return true;
  if (value.startsWith("//") || value.includes("\\") || value.includes("..")) return false;
  if (value.startsWith("/images/")) {
    return !value.includes("?") && !value.includes("#") && !value.includes("//");
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const validText = (value, maximum, required = false) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length <= maximum &&
  (!required || value.length > 0) &&
  !hasControlCharacters(value) &&
  !/[<>]/.test(value);

const queryValue = async (query) => {
  if (query && typeof query.lean === "function") return query.lean();
  return query;
};

const productName = (product = {}) => {
  const name = typeof product.name === "string" ? product.name.trim() : "";
  if (name) return name;
  return typeof product.title === "string" ? product.title.trim() : "";
};

const resolveProductImage = (product = {}) => {
  const candidates = [product.image, ...(Array.isArray(product.images) ? product.images : [])];
  const found = candidates.find((value) => validImageSource(value) && value);
  // Match the existing product image utility's ultimate local fallback.
  return found || "/images/default.jpg";
};

const readProduct = async (ProductModel, id) => queryValue(ProductModel.findById(id));

const validationError = (fields) => ({ status: 400, error: "Invalid hero slide", code: "INVALID_HERO_SLIDE", fields });

const validatePayload = (body, mode) => {
  if (!body || Array.isArray(body) || typeof body !== "object") return validationError({ body: "Expected an object" });
  const allowed = mode === "create" ? CREATE_FIELDS : PATCH_FIELDS;
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) return validationError({ [unknown[0]]: "This field is not allowed" });
  if (mode === "patch" && Object.keys(body).length === 0) return validationError({ body: "Provide at least one editable field" });

  const fields = {};
  const errors = {};
  const required = mode === "create";
  if (required || Object.hasOwn(body, "productId")) {
    if (!isObjectId(body.productId)) errors.productId = "Choose a valid catalogue product";
    else fields.productId = body.productId;
  }
  if (required || Object.hasOwn(body, "headline")) {
    if (!validText(body.headline, 90, true)) errors.headline = "Use plain text between 1 and 90 characters";
    else fields.headline = body.headline;
  }
  if (Object.hasOwn(body, "description")) {
    if (!validText(body.description, 180)) errors.description = "Use plain text up to 180 characters";
    else fields.description = body.description;
  } else if (required) fields.description = "";
  for (const key of ["desktopImage", "mobileImage"]) {
    if (Object.hasOwn(body, key)) {
      if (!validImageSource(body[key])) errors[key] = "Use an HTTPS URL or a safe /images/ path";
      else fields[key] = body[key];
    } else if (required) fields[key] = "";
  }
  if (required || Object.hasOwn(body, "order")) {
    if (!Number.isInteger(body.order) || body.order < 0 || body.order > 999) errors.order = "Use a whole number from 0 to 999";
    else fields.order = body.order;
  }
  if (Object.hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") errors.isActive = "Use true or false";
    else fields.isActive = body.isActive;
  } else if (required) fields.isActive = false;
  return Object.keys(errors).length ? validationError(errors) : { fields };
};

const serializeSlide = async (slide, ProductModel, { publicView = false } = {}) => {
  const product = await readProduct(ProductModel, slide.productId);
  if (!product || (publicView && product.status === "draft")) return null;
  const desktopImage = validImageSource(slide.desktopImage) && slide.desktopImage ? slide.desktopImage : resolveProductImage(product);
  const mobileImage = validImageSource(slide.mobileImage) && slide.mobileImage ? slide.mobileImage : desktopImage;
  const base = {
    id: String(slide._id),
    productId: String(slide.productId),
    headline: slide.headline,
    description: slide.description || "",
    desktopImage,
    mobileImage,
    order: slide.order,
    productName: productName(product),
    productInStock: product.inStock !== false,
  };
  if (publicView) return base;
  return { ...base, isActive: Boolean(slide.isActive), product: { id: String(product._id), name: productName(product), image: resolveProductImage(product), inStock: product.inStock !== false } };
};

const createHeroSlidesController = ({ HeroSlide: HeroSlideModel = HeroSlide, Product: ProductModel = Product } = {}) => {
  // The deployed app uses one Node process. Serializing hero mutations makes the
  // active-slide cap deterministic without enabling auto-created Mongo indexes.
  let writeTail = Promise.resolve();
  const serializeWrite = (work) => {
    const result = writeTail.then(work, work);
    writeTail = result.catch(() => undefined);
    return result;
  };
  const activeCountAllows = async (excludingId) => {
    const filter = excludingId ? { isActive: true, _id: { $ne: excludingId } } : { isActive: true };
    return (await HeroSlideModel.countDocuments(filter)) < MAX_ACTIVE_SLIDES;
  };
  const send = (res, status, payload) => res.status(status).json(payload);
  const fail = (res, outcome) => send(res, outcome.status, { error: outcome.error, code: outcome.code, ...(outcome.fields ? { fields: outcome.fields } : {}) });

  const getPublicSlides = async (req, res) => {
    try {
      const slides = await HeroSlideModel.find({ isActive: true }).sort({ order: 1, _id: 1 }).limit(MAX_ACTIVE_SLIDES).lean();
      const items = (await Promise.all(slides.map((slide) => serializeSlide(slide, ProductModel, { publicView: true })))).filter(Boolean);
      return send(res, 200, { items });
    } catch {
      return send(res, 500, { error: "Unable to load hero slides" });
    }
  };

  const listAdminSlides = async (req, res) => {
    try {
      const slides = await HeroSlideModel.find({}).sort({ order: 1, _id: 1 }).limit(50).lean();
      const items = (await Promise.all(slides.map((slide) => serializeSlide(slide, ProductModel)))).map((item, index) => item || {
        id: String(slides[index]._id), productId: String(slides[index].productId), headline: slides[index].headline,
        description: slides[index].description || "", desktopImage: slides[index].desktopImage || "", mobileImage: slides[index].mobileImage || "",
        order: slides[index].order, isActive: Boolean(slides[index].isActive), productName: "Missing product", productInStock: false, product: null,
      });
      return send(res, 200, { items });
    } catch {
      return send(res, 500, { error: "Unable to load hero slides" });
    }
  };

  const createSlide = async (req, res) => {
    const validated = validatePayload(req.body, "create");
    if (validated.error) return fail(res, validated);
    try {
      return await serializeWrite(async () => {
        const product = await readProduct(ProductModel, validated.fields.productId);
        if (!product) return send(res, 404, { error: "Product not found", code: "PRODUCT_NOT_FOUND" });
        if (validated.fields.isActive && !(await activeCountAllows())) return send(res, 409, { error: "Only eight active hero slides are allowed", code: "ACTIVE_SLIDE_LIMIT" });
        let slide;
        try { slide = await HeroSlideModel.create(validated.fields); } catch (error) {
          if (error?.code === 11000) return send(res, 409, { error: "That product already has a hero slide", code: "DUPLICATE_PRODUCT" });
          throw error;
        }
        return send(res, 201, { item: await serializeSlide(slide, ProductModel) });
      });
    } catch {
      return send(res, 500, { error: "Unable to create hero slide" });
    }
  };

  const updateSlide = async (req, res) => {
    if (!isObjectId(req.params.id)) return send(res, 400, { error: "Invalid hero slide id", code: "INVALID_ID" });
    const validated = validatePayload(req.body, "patch");
    if (validated.error) return fail(res, validated);
    try {
      return await serializeWrite(async () => {
        const current = await queryValue(HeroSlideModel.findById(req.params.id));
        if (!current) return send(res, 404, { error: "Hero slide not found", code: "HERO_SLIDE_NOT_FOUND" });
        if (validated.fields.productId && !(await readProduct(ProductModel, validated.fields.productId))) return send(res, 404, { error: "Product not found", code: "PRODUCT_NOT_FOUND" });
        const willBeActive = Object.hasOwn(validated.fields, "isActive") ? validated.fields.isActive : Boolean(current.isActive);
        if (willBeActive && !current.isActive && !(await activeCountAllows(req.params.id))) return send(res, 409, { error: "Only eight active hero slides are allowed", code: "ACTIVE_SLIDE_LIMIT" });
        try { await HeroSlideModel.updateOne({ _id: req.params.id }, { $set: validated.fields }); } catch (error) {
          if (error?.code === 11000) return send(res, 409, { error: "That product already has a hero slide", code: "DUPLICATE_PRODUCT" });
          throw error;
        }
        return send(res, 200, { item: await serializeSlide(await queryValue(HeroSlideModel.findById(req.params.id)), ProductModel) });
      });
    } catch {
      return send(res, 500, { error: "Unable to update hero slide" });
    }
  };

  const deleteSlide = async (req, res) => {
    if (!isObjectId(req.params.id)) return send(res, 400, { error: "Invalid hero slide id", code: "INVALID_ID" });
    try {
      return await serializeWrite(async () => {
        const result = await HeroSlideModel.deleteOne({ _id: req.params.id });
        if (!result.deletedCount) return send(res, 404, { error: "Hero slide not found", code: "HERO_SLIDE_NOT_FOUND" });
        return res.status(204).end();
      });
    } catch {
      return send(res, 500, { error: "Unable to delete hero slide" });
    }
  };

  return { createSlide, deleteSlide, getPublicSlides, listAdminSlides, updateSlide };
};

module.exports = { MAX_ACTIVE_SLIDES, createHeroSlidesController, validImageSource, validatePayload };
