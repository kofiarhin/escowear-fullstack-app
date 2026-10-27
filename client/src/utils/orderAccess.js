// Short-lived, single-order tokens returned after checkout or a verified
// tracking code. Kept in sessionStorage (this tab only), never in URLs.
//   - read token: view the order (read-only)
//   - proof token: separate capability to upload payment proof for that order
const KEY = "escowear-order-access-v1";
const PROOF_KEY = "escowear-order-proof-v1";

const read = (key) => {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

const save = (key, orderId, token, expiresInMinutes, now) => {
  if (!orderId || typeof token !== "string" || !token) return;
  const entries = Object.fromEntries(Object.entries(read(key)).filter(([, entry]) => entry?.expiresAt > now));
  entries[orderId] = { token, expiresAt: now + expiresInMinutes * 60 * 1000 };
  try {
    sessionStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Storage may be unavailable (private mode); access then lasts for this page view only.
  }
};

const get = (key, orderId, now) => {
  const entry = read(key)[orderId];
  return entry && typeof entry.token === "string" && entry.expiresAt > now ? entry.token : null;
};

export const saveOrderAccess = (orderId, token, expiresInMinutes, now = Date.now()) => save(KEY, orderId, token, expiresInMinutes, now);

export const getOrderAccess = (orderId, now = Date.now()) => get(KEY, orderId, now);

export const orderAccessHeader = (orderId) => {
  const token = getOrderAccess(orderId);
  return token ? { "X-Order-Access-Token": token } : {};
};

export const saveProofAccess = (orderId, token, expiresInMinutes, now = Date.now()) => save(PROOF_KEY, orderId, token, expiresInMinutes, now);

export const getProofAccess = (orderId, now = Date.now()) => get(PROOF_KEY, orderId, now);

export const proofAccessHeader = (orderId) => {
  const token = getProofAccess(orderId);
  return token ? { "X-Order-Proof-Token": token } : {};
};

// Drops an expired/rejected proof token so the page can ask to re-verify.
export const clearProofAccess = (orderId) => {
  const entries = read(PROOF_KEY);
  delete entries[orderId];
  try {
    sessionStorage.setItem(PROOF_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
};
