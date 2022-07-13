import {
  GET_PRODUCTS_FAILED,
  GET_PRODUCTS_PENDING,
  GET_PRODUCTS_SUCCESS,
} from "../constanst";

const initialState = {
  products: [],
  isPending: false,
};

const productsReducer = (state = initialState, action) => {
  switch (action.type) {
    case GET_PRODUCTS_PENDING:
      return { ...state, isPending: true };
    case GET_PRODUCTS_SUCCESS:
      return { ...state, isPending: false, products: action.payload };
    case GET_PRODUCTS_FAILED:
      return {
        ...state,
        isPending: false,
        error: "There was a problem gettting product",
      };
    default:
      return state;
  }
};

export default productsReducer;
