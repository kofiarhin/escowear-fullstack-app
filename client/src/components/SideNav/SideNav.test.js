import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter } from "react-router-dom";
import reducers from "../../redux/reducers";
import SideNav from "./SideNav.component";

const renderMenu = (role) => {
  const store = createStore(reducers);
  const close = jest.fn();
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Test User", role, token: "test-token" } });
  render(<Provider store={store}><MemoryRouter><SideNav setShowSideNav={close} /></MemoryRouter></Provider>);
  return { close };
};
afterEach(() => localStorage.clear());

test("site menu exposes all admin destinations and closes on navigation", () => {
  const { close } = renderMenu("admin");
  const nav = screen.getByRole("navigation", { name: "Admin navigation" });
  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/admin", "/admin/orders", "/admin/products", "/admin/products/featured", "/admin/hero-slides"]);
  fireEvent.click(within(nav).getByRole("link", { name: "Admin overview" }));
  expect(close).toHaveBeenCalledWith(false);
});

test("customers do not see admin destinations in the site menu", () => {
  renderMenu("customer");
  expect(screen.queryByRole("navigation", { name: "Admin navigation" })).not.toBeInTheDocument();
});
