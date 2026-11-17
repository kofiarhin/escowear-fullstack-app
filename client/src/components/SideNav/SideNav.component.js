import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./sideNav.styles.css";
import { logoutUser } from "../../redux/actions/user.action";
import { ADMIN_SECTIONS } from "../AdminLayout/AdminLayout.component";
import ThemeToggle from "../ThemeToggle/ThemeToggle.component";
import { BRAND_LINKS, MOBILE_MENU_ID, PRIMARY_NAV } from "../Header/navigation";

// Matches the nav-exit animation in sideNav.styles.css.
export const MENU_EXIT_MS = 180;

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

const allowsMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

// Full-screen mobile menu overlay: fades and scales in (fade only with reduced
// motion), traps focus, locks page scroll, and closes on Escape or navigation.
const SideNav = ({ setShowSideNav }) => {
  const { user } = useSelector((state) => state.userReducer);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const openedAt = useRef(location);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    if (allowsMotion()) setClosing(true);
    else setShowSideNav(false);
  }, [setShowSideNav]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setShowSideNav(false), MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing, setShowSideNav]);

  useEffect(() => {
    if (location !== openedAt.current) close();
  }, [location, close]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [close]);

  const handleNav = (path) => {
    close();
    navigate(path);
  };

  return (
    <div
      className={`sideNav ${closing ? "is-closing" : ""}`.trim()}
      id={MOBILE_MENU_ID}
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
      ref={dialogRef}
    >
      <div className="sideNav-topline">
        <Link to="/" className="sideNav-wordmark" onClick={close}>
          ESCOWEAR
        </Link>
        <div className="sideNav-topline-actions">
          <ThemeToggle />
          <button
            type="button"
            className="close"
            aria-label="Close navigation"
            onClick={close}
            ref={closeButtonRef}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 4 16 16M20 4 4 20" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sideNav-body">
        <nav className="links-wrapper" aria-label="Mobile navigation">
          {PRIMARY_NAV.map((item, index) => (
            <Link to={item.to} onClick={close} key={item.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>{item.label}
            </Link>
          ))}
        </nav>

        <nav className="sideNav-brands" aria-label="Shop by brand">
          {BRAND_LINKS.map((link) => (
            <Link key={link.label} to={link.to} onClick={close}>{link.label}</Link>
          ))}
        </nav>
      </div>

      {user?.role === "admin" && (
        <nav className="sideNav-admin" aria-label="Admin navigation">
          {ADMIN_SECTIONS.map((section) => (
            <Link key={section.id} to={section.to} onClick={close}>
              {section.label === "Overview" ? "Admin overview" : section.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="sideNav-footer">
        <p>Sneakers first.<br />Everything else second.</p>
        <div className="sideNav-account">
          <Link to="/cart" onClick={close}>Cart</Link>
          <Link to="/track-order" onClick={close}>Track order</Link>
          {user ? (
            <>
              <button type="button" onClick={() => handleNav("/account")}>
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
            </>
          ) : (
            <>
              <Link to="/login" onClick={close}>Login</Link>
              <Link to="/register" onClick={close}>Register</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SideNav;
