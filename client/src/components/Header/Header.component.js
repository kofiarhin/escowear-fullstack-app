import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./header.styles.css";
import Search from "../Search/Search.component";
import ThemeToggle from "../ThemeToggle/ThemeToggle.component";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";

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

const Header = ({ setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [showSearch, setShowSearch] = useState(false);
  const headerRef = useRef(null);
  const searchPanelRef = useRef(null);
  usePublishedHeaderHeight(headerRef, searchPanelRef);

  return (
    <header className="main-header" ref={headerRef}>
      <div className="announcement">
        <span>Escowear / Premium sneaker store</span>
        <span className="announcement-edition">Icons / Releases / Rotation</span>
      </div>

      <div className="header-shell container">
        <Link to="/" className="wordmark" aria-label="Escowear home">
          ESCOWEAR
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <Link to="/">Home</Link>
          <Link to="/store">Shop</Link>
          <Link to="/#latest-releases">New Releases</Link>
          <Link to="/#collections">Collections</Link>
          <Link to="/#about">About</Link>
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="icon-action search-toggle"
            aria-label={showSearch ? "Close search" : "Open search"}
            aria-expanded={showSearch}
            onClick={() => setShowSearch((isOpen) => !isOpen)}
          >
            <SearchIcon />
            <span>Search</span>
          </button>

          {user ? (
            <div className={`account-actions ${user.role === "admin" ? "is-admin" : ""}`}>
              {user.role === "admin" && (
                <Link to="/admin" className="icon-action admin-link">Admin</Link>
              )}
              <Link to="/dashboard" className="icon-action account-profile" aria-label="Your account">
                <AccountIcon />
                <span>{user.name.split(" ")[0]}</span>
              </Link>
              <button type="button" onClick={() => dispatch(logoutUser())}>
                Logout
              </button>
            </div>
          ) : (
            <Link to="/login" className="icon-action account-link" aria-label="Account">
              <AccountIcon />
              <span>Account</span>
            </Link>
          )}

          <Link to="/cart" className="icon-action cart-link" aria-label="Shopping cart">
            <CartIcon />
            <span>Cart</span>
          </Link>

          <ThemeToggle className="header-theme-toggle" />

          <button
            type="button"
            className="menu"
            aria-label="Open navigation"
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
