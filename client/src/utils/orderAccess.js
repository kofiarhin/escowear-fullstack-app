// Short-lived, read-only order access tokens returned after checkout or a
// verified tracking code. Kept in sessionStorage (this tab only), never in URLs.
const KEY = "escowear-order-access-v1";

const read = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export const saveOrderAccess = (orderId, token, expiresInMinutes, now = Date.now()) => {
  const entries = Object.fromEntries(Object.entries(read()).filter(([, entry]) => entry?.expiresAt > now));
  entries[orderId] = { token, expiresAt: now + expiresInMinutes * 60 * 1000 };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage may be unavailable (private mode); access then lasts for this page view only.
  }
};

export const getOrderAccess = (orderId, now = Date.now()) => {
  const entry = read()[orderId];
  return entry && typeof entry.token === "string" && entry.expiresAt > now ? entry.token : null;
};

export const orderAccessHeader = (orderId) => {
  const token = getOrderAccess(orderId);
  return token ? { "X-Order-Access-Token": token } : {};
};
