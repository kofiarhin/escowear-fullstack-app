import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PRIMARY_NAV } from "./navigation";

// A short open delay stops panels flashing while the pointer sweeps across
// the bar; the close delay lets it travel from a trigger down into its panel.
export const MEGA_OPEN_DELAY = 120;
export const MEGA_CLOSE_DELAY = 220;

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const panelId = (id) => `mega-panel-${id}`;
const triggerId = (id) => `mega-trigger-${id}`;

const focusFrom = (items, current, step) => {
  const index = items.indexOf(current);
  items[(index + step + items.length) % items.length]?.focus();
};

// Desktop primary navigation: a disclosure-style mega-menu that opens on
// hover (with delays) or from the keyboard, closes on Escape, outside click,
// focus leaving the item, or navigation.
const MegaNav = () => {
  const [openId, setOpenId] = useState(null);
  const navRef = useRef(null);
  const timer = useRef(undefined);
  const openedByHover = useRef(false);
  const focusFirstLink = useRef(false);
  const location = useLocation();

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    openedByHover.current = false;
    setOpenId(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    close();
  }, [location, close]);

  // Listening on the document lets Escape dismiss a hover-opened panel even
  // when focus is elsewhere on the page (WCAG 1.4.13).
  useEffect(() => {
    if (!openId) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!navRef.current?.contains(event.target)) close();
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      const nav = navRef.current;
      const focusWasInside = nav?.contains(document.activeElement);
      close();
      if (focusWasInside) {
        event.preventDefault();
        nav.querySelector(`#${triggerId(openId)}`)?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openId, close]);

  useEffect(() => {
    if (!openId || !focusFirstLink.current) return;
    focusFirstLink.current = false;
    navRef.current?.querySelector(`#${panelId(openId)} a`)?.focus();
  }, [openId]);

  const scheduleOpen = (id) => {
    window.clearTimeout(timer.current);
    if (openId === id) return;
    const open = () => {
      openedByHover.current = true;
      setOpenId(id);
    };
    // Moving between triggers while a panel is showing switches instantly.
    if (openId) open();
    else timer.current = window.setTimeout(open, MEGA_OPEN_DELAY);
  };

  const scheduleClose = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(close, MEGA_CLOSE_DELAY);
  };

  const handleTriggerClick = (event, id) => {
    window.clearTimeout(timer.current);
    // A pointer click on a panel the pointer just opened keeps it open rather
    // than immediately toggling it shut.
    if (openId === id && openedByHover.current && event.detail > 0) {
      openedByHover.current = false;
      return;
    }
    openedByHover.current = false;
    setOpenId(openId === id ? null : id);
  };

  const openFromKeyboard = (id) => {
    window.clearTimeout(timer.current);
    openedByHover.current = false;
    if (openId === id) {
      navRef.current?.querySelector(`#${panelId(id)} a`)?.focus();
      return;
    }
    focusFirstLink.current = true;
    setOpenId(id);
  };

  const handleKeyDown = (event) => {
    const target = event.target;
    const topLevel = [...navRef.current.querySelectorAll("[data-nav-top]")];
    const panel = target.closest("[data-mega-panel]");

    if (topLevel.includes(target)) {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        focusFrom(topLevel, target, event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "ArrowDown" && target.dataset.menu) {
        event.preventDefault();
        openFromKeyboard(target.dataset.menu);
      }
      return;
    }

    if (panel && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      focusFrom([...panel.querySelectorAll("a")], target, event.key === "ArrowDown" ? 1 : -1);
    }
  };

  return (
    <nav className="desktop-nav" aria-label="Primary navigation" ref={navRef}>
      <ul className="desktop-nav-list" onKeyDown={handleKeyDown}>
        {PRIMARY_NAV.map((item) => {
          if (!item.groups) {
            return (
              <li className="desktop-nav-item" key={item.id}>
                <Link to={item.to} className="desktop-nav-link" data-nav-top="">
                  {item.label}
                </Link>
              </li>
            );
          }

          const isOpen = openId === item.id;
          return (
            <li
              className={`desktop-nav-item ${isOpen ? "is-open" : ""}`.trim()}
              key={item.id}
              onMouseEnter={() => scheduleOpen(item.id)}
              onMouseLeave={(event) => {
                // Never hide a panel that keyboard focus is inside.
                const panel = event.currentTarget.querySelector("[data-mega-panel]");
                if (panel?.contains(document.activeElement)) return;
                scheduleClose();
              }}
              onBlur={(event) => {
                if (isOpen && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
              }}
            >
              <button
                type="button"
                id={triggerId(item.id)}
                className="desktop-nav-link"
                data-nav-top=""
                data-menu={item.id}
                aria-expanded={isOpen}
                aria-controls={panelId(item.id)}
                aria-haspopup="true"
                onClick={(event) => handleTriggerClick(event, item.id)}
              >
                {item.label}
                <ChevronIcon />
              </button>

              <div
                id={panelId(item.id)}
                className="mega-panel"
                role="group"
                aria-labelledby={triggerId(item.id)}
                data-mega-panel=""
                hidden={!isOpen}
              >
                <div className="mega-panel-inner container">
                  {item.groups.map((group) => {
                    const headingId = `${panelId(item.id)}-${group.title.toLowerCase().replace(/\W+/g, "-")}`;
                    return (
                      <div className="mega-group" key={group.title}>
                        <p className="mega-group-title" id={headingId}>{group.title}</p>
                        <ul aria-labelledby={headingId}>
                          {group.links.map((link) => (
                            <li key={link.label}>
                              <Link to={link.to} onClick={close}>{link.label}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MegaNav;
