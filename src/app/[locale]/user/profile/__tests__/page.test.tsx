import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { UserProfile } from '@/lib/api/endpoints/me';

const {
  mockUseSearchParams,
  mockUseWorkspaceMembers,
  mockUseAuthStore,
  mockGetProfile,
  mockUpdateProfile,
  mockGetMembership,
  mockHandleErrorForToast,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(),
  mockUseWorkspaceMembers: vi.fn(),
  mockUseAuthStore: vi.fn(),
  mockGetProfile: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockGetMembership: vi.fn(),
  mockHandleErrorForToast: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

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
      return mockGetProfile();
    }
    async updateProfile(payload: unknown) {
      return mockUpdateProfile(payload);
    }
  },
  handleErrorForToast: mockHandleErrorForToast,
}));

vi.mock('@/lib/api/endpoints/members', () => ({
  MemberAPI: class {
    async getMembership() {
      return mockGetMembership();
    }
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
  },
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    display_name: null,
    bio: null,
    job_title: null,
    company: null,
    timezone: null,
    locale: null,
    greeting_preference: null,
    interests: [],
    ...overrides,
  };
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('workspace=ws_1&project=pr_1'));
    mockUseWorkspaceMembers.mockReturnValue({ data: [] });
    mockUseAuthStore.mockReturnValue({
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    mockGetProfile.mockResolvedValue(buildProfile());
    mockUpdateProfile.mockResolvedValue(buildProfile());
    mockGetMembership.mockResolvedValue({ permissions: [] });
  });

  it('renders profile as a quiet settings sheet without dashboard-style chrome', async () => {
    render(<ProfilePage />, { wrapper: createWrapper() });

    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('description')).toBeInTheDocument();
    expect(screen.queryByTestId('profile__summary-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile__form')).toBeInTheDocument();
    expect(screen.getByTestId('profile__permissions')).toBeInTheDocument();
    expect(screen.getByTestId('profile__form').className).not.toMatch(/rounded-lg|shadow-card/);
    expect(screen.getByTestId('profile__permissions').className).not.toMatch(/rounded-lg|shadow-card/);
  });

  it('hydrates fetched profile data into the form when the user has not started editing', async () => {
    mockGetProfile.mockResolvedValue(
      buildProfile({
        display_name: 'Grace Hopper',
        bio: 'Pioneer',
        interests: ['compilers', 'navy'],
      }),
    );

    render(<ProfilePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('profile__display-name')).toHaveValue('Grace Hopper');
      expect(screen.getByTestId('profile__bio')).toHaveValue('Pioneer');
    });
  });

  it('does not clobber in-progress edits when the initial profile query resolves late', async () => {
    const initialProfile = buildProfile({
      display_name: 'Ada Lovelace',
      bio: 'Initial bio',
    });
    const editedProfile = buildProfile({
      display_name: 'Ada Byron',
      bio: 'Analytical engine notes',
    });
    const deferredProfile = createDeferred<UserProfile>();
    const user = userEvent.setup();

    mockGetProfile
      .mockImplementationOnce(() => deferredProfile.promise)
      .mockResolvedValue(editedProfile);
    mockUpdateProfile.mockResolvedValue(editedProfile);

    render(<ProfilePage />, { wrapper: createWrapper() });

    const displayNameInput = screen.getByTestId('profile__display-name');
    const bioInput = screen.getByTestId('profile__bio');

    await user.type(displayNameInput, editedProfile.display_name ?? '');
    await user.type(bioInput, editedProfile.bio ?? '');

    expect(displayNameInput).toHaveValue('Ada Byron');
    expect(bioInput).toHaveValue('Analytical engine notes');

    deferredProfile.resolve(initialProfile);

    await waitFor(() => {
      expect(screen.getByTestId('profile__save-btn')).toBeEnabled();
    });

    expect(displayNameInput).toHaveValue('Ada Byron');
    expect(bioInput).toHaveValue('Analytical engine notes');

    await user.click(screen.getByTestId('profile__save-btn'));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        display_name: 'Ada Byron',
        bio: 'Analytical engine notes',
        job_title: undefined,
        company: undefined,
        timezone: undefined,
        locale: undefined,
        greeting_preference: undefined,
        interests: undefined,
      });
    });
  });
});
