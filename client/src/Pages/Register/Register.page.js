import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./register.styles.css";
import { registerUser, errorHandler } from "../../redux/actions/user.action";
import { useDispatch, useSelector } from "react-redux";
import { postLoginPath } from "../../utils/authRedirect";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Client-side mirror of the server rules; the server stays authoritative.
const validate = ({ name, email, password, confirmPassword }) => {
  if (!name.trim() || !email.trim() || !password) return "Please fill out all fields";
  if (!EMAIL.test(email.trim())) return "Enter a valid email address";
  if (password.length < 10) return "Password must be at least 10 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  if (password !== confirmPassword) return "Password does not match";
  return "";
};

const Register = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user, isPending, error } = useSelector((state) => state.userReducer);

  // Someone already signed in has nothing to register.
  const from = location.state?.from;
  const { search } = location;
  useEffect(() => {
    if (user) {
      navigate(postLoginPath(user, { from, search }), { replace: true });
    }
  }, [user, from, search, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate({ name, email, password, confirmPassword });
    if (problem) {
      dispatch(errorHandler(problem));
      return;
    }
    const result = await dispatch(registerUser(name, email, password, confirmPassword));
    // New accounts verify their email before they can sign in (IDE-152).
    if (result?.ok) navigate("/check-email", { replace: true });
  };

  return (
    <div className="container">
      <h1 className="title">Register</h1>
      <div className="form-wrapper">
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-unit">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              autoComplete="name"
              type="text"
              placeholder="Enter name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              autoComplete="email"
              type="email"
              placeholder="Enter email"
              onChange={(e) => setEmail(e.target.value)}
              value={email}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="At least 10 characters"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              value={password}
            />
          </div>

          <div className="form-unit">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="Confirm Password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
              value={confirmPassword}
            />
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="register-note">We will email you a link to verify your address before you can sign in.</p>
          <button
            type="submit"
            disabled={isPending}
            style={{
              backgroundColor: isPending ? "var(--pending)" : "",
              color: isPending ? "var(--pending-text)" : "",
            }}
          >
            {isPending ? "Registering User" : "Register"}
          </button>
          <p className="register-note">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Register;
