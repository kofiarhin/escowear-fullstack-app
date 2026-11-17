import { useCallback, useEffect, useState } from "react";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  normalizeTheme,
  toggleTheme as toggleStoredTheme,
} from "../../utils/theme";

// Shared by every ThemeToggle instance (header and side nav) so they stay in sync.
const useTheme = () => {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncFromEvent = (event) => setThemeState(normalizeTheme(event.detail));
    const syncFromStorage = (event) => {
      if (event.key === THEME_STORAGE_KEY) setThemeState(normalizeTheme(event.newValue));
    };

    window.addEventListener(THEME_CHANGE_EVENT, syncFromEvent);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncFromEvent);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(toggleStoredTheme(theme));
  }, [theme]);

  return { theme, toggleTheme };
};

export default useTheme;
