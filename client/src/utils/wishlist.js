export const WISHLIST_KEY = "escowear-wishlist-v1";
export const WISHLIST_CHANGE_EVENT = "escowear:wishlist-change";
// Bounds what a tampered or runaway entry can make the wishlist page fetch.
export const MAX_WISHLIST_ITEMS = 100;
const MAX_ID_LENGTH = 64;

const isProductId = (value) => typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID_LENGTH;

// Keeps unique, well-formed product ids in saved order; anything else is dropped.
export const normalizeWishlist = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isProductId))].slice(0, MAX_WISHLIST_ITEMS);
};

// Corrupt JSON or unavailable storage reads as an empty wishlist instead of throwing.
export const readWishlist = () => {
  try {
    return normalizeWishlist(JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]"));
  } catch {
    return [];
  }
};

// Returns false when storage rejects the write (quota, privacy mode) so callers can tell the customer.
export const saveWishlist = (ids) => {
  const next = normalizeWishlist(ids);
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGE_EVENT, { detail: next }));
  return true;
};

export const toggleWishlistId = (ids, productId) => {
  const key = String(productId);
  return ids.includes(key) ? ids.filter((id) => id !== key) : [...ids, key];
};

export const wishlistLinkLabel = (count) =>
  count ? `Wishlist, ${count} saved ${count === 1 ? "item" : "items"}` : "Wishlist";
