import { useCallback, useEffect, useRef, useState } from "react";

export const FEATURED_LIMIT = 4;

// Featured Sneakers are chosen by an admin and load independently of the
// shared catalogue state, so a failure here never hides Latest Releases.
const useFeaturedSneakers = () => {
  const [state, setState] = useState({ status: "pending", items: [], error: null });
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "pending", items: [], error: null });
    try {
      const response = await fetch("/api/featured-sneakers", { signal: controller.signal });
      const data = await response.json().catch(() => null);
      // The body read can be aborted too; a superseded request must not write state.
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data?.error || "Unable to load featured sneakers");
      const items = Array.isArray(data?.items) ? data.items.slice(0, FEATURED_LIMIT) : [];
      setState({ status: "success", items, error: null });
    } catch (error) {
      if (error?.name === "AbortError") return;
      setState({ status: "failed", items: [], error: error?.message || "Unable to load featured sneakers" });
    }
  }, []);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { ...state, retry: load };
};

export default useFeaturedSneakers;
