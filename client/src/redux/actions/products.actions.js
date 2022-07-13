import {
  GET_PRODUCTS_PENDING,
  GET_PRODUCTS_FAILED,
  GET_PRODUCTS_SUCCESS,
} from "../constanst";

export const getProducts = () => (dispatch) => {
  dispatch({
    type: GET_PRODUCTS_PENDING,
  });

  fetch("/api/products")
    .then((response) => response.json())
    .then((data) => {
      dispatch({
        type: GET_PRODUCTS_SUCCESS,
        payload: data,
      });
    })
    .catch((error) => {
      dispatch({
        type: GET_PRODUCTS_FAILED,
      });
    });
};
