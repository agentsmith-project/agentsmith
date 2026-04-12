import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { PublicThemeToggle } from '../PublicThemeToggle';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('PublicThemeToggle', () => {
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
});
