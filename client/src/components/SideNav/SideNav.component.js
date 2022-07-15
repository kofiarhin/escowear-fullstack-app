import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import "./sideNav.styles.css";
import { logoutUser } from "../../redux/actions/user.action";
// sidenav component
const SideNav = ({ setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const navigate = useNavigate();

  const dispatch = useDispatch();
  // handle side navigation
  const handleNav = (path) => {
    setShowSideNav(false);
    navigate(path);
  };
  return (
    <div className="sideNav">
      <i
        className="fa fa-close close"
        onClick={() => setShowSideNav(false)}
      ></i>
      <h1 className="title">Escowear</h1>

      <div className="links-wrapper">
        <span onClick={() => handleNav("/")}>Home</span>
        <span onClick={() => handleNav("/store")}>Store</span>
        <span onClick={() => handleNav("/cart")}>Cart</span>

        {user ? (
          <span>
            <span to="/dashboard"> {user.name.split(" ")[0]} </span>
            <span
              onClick={() => {
                dispatch(logoutUser());
                handleNav("/login");
              }}
            >
              {" "}
              Logout
            </span>
          </span>
        ) : (
          <span>
            <span onClick={() => handleNav("/register")}>Register</span>
            <span onClick={() => handleNav("/login")}>Login</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default SideNav;
