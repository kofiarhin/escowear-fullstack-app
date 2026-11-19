import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import reducers from "../../redux/reducers";
import SideNav, { MENU_EXIT_MS } from "./SideNav.component";

const renderMenu = (role) => {
  const store = createStore(reducers);
  const close = jest.fn();
  if (role) store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Test User", role, token: "test-token" } });
  const view = render(<Provider store={store}><MemoryRouter><SideNav setShowSideNav={close} /></MemoryRouter></Provider>);
  return { close, ...view };
};

const mockReducedMotion = (reduce) => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: no-preference)" ? !reduce : reduce,
    media: query,
  }));
};

afterEach(() => {
  localStorage.clear();
  delete window.matchMedia;
  document.body.style.overflow = "";
});

test("site menu exposes all admin destinations and closes on navigation", () => {
  const { close } = renderMenu("admin");
  const nav = screen.getByRole("navigation", { name: "Admin navigation" });
  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/admin", "/admin/orders", "/admin/products", "/admin/products/featured", "/admin/products/classics", "/admin/users", "/admin/hero-slides"]);
  fireEvent.click(within(nav).getByRole("link", { name: "Admin overview" }));
  expect(close).toHaveBeenCalledWith(false);
});

const GoBack = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Browser back</button>;
};

test("menu closes when the location changes without a menu link (e.g. browser back)", () => {
  const close = jest.fn();
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter initialEntries={["/store", "/cart"]} initialIndex={1}>
        <SideNav setShowSideNav={close} />
        <GoBack />
      </MemoryRouter>
    </Provider>
  );
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
  expect(close).toHaveBeenCalledWith(false);
});

test("customers do not see admin destinations in the site menu", () => {
  renderMenu("customer");
  expect(screen.queryByRole("navigation", { name: "Admin navigation" })).not.toBeInTheDocument();
});

test("the signed-in account button opens /account", () => {
  const store = createStore(reducers);
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Test User", role: "customer", token: "test-token" } });
  const Where = () => <p data-testid="path">{useLocation().pathname}</p>;
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/store"]}>
        <SideNav setShowSideNav={jest.fn()} />
        <Where />
      </MemoryRouter>
    </Provider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Test's account" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/account");
});

test("menu is a full-screen modal overlay, not a slide-in drawer", () => {
  renderMenu();
  const dialog = screen.getByRole("dialog", { name: "Site navigation" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("id", "mobile-menu");
  expect(dialog).toHaveClass("sideNav");
  expect(dialog).not.toHaveClass("is-closing");
  expect(within(dialog).getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Nike" })).toHaveAttribute("href", "/store?search=nike");
  expect(within(dialog).getByRole("link", { name: "Track order" })).toHaveAttribute("href", "/track-order");
});

test("opening locks page scroll and moves focus into the menu; closing restores both", () => {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  document.body.style.overflow = "auto";

  const { unmount } = renderMenu();
  expect(document.body.style.overflow).toBe("hidden");
  expect(screen.getByRole("button", { name: "Close navigation" })).toHaveFocus();

  unmount();
  expect(document.body.style.overflow).toBe("auto");
  expect(opener).toHaveFocus();
  opener.remove();
});

test("Escape and the close button close the menu", () => {
  const { close } = renderMenu();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledWith(false);
  close.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
  expect(close).toHaveBeenCalledWith(false);
});

test("focus is trapped inside the open menu", () => {
  renderMenu();
  const dialog = screen.getByRole("dialog", { name: "Site navigation" });
  const first = within(dialog).getByRole("link", { name: "ESCOWEAR" });
  const last = within(dialog).getByRole("link", { name: "Register" });

  last.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(first).toHaveFocus();

  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
});

test("with motion allowed the overlay fades and scales out before unmounting", () => {
  jest.useFakeTimers();
  try {
    mockReducedMotion(false);
    const { close } = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toHaveClass("is-closing");
    expect(close).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(MENU_EXIT_MS));
    expect(close).toHaveBeenCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});

test("with reduced motion the overlay closes instantly", () => {
  mockReducedMotion(true);
  const { close } = renderMenu();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledWith(false);
});

test("mobile menu links to the wishlist with the saved count", () => {
  localStorage.setItem("escowear-wishlist-v1", JSON.stringify(["p1", "p2"]));
  renderMenu();
  expect(screen.getByRole("link", { name: "Wishlist (2)" })).toHaveAttribute("href", "/wishlist");
});
