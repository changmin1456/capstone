export type ThemeMode = "default" | "dark" | "light";

const THEME_KEY = "capston-theme";

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "default" || value === "dark" || value === "light";

export const getStoredTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(THEME_KEY);
  return isThemeMode(stored) ? stored : "default";
};

export const applyTheme = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage errors (private mode, etc.)
  }
};
