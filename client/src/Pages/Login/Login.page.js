import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import "./login.styles.css";
import { loginUser } from "../../redux/actions/user.action";

// login component
const Login = ({ setIsLoggedIn }) => {
  const [email, setEmail] = useState("lebron@gmail.com");
  const [password, setPassword] = useState("passwordsss");
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user, isPending, error } = useSelector((state) => state.userReducer);

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    } 
  }, [user]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!email || !password) {
      console.log("please fill out all fields");
    } else {
      dispatch(loginUser(email, password));
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

            <button
              type="submit"
              style={{
                backgroundColor: isPending ? "green" : "",
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
