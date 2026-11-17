import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter } from "react-router-dom";
import reducers from "../../redux/reducers";
import Header from "./Header.component";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
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
