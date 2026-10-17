import {
  GET_PRODUCTS_FAILED,
  GET_PRODUCTS_PENDING,
  GET_PRODUCTS_SUCCESS,
} from "../constanst";

const initialState = {
  products: [],
  isPending: false,
  status: "idle",
  error: "",
  pagination: {
    total: 0,
    page: 1,
    limit: 24,
    pages: 0,
  },
};

const productsReducer = (state = initialState, action) => {
  switch (action.type) {
    case GET_PRODUCTS_PENDING:
      return { ...state, isPending: true, status: "pending", error: "" };
    case GET_PRODUCTS_SUCCESS:
      return {
        ...state,
        isPending: false,
        status: "success",
        products: action.payload.items,
        pagination: action.payload.pagination,
        error: "",
      };
    case GET_PRODUCTS_FAILED:
      return {
        ...state,
        isPending: false,
        status: "failed",
        error: action.payload || "There was a problem getting products.",
      };
    default:
      return state;
  }
};

export default productsReducer;
