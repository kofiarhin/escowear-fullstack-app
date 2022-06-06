import { Link } from "react-router-dom";
import "./header.styles.css";
const Header = ({ user, setCategory }) => {
  return (
    <div className="main-header">
      <div className="container">
        <Link to="/">
          <h1>Escowear</h1>
        </Link>

        <nav>
          <Link to="/">Home</Link>
          <Link to="/store">store</Link>
          <Link to="/cart">Cart</Link>{" "}
          {user ? (
            <span>
              <Link to="/dashboard"> {user.name.split(" ")[0]} </Link>
              <Link to="/logout">Logout</Link>
            </span>
          ) : (
            <span>
              <Link to="/login">Login</Link>
              <Link to="/register">Register</Link>
            </span>
          )}
        </nav>
      </div>
    </div>
  );
};

export default Header;
