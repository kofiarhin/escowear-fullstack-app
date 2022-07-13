import {
  GET_PRODUCTS_PENDING,
  GET_PRODUCTS_FAILED,
  GET_PRODUCTS_SUCCESS,
} from "../constanst";

export const getProducts = () => (dispatch) => {
  dispatch({
    type: GET_PRODUCTS_PENDING,
  });
};
