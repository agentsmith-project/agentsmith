import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AppShellPage from '../page';

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/i18n/routing', () => ({
  usePathname: () => '/app-shell',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/components/providers/MSWProvider', () => ({
  MSWProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/notifications/NotificationCenter', () => ({
  NotificationCenter: () => <div data-testid="notification-center" />,
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws_default', name: 'Default Workspace' }] }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useGovernableProjects: () => ({ data: [] }),
  useProject: () => ({ data: null }),
  useProjects: () => ({ data: [] }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: () => false,
}));

vi.mock('@/lib/hooks/use-project-layout-mode', () => ({
  broadcastProjectLayoutMode: vi.fn(),
  useProjectLayoutMode: () => ({
    layoutMode: 'standard',
    showLayoutToggle: false,
  }),
}));

describe('/app-shell route contract', () => {
  it('renders the preview route inside the same provider contract used by the locale app shell', () => {
    render(<AppShellPage />);

    expect(screen.getByTestId('page-state__success')).toBeInTheDocument();
    expect(screen.getAllByTestId('page-layout').length).toBeGreaterThan(0);
    expect(screen.getByTestId('topbar__user-menu')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell__preview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /App Shell/i })).toBeInTheDocument();
  });
});
