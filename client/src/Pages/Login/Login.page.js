import { useState } from "react";
import { useNavigate } from "react-router-dom";

const Login = ({ setIsLoggedIn }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!email || !password) {
      console.log("please fill out all fields");
    } else {
      const dataToSubmit = {
        email,
        password,
      };

      fetch("/api/users/login", {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(dataToSubmit),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            // set error message
            console.log("error");
            setError(data.error);
          } else {
            // set user token and redirect to dashboard

            localStorage.setItem("user", JSON.stringify(data));
            setIsLoggedIn(data);
            // redirect to dashboard
            navigate("/dashboard");
          }
        })
        .catch((error) => console.log("yyyyy", error));
    }
  };

  return (
    <div className="container">
      <h1 className="title">Login</h1>
      <div className="form-wrapper">
        <form onSubmit={handleSubmit}>
          <div className="form-unit">
            <label htmlFor="email">Email</label>
            <input
              type="text"
              placeholder="Enter Email"
              onChange={(e) => setEmail(e.target.value)}
              value={email}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="email">Password</label>
            <input
              type="password"
              placeholder="Enter Password"
              onChange={(e) => setPassword(e.target.value)}
              value={password}
            />
          </div>

          <p className="error"> {error ? error : null} </p>

          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  );
};

export default Login;
