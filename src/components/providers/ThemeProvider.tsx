'use client';

import * as React from 'react';
import {
  DEFAULT_THEME,
  resolvePreferredTheme,
  resolveSystemTheme,
  sanitizeTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '@/lib/theme';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  mounted: boolean;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage write failures.
  }
}

function readStoredTheme(): Theme | null {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === null ? null : sanitizeTheme(storedTheme);
  } catch {
    return null;
  }
}

function readThemeFromDom(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return sanitizeTheme(document.documentElement.getAttribute('data-theme'));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);
  const [mounted, setMounted] = React.useState(false);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    persistTheme(nextTheme);
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme((theme === 'light' ? 'dark' : 'light'));
  }, [setTheme, theme]);

  React.useEffect(() => {
    const storedTheme = readStoredTheme();
    const initialTheme = storedTheme ?? readThemeFromDom();
    applyTheme(initialTheme);
    setThemeState(initialTheme);
    setMounted(true);
  }, []);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = () => {
      if (readStoredTheme() !== null) return;
      const nextTheme = resolveSystemTheme();
      applyTheme(nextTheme);
      setThemeState(nextTheme);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = event.newValue === null ? resolvePreferredTheme(null) : sanitizeTheme(event.newValue);
      applyTheme(nextTheme);
      setThemeState(nextTheme);
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    window.addEventListener('storage', onStorage);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme, mounted }),
    [mounted, setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
