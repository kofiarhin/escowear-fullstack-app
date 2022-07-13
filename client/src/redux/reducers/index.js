import { combineReducers } from "redux";
import productsReducer from "./products.reducer";

const rootReducer = combineReducers({
  productsReducer,
});

export default rootReducer;
