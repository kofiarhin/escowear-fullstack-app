import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./header.styles.css";
import Search from "../Search/Search.component";
import ThemeToggle from "../ThemeToggle/ThemeToggle.component";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { policiesVisible } from "../../policies/content";
import MegaNav from "./MegaNav.component";
import { MOBILE_MENU_ID } from "./navigation";

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.25 4.25" />
  </svg>
);

const CartIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5h2l2 10h9l2-7H7" />
    <circle cx="10" cy="19" r="1" />
    <circle cx="17" cy="19" r="1" />
  </svg>
);

const AccountIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7h18M3 17h18" />
  </svg>
);

// Publishes the sticky header's height as --site-header-h so full-viewport
// sections (the mobile hero) fit exactly below it. The toggled search panel is
// excluded so opening search does not resize the page underneath.
const usePublishedHeaderHeight = (headerRef, searchPanelRef) => {
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const root = document.documentElement;
    const publish = () => {
      const height = header.getBoundingClientRect().height - (searchPanelRef.current?.getBoundingClientRect().height || 0);
      if (height > 0) root.style.setProperty("--site-header-h", `${height}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => window.removeEventListener("resize", publish);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, [headerRef, searchPanelRef]);
};

const Header = ({ showSideNav = false, setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [showSearch, setShowSearch] = useState(false);
  const headerRef = useRef(null);
  const searchPanelRef = useRef(null);
  usePublishedHeaderHeight(headerRef, searchPanelRef);
  const isAdmin = user?.role === "admin";

  return (
    <header className="main-header" ref={headerRef}>
      <div className="utility-bar">
        <div className="utility-bar-inner container">
          <p className="utility-note">Authentic UK sneakers, delivered to Ghana</p>
          <nav className="utility-links" aria-label="Help and account">
            <Link to="/track-order">Track order</Link>
            {policiesVisible() && <Link to="/policies">Shop policies</Link>}
            {user ? (
              <>
                <Link to="/dashboard">Hi, {user.name.split(" ")[0]}</Link>
                <button type="button" onClick={() => dispatch(logoutUser())}>Logout</button>
              </>
            ) : (
              <>
                <Link to="/register">Register</Link>
                <Link to="/login">Login</Link>
              </>
            )}
          </nav>
        </div>
      </div>

      <div className="header-shell container">
        <Link to="/" className="wordmark" aria-label="Escowear home">
          ESCOWEAR
        </Link>

        <MegaNav />

        <div className={`header-actions ${isAdmin ? "is-admin" : ""}`.trim()}>
          <button
            type="button"
            className="icon-action search-toggle"
            aria-label={showSearch ? "Close search" : "Open search"}
            aria-expanded={showSearch}
            onClick={() => setShowSearch((isOpen) => !isOpen)}
          >
            <SearchIcon />
            <span className="search-toggle-label">Search</span>
          </button>

          {isAdmin && <Link to="/admin" className="icon-action admin-link">Admin</Link>}

          <Link
            to={user ? "/dashboard" : "/login"}
            className="icon-action account-link"
            aria-label={user ? "Your account" : "Account"}
          >
            <AccountIcon />
          </Link>

          <Link to="/cart" className="icon-action cart-link" aria-label="Shopping cart">
            <CartIcon />
          </Link>

          <ThemeToggle className="icon-action header-theme-toggle" />

          <button
            type="button"
            className="icon-action menu"
            aria-label="Open navigation"
            aria-expanded={showSideNav}
            aria-controls={MOBILE_MENU_ID}
            onClick={() => setShowSideNav(true)}
          >
            <MenuIcon />
          </button>
        </div>
      </div>

      <div className={`search-panel ${showSearch ? "is-open" : ""}`} hidden={!showSearch} ref={searchPanelRef}>
        <div className="container">
          <Search onSearchComplete={() => setShowSearch(false)} />
        </div>
      </div>
    </header>
  );
};

export default Header;
