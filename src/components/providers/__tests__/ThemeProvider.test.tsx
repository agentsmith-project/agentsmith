import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from '../ThemeProvider';

function ThemeProbe() {
  const { theme, toggleTheme, setTheme, mounted } = useTheme();

  return (
    <div>
      <div data-testid="theme-value">{theme}</div>
      <div data-testid="theme-mounted">{mounted ? 'yes' : 'no'}</div>
      <button type="button" onClick={() => setTheme('dark')}>
        Set dark
      </button>
      <button type="button" onClick={toggleTheme}>
        Toggle theme
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
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
