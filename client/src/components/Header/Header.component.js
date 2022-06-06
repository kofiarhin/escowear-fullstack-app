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
      <div className="categories">
        <button onClick={() => setCategory("hoodies")}>Hoodies</button>
        <button onClick={() => setCategory("shirts")}>shirts</button>
        <button onClick={() => setCategory("gym")}>Gym</button>
        {/* <a href="/store/hoodies">Hoodies</a>
        <a href="/store/gym">Gym</a>
        <a href="/store/shirts">Shirts</a> */}
      </div>
    </div>
  );
};

export default Header;
