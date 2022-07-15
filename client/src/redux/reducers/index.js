import { combineReducers } from "redux";
import productsReducer from "./products.reducer";
import searchReducer from "./searchReducer";
import userReducer from "./user.reducer";

const rootReducer = combineReducers({
  productsReducer,
  searchReducer,
  userReducer,
});

export default rootReducer;
