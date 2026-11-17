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
