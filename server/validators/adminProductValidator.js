const { normalizeSize } = require("./orderValidator");

const { normalizeColors } = require("../services/productColors");
const EDITABLE_FIELDS = new Set(["name", "price", "brand", "category", "gender", "color", "colors", "sizes", "inStock", "description", "images", "managedImages"]);
const CONTROL = /[\u0000-\u001f\u007f]/;

const imageUrl = (value) => {
  if (typeof value !== "string" || value !== value.trim() || value.length > 2048 || CONTROL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const text = (value, maximum, label, { required = false } = {}) => {
  if (typeof value !== "string" || value !== value.trim() || CONTROL.test(value) || /[<>]/.test(value)) return `${label} must be plain text`;
  if (required && !value) return `${label} is required`;
  if (value.length > maximum) return `${label} must be ${maximum} characters or fewer`;
  return null;
};

const normalizeSizes = (value) => {
  if (!Array.isArray(value) || value.length > 20) return null;
  const sizes = value.map((item) => (typeof item === "string" ? normalizeSize(item) : ""));
  if (sizes.some((item) => !item || item.length > 20 || CONTROL.test(item))) return null;
  if (new Set(sizes.map((item) => item.toLowerCase())).size !== sizes.length) return null;
  return sizes;
};

const validateProductInput = (body, { partial = false } = {}) => {
  if (!body || Array.isArray(body) || typeof body !== "object") return { status: 400, code: "INVALID_BODY", error: "Expected a JSON object", fields: { body: "Expected an object" } };
  const unknown = Object.keys(body).filter((key) => !EDITABLE_FIELDS.has(key));
  if (unknown.length) return { status: 400, code: "UNKNOWN_FIELD", error: "Product contains a field that cannot be changed", fields: { [unknown[0]]: "This field is not allowed" } };
  if (partial && Object.keys(body).length === 0) return { status: 422, code: "VALIDATION_FAILED", error: "Provide at least one editable field", fields: { body: "Provide at least one editable field" } };

  const values = {};
  const fields = {};
  const optional = { name: [160, "Product name"], brand: [100, "Brand"], category: [80, "Category"], gender: [40, "Gender"], color: [80, "Color"], description: [2000, "Description"] };
  for (const [key, [maximum, label]] of Object.entries(optional)) {
    if (!Object.hasOwn(body, key)) continue;
    const issue = text(body[key], maximum, label);
    if (issue || (key === "name" && !body[key])) fields[key] = issue || "Product name must not be empty";
    else values[key] = body[key];
  }
  if (Object.hasOwn(body, "price")) {
    const price = body.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || Math.round(price * 100) !== price * 100) fields.price = "Enter a positive GBP price with at most two decimal places";
    else values.price = price;
  }
  if (Object.hasOwn(body, "sizes")) {
    const sizes = normalizeSizes(body.sizes);
    if (!sizes) fields.sizes = "Use up to 20 unique UK sizes";
    else values.sizes = sizes;
  }
  if (Object.hasOwn(body, "colors")) {
    if (!Array.isArray(body.colors) || body.colors.length > 16 || body.colors.some((color) => typeof color !== "string")) fields.colors = "Use up to 16 unique colours";
    else {
      const colors = normalizeColors(body.colors);
      if (body.colors.length && !colors.length) fields.colors = "Use valid colour names";
      else values.colors = colors;
    }
  }
  if (Object.hasOwn(body, "inStock")) {
    if (typeof body.inStock !== "boolean") fields.inStock = "In stock must be true or false";
    else values.inStock = body.inStock;
  }
  if (Object.hasOwn(body, "images")) {
    if (!Array.isArray(body.images) || body.images.length > 8 || body.images.some((item) => !imageUrl(item)) || new Set(body.images).size !== body.images.length) fields.images = "Use up to eight unique valid image URLs";
    else values.images = body.images;
  }
  if (Object.hasOwn(body, "managedImages")) {
    if (!Array.isArray(body.managedImages) || body.managedImages.length > 8 || body.managedImages.some((item) => !item || typeof item !== "object" || Array.isArray(item) || typeof item.publicId !== "string" || !item.publicId || item.publicId.length > 300 || !imageUrl(item.secureUrl)) || new Set(body.managedImages.map((item) => item.publicId)).size !== body.managedImages.length) fields.managedImages = "Use server-issued image references";
    else values.managedImages = body.managedImages;
  }
  if (Object.hasOwn(values, "images") !== Object.hasOwn(values, "managedImages")) fields.images = "Images and ownership references must be saved together";
  if (values.images && values.managedImages && values.managedImages.some((image) => !values.images.includes(image.secureUrl))) fields.images = "Uploaded image references must appear in the gallery";
  return Object.keys(fields).length ? { status: 422, code: "VALIDATION_FAILED", error: "Please correct the highlighted fields", fields } : { values };
};

const validatePublishedProduct = (product) => {
  const fields = {};
  const required = { name: [160, "Product name"], brand: [100, "Brand"], category: [80, "Category"] };
  for (const [key, [maximum, label]] of Object.entries(required)) {
    const issue = text(product[key], maximum, label, { required: true });
    if (issue) fields[key] = issue;
  }
  if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0 || Math.round(product.price * 100) !== product.price * 100) fields.price = "Enter a positive GBP price with at most two decimal places";
  if (product.currency !== "GBP") fields.currency = "Only GBP products can be published";
  if (product.inStock !== true) fields.inStock = "Mark this product in stock before publishing";
  const sizes = normalizeSizes(product.sizes);
  if (!sizes || sizes.length === 0) fields.sizes = "Add at least one unique UK size";
  if (!Array.isArray(product.images) || !product.images.length || product.images.some((url) => !imageUrl(url)) || product.image !== product.images[0]) fields.images = "Add at least one valid product image";
  return Object.keys(fields).length ? fields : null;
};

module.exports = { EDITABLE_FIELDS, imageUrl, normalizeSizes, validateProductInput, validatePublishedProduct };
