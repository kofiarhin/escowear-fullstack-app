import { useDispatch, useSelector } from "react-redux";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./sideNav.styles.css";
import { logoutUser } from "../../redux/actions/user.action";

const navigation = [
  { label: "Home", to: "/" },
  { label: "Shop", to: "/store?category=shoes" },
  { label: "New Releases", to: "/#latest-releases" },
  { label: "Collections", to: "/#collections" },
  { label: "About", to: "/#about" },
];

const SideNav = ({ setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setShowSideNav(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [setShowSideNav]);

  const handleNav = (path) => {
    setShowSideNav(false);
    navigate(path);
  };

  return (
    <aside className="sideNav" role="dialog" aria-modal="true" aria-label="Site navigation">
      <div className="sideNav-topline">
        <Link to="/" className="sideNav-wordmark" onClick={() => setShowSideNav(false)}>
          ESCOWEAR
        </Link>
        <button
          type="button"
          className="close"
          aria-label="Close navigation"
          onClick={() => setShowSideNav(false)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 4 16 16M20 4 4 20" />
          </svg>
        </button>
      </div>

      <nav className="links-wrapper" aria-label="Mobile navigation">
        {navigation.map((item, index) => (
          <Link to={item.to} onClick={() => setShowSideNav(false)} key={item.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>{item.label}
          </Link>
        ))}
      </nav>

      <div className="sideNav-footer">
        <p>Sneakers first.<br />Everything else second.</p>
        <Link to="/cart" onClick={() => setShowSideNav(false)}>Cart</Link>
        {user ? (
          <div className="sideNav-account">
            <button type="button" onClick={() => handleNav("/dashboard")}>
              {user.name.split(" ")[0]}'s account
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch(logoutUser());
                handleNav("/login");
              }}
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="sideNav-account">
            <Link to="/login" onClick={() => setShowSideNav(false)}>Login</Link>
            <Link to="/register" onClick={() => setShowSideNav(false)}>Register</Link>
          </div>
        )}
      </div>
    </aside>
  );
};

export default SideNav;
