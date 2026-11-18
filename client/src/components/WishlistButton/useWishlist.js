import { useCallback, useEffect, useState } from "react";
import {
  MAX_WISHLIST_ITEMS,
  WISHLIST_CHANGE_EVENT,
  WISHLIST_KEY,
  normalizeWishlist,
  readWishlist,
  saveWishlist,
  toggleWishlistId,
} from "../../utils/wishlist";

// Every consumer (hearts, header counter, wishlist page) shares localStorage as the
// source of truth: a same-tab event keeps components in step, and the native
// storage event carries changes made in other tabs.
const useWishlist = () => {
  const [ids, setIds] = useState(readWishlist);

  useEffect(() => {
    const syncFromEvent = (event) => setIds(normalizeWishlist(event.detail));
    const syncFromStorage = (event) => {
      // A null key means another tab cleared all storage.
      if (event.key === WISHLIST_KEY || event.key === null) setIds(readWishlist());
    };
    window.addEventListener(WISHLIST_CHANGE_EVENT, syncFromEvent);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(WISHLIST_CHANGE_EVENT, syncFromEvent);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  // Reads storage rather than state so rapid toggles never act on a stale list.
  const toggle = useCallback((productId) => {
    const current = readWishlist();
    const adding = !current.includes(String(productId));
    if (adding && current.length >= MAX_WISHLIST_ITEMS) return "full";
    if (!saveWishlist(toggleWishlistId(current, productId))) return "failed";
    return adding ? "added" : "removed";
  }, []);

  const remove = useCallback((productId) => {
    const current = readWishlist();
    return saveWishlist(current.filter((id) => id !== String(productId)));
  }, []);

  return { ids, count: ids.length, has: (productId) => ids.includes(String(productId)), toggle, remove };
};

export default useWishlist;
