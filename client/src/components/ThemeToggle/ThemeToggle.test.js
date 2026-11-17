import { act, render, screen, fireEvent } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle.component";
import { THEME_STORAGE_KEY, getStoredTheme, setTheme } from "../../utils/theme";

const root = document.documentElement;
let themeColorMeta;

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute("data-theme");
  root.style.colorScheme = "";
  themeColorMeta = document.createElement("meta");
  themeColorMeta.setAttribute("name", "theme-color");
  themeColorMeta.setAttribute("content", "#f1f1ef");
  document.head.replaceChildren(themeColorMeta);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("defaults to the light theme when nothing is stored", () => {
  render(<ThemeToggle />);
  const toggle = screen.getByRole("button", { name: "Switch to dark theme" });
  expect(toggle).toHaveAttribute("type", "button");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(root).toHaveAttribute("data-theme", "light");
  expect(root.style.colorScheme).toBe("light");
});

test("toggling switches data-theme, storage, meta colour and button state", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));

  const toggle = screen.getByRole("button", { name: "Switch to light theme" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(root).toHaveAttribute("data-theme", "dark");
  expect(root.style.colorScheme).toBe("dark");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(themeColorMeta).toHaveAttribute("content", "#0e0e0e");

  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Switch to dark theme" })).toHaveAttribute("aria-pressed", "false");
  expect(root).toHaveAttribute("data-theme", "light");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  expect(themeColorMeta).toHaveAttribute("content", "#f1f1ef");
});

test("restores a stored dark theme on mount", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute("aria-pressed", "true");
  expect(root).toHaveAttribute("data-theme", "dark");
});

test("falls back to light for an invalid stored value", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "sepia");
  expect(getStoredTheme()).toBe("light");
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Switch to dark theme" })).toHaveAttribute("aria-pressed", "false");
  expect(root).toHaveAttribute("data-theme", "light");
});

test("keeps working when localStorage throws", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });

  render(<ThemeToggle />);
  expect(root).toHaveAttribute("data-theme", "light");
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(root).toHaveAttribute("data-theme", "dark");
  expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute("aria-pressed", "true");
});

test("separate toggles stay in sync", () => {
  render(
    <>
      <ThemeToggle className="first" />
      <ThemeToggle className="second" />
    </>
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Switch to dark theme" })[0]);
  expect(screen.getAllByRole("button", { name: "Switch to light theme" })).toHaveLength(2);

  act(() => {
    setTheme("light");
  });
  expect(screen.getAllByRole("button", { name: "Switch to dark theme" })).toHaveLength(2);
});
