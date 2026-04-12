export const THEME_STORAGE_KEY = 'mbos.theme';

export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.includes(value as Theme);
}

export function sanitizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function resolveSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolvePreferredTheme(storedTheme: unknown): Theme {
  if (isTheme(storedTheme)) {
    return storedTheme;
  }
  return resolveSystemTheme();
}

export function getThemeBootstrapScript(): string {
  return `
(() => {
  const storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
  const fallback = ${JSON.stringify(DEFAULT_THEME)};
  const root = document.documentElement;
  const resolveSystemTheme = () => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return fallback;
    }
  };
  try {
    const stored = window.localStorage.getItem(storageKey);
    const theme = stored === 'dark' || stored === 'light' ? stored : resolveSystemTheme();
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch {
    const theme = resolveSystemTheme();
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }
})();
  `.trim();
}
