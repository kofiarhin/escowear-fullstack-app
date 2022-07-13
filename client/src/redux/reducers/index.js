import { combineReducers } from "redux";
import productsReducer from "./products.reducer";
import searchReducer from "./searchReducer";

const rootReducer = combineReducers({
  productsReducer,
  searchReducer,
});

export default rootReducer;
