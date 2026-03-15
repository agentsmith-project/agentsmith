import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetToken = vi.fn<() => string | null>(() => 'invite_token');
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? mockGetToken() : null),
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { mutationFn: (token: string) => Promise<unknown>; onSuccess?: () => void; onError?: () => void }) => ({
    isPending: false,
    mutate: async (token: string) => {
      try {
        await options.mutationFn(token);
        options.onSuccess?.();
      } catch {
        options.onError?.();
      }
    },
  }),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  MemberAPI: class {
    async acceptInvite() {
      return Promise.resolve();
    }
    async declineInvite() {
      return Promise.resolve();
    }
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { error: vi.fn() },
}));

import JoinPage from '../page';

describe('JoinPage', () => {
  beforeEach(() => {
    mockGetToken.mockReturnValue('invite_token');
    mockPush.mockReset();
  });

  it('renders invitation actions when token is present', async () => {
    render(<JoinPage />);

    await waitFor(() => {
      expect(screen.getByTestId('join__accept-btn')).toBeInTheDocument();
    });

    expect(screen.getByTestId('join__decline-btn')).toBeInTheDocument();
    expect(screen.getAllByText('title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('description').length).toBeGreaterThan(0);
  });

  it('renders invalid invitation state when token is missing', async () => {
    mockGetToken.mockReturnValue(null);

    render(<JoinPage />);

    await waitFor(() => {
      expect(screen.getAllByText('invalid_title').length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('button', { name: 'go_home' })).toBeInTheDocument();
    expect(screen.queryByTestId('join__accept-btn')).not.toBeInTheDocument();
  });
});
