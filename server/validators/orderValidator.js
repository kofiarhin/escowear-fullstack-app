// Validates and normalizes public guest-order input. Only the fields listed
// here are read; anything else in the body (prices, status, user, payment) is
// ignored rather than trusted.

const MAX_LINES = 20;
const MAX_QUANTITY_PER_LINE = 10;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const TERMS_VERSION = /^[A-Za-z0-9._-]{1,40}$/;

// Ghana's 16 administrative regions.
const GHANA_REGIONS = Object.freeze([
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
]);

const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

const normalizeSize = (value) => {
  const label = clean(String(value ?? ""));
  if (!label) return "";
  return /^UK\b/i.test(label) ? label.replace(/^uk/i, "UK") : `UK ${label}`;
};

// Accepts 0XXXXXXXXX, 233XXXXXXXXX or +233XXXXXXXXX (spaces/dashes allowed) and
// returns E.164. Ghana subscriber numbers are 9 digits after the trunk/country code.
const normalizeGhanaPhone = (value) => {
  const compact = clean(value).replace(/[\s().-]/g, "");
  const match = compact.match(/^(?:\+233|233|0)([2-5]\d{8})$/);
  return match ? `+233${match[1]}` : null;
};

const normalizeEmail = (value) => clean(value).toLowerCase();

const checkLength = (errors, field, value, min, max, label) => {
  if (value.length < min) errors[field] = `${label} is required`;
  else if (value.length > max) errors[field] = `${label} must be ${max} characters or fewer`;
};

const validateGuestOrder = (body) => {
  const errors = {};
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const customerInput = input.customer && typeof input.customer === "object" ? input.customer : {};
  const addressInput =
    input.shippingAddress && typeof input.shippingAddress === "object" ? input.shippingAddress : {};

  const customer = {
    name: clean(customerInput.name),
    email: normalizeEmail(customerInput.email),
    phone: normalizeGhanaPhone(customerInput.phone),
  };
  checkLength(errors, "customer.name", customer.name, 2, 100, "Full name");
  if (!customer.email) errors["customer.email"] = "Email is required";
  else if (customer.email.length > 254 || !EMAIL.test(customer.email))
    errors["customer.email"] = "Enter a valid email address";
  if (!customer.phone) errors["customer.phone"] = "Enter a valid Ghana phone number";

  const recipient = clean(addressInput.recipient) || customer.name;
  const recipientPhone = addressInput.phone ? normalizeGhanaPhone(addressInput.phone) : customer.phone;
  const shippingAddress = {
    recipient,
    phone: recipientPhone,
    line1: clean(addressInput.line1),
    line2: clean(addressInput.line2),
    landmark: clean(addressInput.landmark),
    city: clean(addressInput.city),
    region: GHANA_REGIONS.find((region) => region.toLowerCase() === clean(addressInput.region).toLowerCase()) || "",
    country: "GH",
  };
  checkLength(errors, "shippingAddress.recipient", shippingAddress.recipient, 2, 100, "Recipient name");
  if (!shippingAddress.phone) errors["shippingAddress.phone"] = "Enter a valid Ghana phone number for the recipient";
  checkLength(errors, "shippingAddress.line1", shippingAddress.line1, 3, 200, "Street address");
  if (shippingAddress.line2.length > 200) errors["shippingAddress.line2"] = "Address line 2 must be 200 characters or fewer";
  if (shippingAddress.landmark.length > 200) errors["shippingAddress.landmark"] = "Landmark must be 200 characters or fewer";
  checkLength(errors, "shippingAddress.city", shippingAddress.city, 2, 80, "Town or city");
  if (!shippingAddress.region) errors["shippingAddress.region"] = "Select a Ghana region";
  if (addressInput.country && clean(addressInput.country).toUpperCase() !== "GH")
    errors["shippingAddress.country"] = "We currently deliver to Ghana only";

  if (input.termsAccepted !== true) errors.termsAccepted = "You must agree to the order terms";
  const termsVersion = clean(input.termsVersion);
  if (!TERMS_VERSION.test(termsVersion)) errors.termsVersion = "Terms version is missing";

  const items = [];
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.items = "Your cart is empty";
  } else if (input.items.length > MAX_LINES) {
    errors.items = `An order can contain at most ${MAX_LINES} lines`;
  } else {
    const seen = new Map();
    input.items.forEach((raw, index) => {
      const productId = typeof raw?.productId === "string" ? raw.productId.trim() : "";
      const size = normalizeSize(raw?.size);
      const quantity = raw?.quantity;
      if (!OBJECT_ID.test(productId)) errors[`items.${index}.productId`] = "Invalid product";
      if (!size) errors[`items.${index}.size`] = "Select a size";
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE)
        errors[`items.${index}.quantity`] = `Quantity must be between 1 and ${MAX_QUANTITY_PER_LINE}`;
      if (errors[`items.${index}.productId`] || errors[`items.${index}.size`] || errors[`items.${index}.quantity`]) return;

      // Merge duplicate lines for the same variant rather than trusting the client to.
      const key = `${productId.toLowerCase()}:${size}`;
      if (seen.has(key)) {
        const line = seen.get(key);
        line.quantity += quantity;
        if (line.quantity > MAX_QUANTITY_PER_LINE)
          errors[`items.${index}.quantity`] = `Quantity must be between 1 and ${MAX_QUANTITY_PER_LINE}`;
      } else {
        const line = { productId: productId.toLowerCase(), size, quantity };
        seen.set(key, line);
        items.push(line);
      }
    });
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { customer, shippingAddress, items, termsVersion } };
};

const isValidIdempotencyKey = (key) => typeof key === "string" && IDEMPOTENCY_KEY.test(key);
const isObjectId = (value) => typeof value === "string" && OBJECT_ID.test(value);

module.exports = {
  GHANA_REGIONS,
  MAX_LINES,
  MAX_QUANTITY_PER_LINE,
  isObjectId,
  isValidIdempotencyKey,
  normalizeEmail,
  normalizeGhanaPhone,
  normalizeSize,
  validateGuestOrder,
};
