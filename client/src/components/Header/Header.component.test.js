import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter } from "react-router-dom";
import reducers from "../../redux/reducers";
import Header from "./Header.component";
import { MEGA_CLOSE_DELAY, MEGA_OPEN_DELAY } from "./MegaNav.component";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

const renderHeader = (props = {}) => {
  const setShowSideNav = jest.fn();
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter>
        <Header setShowSideNav={setShowSideNav} {...props} />
      </MemoryRouter>
    </Provider>
  );
  return { setShowSideNav };
};

const primaryNav = () => screen.getByRole("navigation", { name: "Primary navigation" });

test("logo, primary links and icon controls are exposed to assistive technology", () => {
  renderHeader();
  const header = screen.getByRole("banner");
  // getByRole skips anything inside an aria-hidden subtree, so finding each
  // control by role and name proves it is exposed to assistive technology.
  const exposed = [
    screen.getByRole("link", { name: "Escowear home" }),
    screen.getByRole("button", { name: "Shop" }),
    screen.getByRole("button", { name: "Brands" }),
    screen.getByRole("link", { name: "New Releases" }),
    screen.getByRole("link", { name: "About" }),
    screen.getByRole("button", { name: "Open search" }),
    screen.getByRole("link", { name: "Account" }),
    screen.getByRole("link", { name: "Shopping cart" }),
    screen.getByRole("button", { name: "Open navigation" }),
  ];
  for (const element of exposed) expect(header).toContainElement(element);
  expect(screen.getByRole("link", { name: "Escowear home" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "Shopping cart" })).toHaveAttribute("href", "/cart");
});

