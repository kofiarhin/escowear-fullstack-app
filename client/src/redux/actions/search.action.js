import { SET_SEARCH_FIELD } from "../constanst";
export const setSearchField = (search) => {
  return {
    type: SET_SEARCH_FIELD,
    payload: search,
  };
};
