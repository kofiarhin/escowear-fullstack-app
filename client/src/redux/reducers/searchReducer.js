import { SET_SEARCH_FIELD } from "../constanst";
const initialState = {
  searchField: "",
};

const searchReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_SEARCH_FIELD:
      return { ...state, searchField: action.payload };
    default:
      return state;
  }
};

export default searchReducer;
