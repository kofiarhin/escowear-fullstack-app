import { GET_USER_PENDING } from "../constanst";

const handleUser = () => {
  const user = localStorage.getItem("user");
  if (!user) return null;
  return JSON.parse(user);
};

const initialState = {
  user: handleUser(),
  isPending: false,
  error: "",
};

const userReducer = (state = initialState, action) => {
  switch (action.type) {
    case "ERROR_HANDLER":
      return { ...state, error: action.payload };
    case "REGISTER_USER_FAILED":
      return {
        ...state,
        isPending: false,
        error: action.payload,
      };
    case "REGISTER_USER_SUCCESS":
      return { ...state, isPending: false, user: action.payload };
    case "REGISTER_USER_PENDING":
      return { ...state, isPending: true, user: action.payload };
    case "LOGOUT_USER":
      localStorage.removeItem("user");
      return { ...state, user: null };
    case "LOGIN_PENDING":
      return { ...state, isPending: true };
    case "LOGIN_SUCCESS":
      localStorage.setItem("user", JSON.stringify(action.payload));
      return { ...state, isPending: false, user: action.payload };
    case "LOGIN_FAILED":
      return {
        ...state,
        isPending: false,
        error: "invalid email/password combination",
      };
    default:
      return state;
  }
};

export default userReducer;
