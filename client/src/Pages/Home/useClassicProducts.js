import { useEffect, useState } from "react";
import { buildProductsUrl } from "../../redux/actions/products.actions";
import { classicLinks } from "./homeContent";

// Keep discovery requests separate from Redux's shared Store/Latest Releases state.
const useClassicProducts = () => {
  const [products, setProducts] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    classicLinks.forEach(async ({ search }) => {
      let product = null;
      try {
        const response = await fetch(buildProductsUrl({ search, limit: 1 }), { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          product = (Array.isArray(data) ? data : data?.items)?.[0] || null;
        }
      } catch {
        // A failed/empty search gets the default image; other tiles still load.
      }
      if (!controller.signal.aborted) {
        setProducts((current) => ({ ...current, [search]: product }));
      }
    });
    return () => controller.abort();
  }, []);

  return products;
};

export default useClassicProducts;
