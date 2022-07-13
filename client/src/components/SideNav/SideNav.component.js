import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import "./sideNav.styles.css";
const SideNav = ({ setShowSideNav }) => {
  const navigate = useNavigate();
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
        <span onClick={() => handleNav("/login")}>Login</span>
        <span onClick={() => handleNav("/register")}>Register</span>
        <span onClick={() => handleNav("/cart")}>Cart</span>
      </div>
    </div>
  );
};

export default SideNav;
