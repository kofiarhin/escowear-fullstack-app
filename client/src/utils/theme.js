// Light/dark theme state. public/index.html applies the stored theme before
// first paint with the same key and values; keep the two in sync.
export const THEME_STORAGE_KEY = "escowear-theme";
export const THEME_CHANGE_EVENT = "escowear-themechange";
export const DEFAULT_THEME = "light";

const THEME_COLORS = { light: "#f1f1ef", dark: "#0e0e0e" };

export const normalizeTheme = (value) => (value === "dark" || value === "light" ? value : DEFAULT_THEME);

export const getStoredTheme = () => {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
};

export const applyTheme = (value) => {
  const theme = normalizeTheme(value);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  return theme;
};

export const setTheme = (value) => {
  const theme = applyTheme(value);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this page view when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  return theme;
};

export const toggleTheme = (current) => setTheme(normalizeTheme(current) === "dark" ? "light" : "dark");
