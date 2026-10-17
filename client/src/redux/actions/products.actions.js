import {
  GET_PRODUCTS_PENDING,
  GET_PRODUCTS_FAILED,
  GET_PRODUCTS_SUCCESS,
} from "../constanst";

const buildProductsUrl = (params = {}) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `/api/products?${query}` : "/api/products";
};

export const getProducts = (params = {}) => (dispatch) => {
  dispatch({
    type: GET_PRODUCTS_PENDING,
  });

  return fetch(buildProductsUrl(params))
    .then((response) => {
      if (!response.ok) throw new Error("Products request failed");
      return response.json();
    })
    .then((data) => {
      const items = Array.isArray(data) ? data : data.items || [];
      dispatch({
        type: GET_PRODUCTS_SUCCESS,
        payload: {
          items,
          pagination: data.pagination || {
            total: items.length,
            page: 1,
            limit: items.length,
            pages: items.length ? 1 : 0,
          },
        },
      });
    })
    .catch((error) => {
      dispatch({
        type: GET_PRODUCTS_FAILED,
        payload: error.message,
      });
    });
};

export { buildProductsUrl };
