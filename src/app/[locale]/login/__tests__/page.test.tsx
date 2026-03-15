import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefetch = vi.fn();
const mockClearAuth = vi.fn();
const mockUseWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ clearAuth: mockClearAuth }),
}));

import LoginEntryPage from '../page';

describe('LoginEntryPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefetch.mockClear();
    mockClearAuth.mockClear();
  });

  it('renders workspace selection as the default login experience', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<LoginEntryPage />);

    expect(screen.getByTestId('workspace-select__heading')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-select__card--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-select__system-link')).toHaveAttribute('href', '/en-US/system/login');
  });
});
