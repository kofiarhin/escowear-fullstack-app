import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import "./login.styles.css";
import { loginUser } from "../../redux/actions/user.action";
import { postLoginPath } from "../../utils/authRedirect";

// login component
const Login = ({ setIsLoggedIn }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user, isPending, error } = useSelector((state) => state.userReducer);

  // A safe return path (e.g. from checkout) wins; otherwise admins land on
  // /admin and customers on /account.
  const from = location.state?.from;
  const { search } = location;
  useEffect(() => {
    if (user) {
      navigate(postLoginPath(user, { from, search }), { replace: true });
    }
  }, [user, from, search, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      console.log("please fill out all fields");
    } else {
      const result = await dispatch(loginUser(email, password));
      // New accounts must verify their email first (IDE-152).
      if (result?.code === "EMAIL_NOT_VERIFIED") navigate("/check-email");
    }
  };

  return (
    <div className="login">
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

            <p className="login-recovery-link"><Link to="/forgot-password">Forgot password?</Link></p>

            <button
              type="submit"
              style={{
                backgroundColor: isPending ? "var(--pending)" : "",
                color: isPending ? "var(--pending-text)" : "",
              }}
            >
              {isPending ? "Loging in User " : "Login"}{" "}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
