import { Link } from "react-router-dom";
import "./header.styles.css";
import Search from "../Search/Search.component";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";

// header component
const Header = ({ setCategory, setShowSideNav, onHandleSearch }) => {
  const { user } = useSelector((state) => state.userReducer);

  console.log("xxxxxxxxxx", user);

  const dispatch = useDispatch();
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
              <span onClick={() => dispatch(logoutUser())}> Logout</span>
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
