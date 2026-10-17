import { useState } from "react";
import { Link } from "react-router-dom";
import "./header.styles.css";
import Search from "../Search/Search.component";
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

const Header = ({ setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [showSearch, setShowSearch] = useState(false);

  return (
    <header className="main-header">
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
            <div className="account-actions">
              <Link to="/dashboard" className="icon-action">
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

      <div className={`search-panel ${showSearch ? "is-open" : ""}`} hidden={!showSearch}>
        <div className="container">
          <Search onSearchComplete={() => setShowSearch(false)} />
        </div>
      </div>
    </header>
  );
};

export default Header;
