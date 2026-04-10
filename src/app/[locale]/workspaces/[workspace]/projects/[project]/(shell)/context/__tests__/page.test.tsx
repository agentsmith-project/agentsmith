import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseHasPermission = vi.fn(() => true);
const mockContextManager = vi.fn<(props: unknown) => unknown>(() => <div data-testid="context-manager" />);
const mockResolvedRoute = vi.fn(() => ({
  workspace: 'ws_1',
  project: 'proj_1',
  locale: 'en',
  isReady: true,
  isValid: true,
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: () => mockUseHasPermission(),
}));

vi.mock('@/lib/hooks/use-resolved-project-route', () => ({
  useResolvedProjectRoute: () => mockResolvedRoute(),
}));

vi.mock('@/components/context/ContextManager', () => ({
  ContextManager: (props: unknown) => {
    mockContextManager(props);
    return <div data-testid="context-manager" />;
  },
}));

import ProjectContextPage from '../page';

describe('ProjectContextPage', () => {
  it('renders context manager for the current project', () => {
    render(
      <ProjectContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })}
      />,
    );

    expect(screen.getByTestId('context-manager')).toBeInTheDocument();
    expect(mockContextManager).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        workspaceId: 'ws_1',
        projectId: 'proj_1',
      }),
    );
  });

  it('shows permission denied when governance update is unavailable', () => {
    mockUseHasPermission.mockReturnValueOnce(false);
    render(
      <ProjectContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })}
      />,
    );
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows validation error for invalid parameters', () => {
    mockResolvedRoute.mockReturnValueOnce({
      workspace: '',
      project: '',
      locale: 'en',
      isReady: true,
      isValid: false,
    });

    render(
      <ProjectContextPage
        params={Promise.resolve({ workspace: 'bad ws', project: 'bad proj', locale: 'en' })}
      />,
    );

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
