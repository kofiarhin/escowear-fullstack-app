import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../utils/api";

// 400 (malformed id) and 404 (deleted or unpublished) both mean the saved pair is gone for good.
const GONE_STATUSES = new Set([400, 404]);

const loadProduct = async (id) => {
  try {
    const { ok, status, data } = await apiRequest(`/api/products/${encodeURIComponent(id)}`);
    if (ok && data?._id) return { status: "ready", product: data };
    return { status: GONE_STATUSES.has(status) ? "missing" : "error" };
  } catch {
    return { status: "error" };
  }
};

// Fetches each saved product once and keeps results keyed by id, so removing a
// pair or saving another only requests what is new. Failed loads can be retried.
const useWishlistProducts = (ids) => {
  const [entries, setEntries] = useState({});
  const mounted = useRef(true);
  // Ids with a request in flight, so a repeated effect run (StrictMode) never requests twice.
  const requested = useRef(new Set());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const pending = ids.filter((id) => !entries[id] && !requested.current.has(id));
    if (!pending.length) return;

    setEntries((current) => {
      const next = { ...current };
      for (const id of pending) next[id] = { status: "loading" };
      return next;
    });
    for (const id of pending) {
      requested.current.add(id);
      loadProduct(id).then((entry) => {
        requested.current.delete(id);
        if (mounted.current) setEntries((current) => ({ ...current, [id]: entry }));
      });
    }
  }, [ids, entries]);

  // Dropping the entry makes the effect above request it again.
  const retry = useCallback((id) => {
    setEntries((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return { items: ids.map((id) => ({ id, ...(entries[id] || { status: "loading" }) })), retry };
};

export default useWishlistProducts;
