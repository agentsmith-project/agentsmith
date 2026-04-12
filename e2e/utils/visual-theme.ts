import { type Page } from '@playwright/test';

import type { Theme } from '@/lib/theme';

export const VISUAL_THEMES = ['light', 'dark'] as const satisfies readonly Theme[];
export type VisualTheme = (typeof VISUAL_THEMES)[number];

const THEME_STORAGE_KEY = 'mbos.theme';

type ThemeBootstrapPayload = {
  storageKey: string;
  nextTheme: VisualTheme;
};

function applyThemeSnapshot({ storageKey, nextTheme }: ThemeBootstrapPayload) {
  const root = document.documentElement;
  try {
    window.localStorage.setItem(storageKey, nextTheme);
  } catch {
    // Ignore storage failures in the visual harness.
  }
  root.setAttribute('data-theme', nextTheme);
  root.style.colorScheme = nextTheme;
}

export async function setVisualTheme(page: Page, theme: VisualTheme) {
  const payload: ThemeBootstrapPayload = {
    storageKey: THEME_STORAGE_KEY,
    nextTheme: theme,
  };

  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(applyThemeSnapshot, payload);
  await page.evaluate(applyThemeSnapshot, payload).catch(() => {});
}

export function themedScreenshotName(baseName: string, theme: VisualTheme) {
  return `${baseName}-${theme}.png`;
}
