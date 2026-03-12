import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => true,
  useAuthStore: () => ({ isAuthenticated: false }),
}));

import LoginEntryPage from '../page';

describe('LoginEntryPage', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('renders workspace and system entry actions', () => {
    render(<LoginEntryPage />);

    expect(screen.getByTestId('login-entry__heading')).toBeInTheDocument();
    expect(screen.getByTestId('login-entry__workspace')).toHaveAttribute('href', '/en-US/login/workspace');
    expect(screen.getByTestId('login-entry__system')).toHaveAttribute('href', '/en-US/system/login');
  });
});
