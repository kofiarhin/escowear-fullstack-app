import { Link } from "react-router-dom";
import "./header.styles.css";
import Search from "../Search/Search.conponent";
const Header = ({ user, setCategory, setShowSideNav, onHandleSearch }) => {
  return (
    <div className="main-header">
      <div className="container">
        <Link to="/">
          <h1>Escowear</h1>
        </Link>

        <Search onSearch={onHandleSearch} />
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

        <div className="menu" onClick={() => setShowSideNav(true)}>
          <i className="fa fa-bars"></i>
        </div>
      </div>
    </div>
  );
};

export default Header;
