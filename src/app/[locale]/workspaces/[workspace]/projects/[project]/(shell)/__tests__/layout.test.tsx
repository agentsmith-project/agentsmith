import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';
import AppShellLayout from '../layout';

const mockUseParams = vi.fn(() => ({
  locale: 'en-US',
  workspace: 'ws_1',
  project: 'proj_1',
}));
const mockPush = vi.fn();
const mockRefetchProject = vi.fn();
const mockUseProject = vi.fn<
  () => {
    isLoading: boolean;
    isError: boolean;
    error: APIError | null;
    refetch: typeof mockRefetchProject;
  }
>(() => ({
  isLoading: false,
  isError: false,
  error: null,
  refetch: mockRefetchProject,
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/en-US/workspaces/ws_1/projects/proj_1/overview',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/app-shell/AppShellSidebar', () => ({
  AppShellSidebar: () => <div data-testid="project-shell__sidebar" />,
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="project-shell__topbar" />,
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => mockUseProject(),
}));

describe('AppShellLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProject.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetchProject,
    });
  });

  it('renders shell chrome when project is available', () => {
    render(
      <AppShellLayout>
        <div data-testid="project-shell__content">content</div>
      </AppShellLayout>,
    );

    expect(screen.getByTestId('project-shell__topbar')).toBeInTheDocument();
    expect(screen.getByTestId('project-shell__sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('project-shell__content')).toBeInTheDocument();
  });

  it('shows unavailable state when project lookup returns not found', () => {
    mockUseProject.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new APIError('RESOURCE_NOT_FOUND', 'project_not_found', undefined, 404),
      refetch: mockRefetchProject,
    });

    render(
      <AppShellLayout>
        <div>content</div>
      </AppShellLayout>,
    );

    expect(screen.getByTestId('project-shell__project-not-found')).toBeInTheDocument();
    expect(screen.getByText('project_unavailable_title')).toBeInTheDocument();
    expect(screen.getByText('project_unavailable_description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });
});
