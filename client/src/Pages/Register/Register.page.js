import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const handleSubmit = (e) => {
    e.preventDefault();

    // simple validation will come back to this later
    if (!name || !email || !password) {
      setError("please fill outt all fields");
    } else {
      // compare password
      if (password !== confirmPassword) {
        setError("Password do not match");
      } else {
        fetch("/api/users/register", {
          headers: {
            "Content-type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({ name, email, password }),
        })
          .then((response) =>
            response.json().then((data) => navigate("/login"))
          )
          .catch((error) => setError("There was a problem creating user"));
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
          <button type="submit">Register</button>
        </form>
      </div>
    </div>
  );
};

export default Register;
