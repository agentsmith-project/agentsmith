import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '../ThemeProvider';

function ThemeProbe() {
  const { theme, toggleTheme, setTheme, mounted } = useTheme();

  return (
    <div>
      <div data-testid='theme-value'>{theme}</div>
      <div data-testid='theme-mounted'>{mounted ? 'yes' : 'no'}</div>
      <button type='button' onClick={() => setTheme('dark')}>
        Set dark
      </button>
      <button type='button' onClick={toggleTheme}>
        Toggle theme
      </button>
    </div>
  );
}

type MatchMediaStub = {
  setMatches: (next: boolean) => void;
};

function installMatchMediaStub(initialMatches: boolean): MatchMediaStub {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  })));

  return {
    setMatches(next) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
    installMatchMediaStub(false);
  });

  it('hydrates from the current document theme and persists updates', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('theme-mounted')).toHaveTextContent('yes'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light');

    fireEvent.click(screen.getByText('Set dark'));

    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('mbos.theme')).toBe('dark');
  });

  it('falls back to the system theme when no explicit preference is stored', async () => {
    const media = installMatchMediaStub(true);
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('theme-mounted')).toHaveTextContent('yes'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark');

    act(() => {
      media.setMatches(false);
    });

    await waitFor(() => expect(screen.getByTestId('theme-value')).toHaveTextContent('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('mbos.theme')).toBeNull();
  });

  it('toggles between light and dark', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('theme-mounted')).toHaveTextContent('yes'));

    fireEvent.click(screen.getByText('Toggle theme'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark');

    fireEvent.click(screen.getByText('Toggle theme'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light');
  });
});
