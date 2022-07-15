export const loginUser = (email, password) => (dispatch) => {
  dispatch({
    type: "LOGIN_PENDING",
  });

  fetch("/api/users/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        dispatch({
          type: "LOGIN_FAILED",
        });
      } else {
        dispatch({
          type: "LOGIN_SUCCESS",
          payload: data,
        });
      }
    })
    .catch((error) => {
      dispatch({
        type: "LOGIN_FAILED",
      });
    });
};

export const logoutUser = () => {
  return {
    type: "LOGOUT_USER",
  };
};

export const registerUser = (name, email, password) => (dispatch) => {
  console.log({ name, email, password });

  dispatch({
    type: "REGISTER_USER_PENDING",
  });

  fetch("/api/users/register", {
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        dispatch({
          type: "REGISTER_USER_FAILED",
          payload: data.error,
        });
      } else {
        dispatch({
          type: "REGISTER_USER_SUCCESS",
          payload: data,
        });
      }
    });
};

export const errorHandler = (message) => {
  return {
    type: "ERROR_HANDLER",
    payload: message,
  };
};
