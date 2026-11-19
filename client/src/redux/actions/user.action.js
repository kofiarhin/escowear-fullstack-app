import { savePendingVerification } from "../../utils/verification";

const DEFAULT_LOGIN_ERROR = "invalid email/password combination";

// Resolves with the server response so the page can route an unverified
// account to the check-email page (IDE-152).
export const loginUser = (email, password) => (dispatch) => {
  dispatch({
    type: "LOGIN_PENDING",
  });

  return fetch("/api/users/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.code === "EMAIL_NOT_VERIFIED" && data.verification?.pendingToken) {
        savePendingVerification(data.verification);
        dispatch({ type: "LOGIN_FAILED", payload: "" });
      } else if (data.error) {
        // Unverified-expired and blocked accounts get their own message; every
        // other failure keeps the generic one.
        const specific = ["ACCOUNT_EXPIRED", "ACCOUNT_BLOCKED"].includes(data.code) ? data.error : DEFAULT_LOGIN_ERROR;
        dispatch({ type: "LOGIN_FAILED", payload: specific });
      } else {
        dispatch({
          type: "LOGIN_SUCCESS",
          payload: data,
        });
      }
      return data;
    })
    .catch(() => {
      dispatch({ type: "LOGIN_FAILED", payload: DEFAULT_LOGIN_ERROR });
      return null;
    });
};

export const logoutUser = () => {
  return {
    type: "LOGOUT_USER",
  };
};

// Registration no longer signs in: new accounts verify their email first.
// Resolves with { ok, data } so the page can show the check-email step.
export const registerUser = (name, email, password, passwordConfirmation) => (dispatch) => {
  dispatch({
    type: "REGISTER_USER_PENDING",
  });

  return fetch("/api/users/register", {
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({ name, email, password, passwordConfirmation }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error || !data.verification?.pendingToken) {
        dispatch({
          type: "REGISTER_USER_FAILED",
          payload: data.error || "There was a problem registering. Please try again.",
        });
        return { ok: false, data };
      }
      savePendingVerification(data.verification);
      dispatch({ type: "REGISTER_USER_SUCCESS" });
      return { ok: true, data };
    })
    .catch(() => {
      dispatch({ type: "REGISTER_USER_FAILED", payload: "There was a problem registering. Please try again." });
      return { ok: false, data: null };
    });
};

export const errorHandler = (message) => {
  return {
    type: "ERROR_HANDLER",
    payload: message,
  };
};