test("slim utility bar links only to existing destinations", () => {
  renderHeader();
  const utility = screen.getByRole("navigation", { name: "Help and account" });
  expect(within(utility).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/track-order", "/register", "/login"]);
});

test("theme toggle sits in the header bar itself, not only inside the mobile menu", () => {
  renderHeader();
  // The mobile menu is closed, so the only toggle on the page is the header's.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const toggle = within(screen.getByRole("banner")).getByRole("button", { name: "Switch to dark theme" });
  expect(toggle).toHaveClass("header-theme-toggle", "icon-action");
});

test("menu toggle reflects the overlay state with aria-expanded and aria-controls", () => {
  const { setShowSideNav } = renderHeader();
  const toggle = screen.getByRole("button", { name: "Open navigation" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAttribute("aria-controls", "mobile-menu");
  fireEvent.click(toggle);
  expect(setShowSideNav).toHaveBeenCalledWith(true);
});

test("menu toggle reports expanded while the overlay is open", () => {
  renderHeader({ showSideNav: true });
  expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "true");
});

test("mega-menu trigger opens from the keyboard, moves focus into the panel and closes on Escape", () => {
  renderHeader();
  const trigger = within(primaryNav()).getByRole("button", { name: "Shop" });
  expect(trigger).toHaveAttribute("aria-haspopup", "true");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group", { name: "Shop" })).not.toBeInTheDocument();

  // Enter/Space activate the focused native button.
  trigger.focus();
  fireEvent.click(trigger, { detail: 0 });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = screen.getByRole("group", { name: "Shop" });
  expect(trigger).toHaveAttribute("aria-controls", panel.id);
  expect(within(panel).getByRole("link", { name: "All sneakers" })).toHaveAttribute("href", "/store?category=shoes");
  expect(within(panel).getByRole("list", { name: "Classic silhouettes" })).toBeInTheDocument();

  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const firstLink = within(panel).getByRole("link", { name: "All sneakers" });
  expect(firstLink).toHaveFocus();
  fireEvent.keyDown(firstLink, { key: "ArrowDown" });
  const secondLink = within(panel).getByRole("link", { name: "New releases" });
  expect(secondLink).toHaveFocus();
  fireEvent.keyDown(secondLink, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

test("arrow keys move between top-level items", () => {
  renderHeader();
  const shop = screen.getByRole("button", { name: "Shop" });
  shop.focus();
  fireEvent.keyDown(shop, { key: "ArrowRight" });
  const brands = screen.getByRole("button", { name: "Brands" });
  expect(brands).toHaveFocus();
  fireEvent.keyDown(brands, { key: "ArrowLeft" });
  expect(shop).toHaveFocus();
  fireEvent.keyDown(shop, { key: "ArrowLeft" });
  expect(screen.getByRole("link", { name: "About" })).toHaveFocus();
});

test("mega-menu opens on hover after a short delay, stays open on click and closes after leaving", () => {
  jest.useFakeTimers();
  try {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Brands" });
    // React derives the list item's mouseenter/leave from events on its trigger.
    const hoverTarget = trigger;

    fireEvent.mouseEnter(hoverTarget);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    act(() => jest.advanceTimersByTime(MEGA_OPEN_DELAY));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("group", { name: "Brands" })).getByRole("link", { name: "Nike" })).toHaveAttribute("href", "/store?search=nike");

    // A pointer click on a hover-opened panel does not toggle it shut.
    fireEvent.click(trigger, { detail: 1 });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger, { detail: 1 });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.mouseEnter(hoverTarget);
    act(() => jest.advanceTimersByTime(MEGA_OPEN_DELAY));
    fireEvent.mouseLeave(hoverTarget);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    act(() => jest.advanceTimersByTime(MEGA_CLOSE_DELAY));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  } finally {
    jest.useRealTimers();
  }
});

test("Escape dismisses a hover-opened panel even when focus is elsewhere", () => {
  jest.useFakeTimers();
  try {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Shop" });
    fireEvent.mouseEnter(trigger);
    act(() => jest.advanceTimersByTime(MEGA_OPEN_DELAY));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  } finally {
    jest.useRealTimers();
  }
});

test("a hover-opened panel stays open while keyboard focus is inside it", () => {
  jest.useFakeTimers();
  try {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Shop" });
    fireEvent.mouseEnter(trigger);
    act(() => jest.advanceTimersByTime(MEGA_OPEN_DELAY));
    within(screen.getByRole("group", { name: "Shop" })).getByRole("link", { name: "All sneakers" }).focus();
    fireEvent.mouseLeave(trigger);
    act(() => jest.advanceTimersByTime(MEGA_CLOSE_DELAY));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  } finally {
    jest.useRealTimers();
  }
});

test("only one mega-menu is open at a time and outside clicks close it", () => {
  renderHeader();
  const shop = screen.getByRole("button", { name: "Shop" });
  const brands = screen.getByRole("button", { name: "Brands" });
  fireEvent.click(shop);
  fireEvent.click(brands);
  expect(shop).toHaveAttribute("aria-expanded", "false");
  expect(brands).toHaveAttribute("aria-expanded", "true");
  fireEvent.mouseDown(document.body);
  expect(brands).toHaveAttribute("aria-expanded", "false");
});

test("header renders the theme toggle and switches theme", () => {
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter>
        <Header setShowSideNav={jest.fn()} />
      </MemoryRouter>
    </Provider>
  );

  const toggle = screen.getByRole("button", { name: "Switch to dark theme" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(toggle).toHaveClass("theme-toggle", "header-theme-toggle");

  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

test("header publishes its height, excluding the search panel, for full-height sections", () => {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measure() {
    if (this.classList.contains("main-header")) return { height: 95 };
    return { height: this.classList.contains("search-panel") && !this.hidden ? 80 : 0 };
  });
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter>
        <Header setShowSideNav={jest.fn()} />
      </MemoryRouter>
    </Provider>
  );

  expect(document.documentElement.style.getPropertyValue("--site-header-h")).toBe("95px");
  jest.restoreAllMocks();
  document.documentElement.style.removeProperty("--site-header-h");
});

test("admins see one compact Admin link instead of individual admin sections", () => {
  const store = createStore(reducers);
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><MemoryRouter><Header setShowSideNav={jest.fn()} /></MemoryRouter></Provider>);
  expect(screen.getAllByRole("link", { name: "Admin" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  for (const name of ["Admin orders", "Manage products", "Manage hero slides"]) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
});

test.each([null, "customer"])("%s visitors do not see admin links", (role) => {
  const store = createStore(reducers);
  store.dispatch(role ? { type: "LOGIN_SUCCESS", payload: { name: "Customer", role, token: "test-token" } } : { type: "LOGOUT_USER" });
  render(<Provider store={store}><MemoryRouter><Header setShowSideNav={jest.fn()} /></MemoryRouter></Provider>);
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: role ? "Your account" : "Account" })).toHaveAttribute("href", role ? "/dashboard" : "/login");
});
