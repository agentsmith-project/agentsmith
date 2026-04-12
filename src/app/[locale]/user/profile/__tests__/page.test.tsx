import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseSearchParams = vi.fn();
const mockUseWorkspaceMembers = vi.fn();
const mockUseAuthStore = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string; name: string; email: string; avatar?: string } | null }) => unknown) =>
    selector(mockUseAuthStore()),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaceMembers: () => mockUseWorkspaceMembers(),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  MeAPI: class {
    async getProfile() {
      return Promise.resolve({});
    }
    async updateProfile() {
      return Promise.resolve({});
    }
  },
  MemberAPI: class {
    async getMembership() {
      return Promise.resolve({ permissions: [] });
    }
  },
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

import ProfilePage from '../page';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ProfilePage', () => {
  const wrapper = createWrapper();

  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('workspace=ws_1&project=pr_1'));
    mockUseWorkspaceMembers.mockReturnValue({ data: [] });
    mockUseAuthStore.mockReturnValue({
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    });
  });

  it('keeps the profile page to a single summary strip instead of stacked summary cards', async () => {
    render(<ProfilePage />, { wrapper });

    expect(screen.getByTestId('profile__summary-strip')).toBeInTheDocument();
    expect(screen.getByTestId('profile__form')).toBeInTheDocument();
    expect(screen.getByTestId('profile__permissions')).toBeInTheDocument();
    expect(screen.queryByTestId('profile__summary-card')).not.toBeInTheDocument();
  });
});
