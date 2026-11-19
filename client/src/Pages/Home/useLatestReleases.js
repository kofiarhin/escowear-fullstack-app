import { useCallback, useEffect, useRef, useState } from "react";

export const LATEST_RELEASES_LIMIT = 8;
// Before an admin saves a selection the server returns the four newest products.
export const LATEST_DEFAULT_COUNT = 4;

// Latest Releases load independently of the shared catalogue state, so a
// failure here never hides Featured Sneakers or the Classics.
const useLatestReleases = () => {
  const [state, setState] = useState({ status: "pending", items: [], configured: false, error: null });
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "pending", items: [], configured: false, error: null });
    try {
      const response = await fetch("/api/latest-releases", { signal: controller.signal });
      const data = await response.json().catch(() => null);
      // The body read can be aborted too; a superseded request must not write state.
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data?.error || "Unable to load latest releases");
      const items = Array.isArray(data?.items) ? data.items.slice(0, LATEST_RELEASES_LIMIT) : [];
      setState({ status: "success", items, configured: data?.configured === true, error: null });
    } catch (error) {
      if (error?.name === "AbortError") return;
      setState({ status: "failed", items: [], configured: false, error: error?.message || "Unable to load latest releases" });
    }
  }, []);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { ...state, retry: load };
};

export default useLatestReleases;
