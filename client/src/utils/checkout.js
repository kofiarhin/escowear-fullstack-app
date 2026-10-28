import { POLICY_VERSION, policiesStatus } from "../policies/content";

// Client-side mirror of the server's guest-order rules (server stays authoritative).
export const GHANA_REGIONS = [
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
];

// Recorded on each order. Once the reviewed policies are published, orders
// must record the published policy version (the server rejects any other).
export const TERMS_VERSION =
  policiesStatus() === "published" ? POLICY_VERSION : process.env.REACT_APP_ORDER_TERMS_VERSION || "draft-2026-10";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const isGhanaPhone = (value) => /^(?:\+233|233|0)[2-5]\d{8}$/.test(clean(value).replace(/[\s().-]/g, ""));

export const emptyCheckoutForm = (user) => ({
  name: user?.name || "",
  email: user?.email || "",
  phone: "",
  recipient: "",
  recipientPhone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  region: "",
  termsAccepted: false,
});

export const validateCheckoutForm = (form) => {
  const errors = {};
  if (clean(form.name).length < 2) errors.name = "Enter your full name";
  if (!EMAIL.test(clean(form.email))) errors.email = "Enter a valid email address";
  if (!isGhanaPhone(form.phone)) errors.phone = "Enter a Ghana phone number, e.g. 024 123 4567";
  if (clean(form.recipient) && clean(form.recipient).length < 2) errors.recipient = "Enter the recipient's full name";
  if (clean(form.recipientPhone) && !isGhanaPhone(form.recipientPhone))
    errors.recipientPhone = "Enter a Ghana phone number for the recipient";
  if (clean(form.line1).length < 3) errors.line1 = "Enter the street address or house number";
  if (clean(form.city).length < 2) errors.city = "Enter the town or city";
  if (!GHANA_REGIONS.includes(form.region)) errors.region = "Select your region";
  if (!form.termsAccepted) errors.termsAccepted = "Please confirm you understand how ordering works";
  return errors;
};

export const buildOrderPayload = (form, cartItems) => ({
  customer: { name: clean(form.name), email: clean(form.email), phone: clean(form.phone) },
  shippingAddress: {
    recipient: clean(form.recipient) || undefined,
    phone: clean(form.recipientPhone) || undefined,
    line1: clean(form.line1),
    line2: clean(form.line2) || undefined,
    landmark: clean(form.landmark) || undefined,
    city: clean(form.city),
    region: form.region,
  },
  items: cartItems.map(({ productId, size, quantity }) => ({ productId, size, quantity })),
  termsAccepted: form.termsAccepted === true,
  termsVersion: TERMS_VERSION,
});

// Server field keys -> form field names.
const SERVER_FIELDS = {
  "customer.name": "name",
  "customer.email": "email",
  "customer.phone": "phone",
  "shippingAddress.recipient": "recipient",
  "shippingAddress.phone": "recipientPhone",
  "shippingAddress.line1": "line1",
  "shippingAddress.line2": "line2",
  "shippingAddress.landmark": "landmark",
  "shippingAddress.city": "city",
  "shippingAddress.region": "region",
  termsAccepted: "termsAccepted",
};

export const mapServerErrors = (fields = {}) => {
  const formErrors = {};
  const itemErrors = {};
  let other = null;
  Object.entries(fields).forEach(([key, message]) => {
    const itemMatch = key.match(/^items\.(\d+)/);
    if (SERVER_FIELDS[key]) formErrors[SERVER_FIELDS[key]] = message;
    else if (itemMatch) itemErrors[Number(itemMatch[1])] = message;
    else other = message;
  });
  return { formErrors, itemErrors, other };
};

// --- Idempotency -----------------------------------------------------------
// One key per distinct order attempt. Retrying the same payload (after a
// timeout, double click or reload) reuses the key so the server returns the
// original order instead of creating a second one. Only a hash of the payload
// is stored, never the personal details themselves.
const ATTEMPT_KEY = "escowear-checkout-attempt-v1";

const hashString = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

const randomKey = () => {
  const cryptoApi = typeof window !== "undefined" ? window.crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

let memoryAttempt = null;

export const idempotencyKeyFor = (payload) => {
  const fingerprint = hashString(JSON.stringify(payload));
  if (memoryAttempt?.fingerprint === fingerprint) return memoryAttempt.key;
  try {
    const stored = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null");
    if (stored?.fingerprint === fingerprint && typeof stored.key === "string") {
      memoryAttempt = stored;
      return stored.key;
    }
  } catch {
    // fall through to a new key
  }
  const key = randomKey();
  memoryAttempt = { fingerprint, key };
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ fingerprint, key }));
  } catch {
    // Without storage the key still covers in-page retries.
  }
  return key;
};

export const forgetCheckoutAttempt = () => {
  memoryAttempt = null;
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // ignore
  }
};
