import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { PublicThemeToggle } from '../PublicThemeToggle';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('PublicThemeToggle', () => {
  it('does not claim light is active before the theme provider mounts on a dark bootstrap theme', () => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';

    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ThemeProvider>
        <PublicThemeToggle />
      </ThemeProvider>,
    );

    expect(within(container).getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'false');
    expect(within(container).getByTestId('public-theme-toggle__dark')).toHaveAttribute('aria-pressed', 'false');
  });

  it('activates the dark theme after hydrating a dark bootstrap theme with no stored preference', async () => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';

    render(
      <ThemeProvider>
        <PublicThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('public-theme-toggle__dark')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('mbos.theme')).toBeNull();
  });

  it('switches between light and dark themes', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';

    render(
      <ThemeProvider>
        <PublicThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByTestId('public-theme-toggle__dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('public-theme-toggle__dark')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('public-theme-toggle__light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the shell quiet instead of using floating chrome', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';

    render(
      <ThemeProvider>
        <PublicThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'true'));

    const shell = screen.getByTestId('public-theme-toggle');
    expect(shell.className).not.toMatch(/shadow-|backdrop-blur/);
  });

  it('keeps the light and dark options in a stable order', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';

    render(
      <ThemeProvider>
        <PublicThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('public-theme-toggle__light')).toHaveAttribute('aria-pressed', 'true'));

    const shell = screen.getByTestId('public-theme-toggle');
    const light = within(shell).getByTestId('public-theme-toggle__light');
    const dark = within(shell).getByTestId('public-theme-toggle__dark');

    expect(light.compareDocumentPosition(dark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
