import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import "./adminLayout.styles.css";

const Icon = ({ children }) => (
  <svg className="admin-nav__icon" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const ADMIN_SECTIONS = [
  { id: "overview", to: "/admin", label: "Overview", icon: <Icon><path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></Icon> },
  { id: "orders", to: "/admin/orders", label: "Orders", icon: <Icon><path d="M5 4h14v16H5zM8.5 9h7M8.5 13h7M8.5 17h4" /></Icon> },
  { id: "products", to: "/admin/products", label: "Products", icon: <Icon><path d="M3 15c3 0 5-2 7-5l3 3c2 1 5 1 8 1v3H3z" /></Icon> },
  { id: "featured", to: "/admin/products/featured", label: "Featured sneakers", icon: <Icon><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></Icon> },
  { id: "hero", to: "/admin/hero-slides", label: "Hero slides", icon: <Icon><path d="M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 4" /></Icon> },
];

// /admin/products/featured sits under /admin/products, so match the most
// specific section first instead of relying on prefix matching.
export const sectionFor = (pathname) => {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "overview";
  if (path.startsWith("/admin/products/featured")) return "featured";
  const match = ADMIN_SECTIONS.find((section) => section.id !== "overview" && path.startsWith(section.to));
  return match ? match.id : null;
};

const prefersReducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MENU_EXIT_MS = 160;

const AdminNav = ({ current, label, onNavigate }) => (
  <nav className="admin-nav" aria-label={label}>
    <ul>
      {ADMIN_SECTIONS.map((section) => (
        <li key={section.id}>
          <NavLink end={section.id === "overview"} to={section.to} className="admin-nav__link" aria-current={current === section.id ? "page" : false} onClick={onNavigate}>
            {section.icon}
            <span>{section.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);

// Fade-and-scale overlay menu for tablet and mobile. It stays mounted (hidden)
// so the Menu button's aria-controls always points at a real element.
const useAdminMenu = () => {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const location = useLocation();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) {
      setVisible(true);
      return undefined;
    }
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), prefersReducedMotion() ? 0 : MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  // Any navigation, including the browser back button, closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open || !visible) return undefined;
    const button = buttonRef.current;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector(FOCUSABLE)?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to the trigger unless navigation already moved it elsewhere.
      if (!document.activeElement || document.activeElement === document.body || panel?.contains(document.activeElement)) button?.focus();
    };
  }, [open, visible]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 1024) close(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [close]);

  return { open, visible, close, toggle: () => setOpen((value) => !value), buttonRef, panelRef };
};

const AdminLayout = ({ eyebrow = "Admin", title, description, actions, children, className = "" }) => {
  const { pathname } = useLocation();
  const current = sectionFor(pathname);
  const currentLabel = ADMIN_SECTIONS.find((section) => section.id === current)?.label || "Admin";
  const menu = useAdminMenu();

  return (
    <div className="admin-layout">
      <div className="admin-topbar">
        <div className="admin-topbar__inner container">
          <p className="admin-topbar__section">
            <span className="admin-topbar__label">Admin</span>
            <span>{currentLabel}</span>
          </p>
          <button
            type="button"
            ref={menu.buttonRef}
            className="admin-button admin-topbar__menu"
            aria-expanded={menu.open}
            aria-controls="admin-menu"
            onClick={menu.toggle}
          >
            Menu
          </button>
        </div>
      </div>

      <div
        id="admin-menu"
        ref={menu.panelRef}
        className={`admin-menu ${menu.open ? "is-open" : "is-closing"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Admin menu"
        hidden={!menu.visible}
        aria-hidden={!menu.open}
        {...(!menu.open ? { inert: "" } : {})}
      >
        <div className="admin-menu__inner container">
          <div className="admin-menu__top">
            <p className="admin-eyebrow">EscoWear admin</p>
            <button type="button" className="admin-button" onClick={menu.close}>
              Close
            </button>
          </div>
          <AdminNav current={current} label="Admin sections" onNavigate={menu.close} />
          <Link to="/" className="admin-button admin-menu__store" onClick={menu.close}>
            View store
          </Link>
        </div>
      </div>

      <div className="admin-shell container">
        <aside className="admin-sidebar" aria-label="Admin navigation">
          <p className="admin-sidebar__brand">EscoWear admin</p>
          <AdminNav current={current} label="Admin sections" />
          <Link to="/" className="admin-sidebar__store">
            View store
          </Link>
        </aside>

        <main className={`admin admin-main ${className}`.trim()} id="admin-main">
          {title && (
            <header className="admin-page-header">
              <div className="admin-page-header__text">
                {eyebrow && <p className="admin-eyebrow">{eyebrow}</p>}
                <h1 className="title">{title}</h1>
                {description && <div className="admin-page-header__description">{description}</div>}
              </div>
              {actions && <div className="admin-page-header__actions">{actions}</div>}
            </header>
          )}
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
