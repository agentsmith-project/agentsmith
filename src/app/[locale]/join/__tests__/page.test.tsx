import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetToken = vi.fn<() => string | null>(() => 'invite_token');
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockHydration = vi.fn(() => true);
const mockAuthenticated = vi.fn(() => false);
let acceptInviteResponse: { ok: true; workspace_id?: string; project_id?: string } = { ok: true };

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? mockGetToken() : null),
  }),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => mockHydration(),
  useAuthStore: () => ({
    isAuthenticated: mockAuthenticated(),
  }),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  MemberAPI: class {
    async acceptInvite() {
      return Promise.resolve(acceptInviteResponse);
    }
    async declineInvite() {
      return Promise.resolve();
    }
  },
}));

vi.mock('@/lib/public-runtime-config', () => ({
  buildPublicApiUrl: (path: string) => `https://api.example.com${path}`,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

import JoinPage from '../page';

describe('JoinPage', () => {
  const fetchMock = vi.fn();
  const sessionStore = new Map<string, string>();

  beforeEach(() => {
    mockGetToken.mockReturnValue('invite_token');
    mockPush.mockReset();
    mockReplace.mockReset();
    mockHydration.mockReturnValue(true);
    mockAuthenticated.mockReturnValue(false);
    acceptInviteResponse = { ok: true };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.example.com/join/invites/invite_token') {
        return {
          ok: true,
          json: async () => ({
            invite_id: 'invite_001',
            workspace_id: 'ws_alpha',
            workspace_name: 'Alpha Workspace',
            project_id: 'proj_alpha',
            project_name: 'Alpha Project',
            status: 'pending',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'sessionStorage',
      ({
        getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          sessionStore.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          sessionStore.delete(key);
        }),
      } as unknown) as Storage,
    );
    sessionStore.clear();
  });

  it('renders public invite truth and continues directly to the invited workspace login when unauthenticated', async () => {
    render(<JoinPage />);

    await waitFor(() => {
      expect(screen.getByTestId('join__invite-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('join__invite-workspace')).toHaveTextContent('Alpha Workspace');
    expect(screen.getByTestId('join__invite-project')).toHaveTextContent('Alpha Project');
    expect(screen.getByTestId('join__continue-btn')).toBeInTheDocument();
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('logo')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('join__continue-btn'));

    expect(sessionStore.get('agentsmith:pending-invite')).toContain('invite_token');
    expect(sessionStore.get('agentsmith:invite-handoff')).toContain('ws_alpha');
    expect(sessionStore.get('agentsmith:invite-handoff')).toContain('proj_alpha');
    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha/login?project_id=proj_alpha');
  });

  it('auto-accepts the invite for an already authenticated member and lands on the invited project overview', async () => {
    mockAuthenticated.mockReturnValue(true);
    acceptInviteResponse = { ok: true, workspace_id: 'ws_alpha', project_id: 'proj_alpha' };

    render(<JoinPage />);

    await waitFor(() => {
      expect(screen.getByTestId('join__auto-accepting')).toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
    });
  });

  it('renders invalid invitation state when token is missing', async () => {
    mockGetToken.mockReturnValue(null);

    render(<JoinPage />);

    await waitFor(() => {
      expect(screen.getAllByText('invalid_title')).toHaveLength(1);
    });

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(screen.getByRole('button', { name: 'go_home' })).toBeInTheDocument();
    expect(screen.queryByTestId('join__continue-btn')).not.toBeInTheDocument();
  });
});
