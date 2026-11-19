import { useCallback, useEffect, useRef, useState } from "react";
import { classicLinks } from "./homeContent";

export const CLASSICS_LIMIT = 6;

// If the Classics request fails, the built-in silhouettes still link to live
// searches; their tiles show the default image.
const FALLBACK_ITEMS = classicLinks.map(({ name, search }) => ({ title: name, searchTerm: search, product: null }));

const isCard = (item) => typeof item?.title === "string" && item.title.trim() && typeof item?.searchTerm === "string" && item.searchTerm.trim();

// One request loads every admin-managed card, independently of the shared
// catalogue state, so a failure here never hides Featured or Latest Releases.
const useHomepageClassics = () => {
  const [state, setState] = useState({ status: "pending", items: [] });
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "pending", items: [] });
    try {
      const response = await fetch("/api/classics", { signal: controller.signal });
      const data = await response.json().catch(() => null);
      // The body read can be aborted too; a superseded request must not write state.
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(data?.items)) throw new Error("Unable to load classics");
      setState({ status: "success", items: data.items.filter(isCard).slice(0, CLASSICS_LIMIT) });
    } catch (error) {
      if (error?.name === "AbortError") return;
      setState({ status: "failed", items: FALLBACK_ITEMS });
    }
  }, []);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return state;
};

export default useHomepageClassics;
