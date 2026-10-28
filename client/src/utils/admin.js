// Helpers for the admin console. The server enforces every rule; these only
// shape inputs and labels.
export const ORDER_STATUSES = [
  "pending_contact",
  "awaiting_customer",
  "awaiting_payment",
  "payment_review",
  "payment_issue",
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
  "delivery_issue",
  "completed",
  "sourcing_failed",
  "refund_pending",
  "refunded",
  "cancelled",
];

export const humanize = (value) => (value ? String(value).replace(/_/g, " ") : "—");

// Fulfilment steps the server allows from each status.
export const FULFILMENT_STEPS = {
  confirmed: ["processing", "sourcing_failed"],
  processing: ["dispatched", "sourcing_failed"],
  dispatched: ["delivered", "delivery_issue"],
  delivered: ["completed", "delivery_issue"],
  delivery_issue: ["dispatched", "delivered", "completed"],
  sourcing_failed: ["processing"],
};

// "5,200.50" / "5200.5" -> 520050 pesewas; null when not a valid amount.
export const toMinorUnits = (value) => {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
};

// datetime-local value (browser local time) -> ISO string.
export const localDateTimeToIso = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

// Date -> value for a datetime-local input, in the browser's local time.
export const toLocalDateTimeInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const isAdmin = (user) => user?.role === "admin" && Boolean(user?.token);
