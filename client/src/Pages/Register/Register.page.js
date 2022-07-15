import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./register.styles.css";
import { registerUser, errorHandler } from "../../redux/actions/user.action";
import { useDispatch, useSelector } from "react-redux";

const Register = () => {
  const [name, setName] = useState("test");
  const [email, setEmail] = useState("billy@gmail.com");
  const [password, setPassword] = useState("password");
  const [confirmPassword, setConfirmPassword] = useState("password");

  const navigate = useNavigate();
  const dispatch = useDispatch();
  let { user, isPending, error } = useSelector((state) => state.userReducer);

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    }
  }, [user]);

  // handleSubmit
  const handleSubmit = (e) => {
    e.preventDefault();

    // simple validation will come back to this later
    if (!name || !email || !password) {
      dispatch(errorHandler("please fill out all fields"));
    } else {
      // compare password
      if (password !== confirmPassword) {
        // error = "password does not match";
        dispatch(errorHandler("Password does not match"));
      } else {
        dispatch(registerUser(name, email, password));
        // fetch("/api/users/register", {
        //   headers: {
        //     "Content-type": "application/json",
        //   },
        //   method: "POST",
        //   body: JSON.stringify({ name, email, password }),
        // })
        //   .then((response) =>
        //     response.json().then((data) => navigate("/login"))
        //   )
        //   .catch((error) => setError("There was a problem creating user"));
      }
    }
  };
  return (
    <div className="container">
      <h1 className="title">Register</h1>
      <div className="form-wrapper">
        <form onSubmit={handleSubmit}>
          <div className="form-unit">
            <label htmlFor="name">Name</label>
            <input
              type="text"
              placeholder="Enter name"
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="name">Email</label>
            <input
              type="text"
              placeholder="Enter email"
              onChange={(e) => setEmail(e.target.value)}
              value={email}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              placeholder="Enter password"
              onChange={(e) => setPassword(e.target.value)}
              value={password}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="password">Confirm Password</label>
            <input
              type="password"
              placeholder="Confirm Password"
              onChange={(e) => setConfirmPassword(e.target.value)}
              value={confirmPassword}
            />
          </div>
          {error ? <p className="error"> {error} </p> : null}
          <button
            type="submit"
            style={{
              backgroundColor: isPending ? "green" : "",
            }}
          >
            {" "}
            {isPending ? "Registering User" : "Register"}{" "}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Register;
