import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1' }));
const mockUseHasWorkspacePermission = vi.fn(() => true);
const mockContextManager = vi.fn<(props: unknown) => unknown>(() => <div data-testid="context-manager" />);

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: () => mockUseHasWorkspacePermission(),
}));

vi.mock('@/components/context/ContextManager', () => ({
  ContextManager: (props: unknown) => {
    mockContextManager(props);
    return <div data-testid="context-manager" />;
  },
}));

import WorkspacePersonalContextPage from '../page';

describe('WorkspacePersonalContextPage', () => {
  it('renders workspace personal context for the current workspace', () => {
    render(<WorkspacePersonalContextPage />);

    expect(screen.getByText('member_workspace_title')).toBeInTheDocument();
    expect(screen.getByText('member_workspace_subtitle')).toBeInTheDocument();
    expect(screen.getByTestId('context-manager')).toBeInTheDocument();
    expect(mockContextManager).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'member',
        workspaceId: 'ws_1',
        surface: 'workspace',
      }),
    );
  });

  it('shows permission denied when workspace access is unavailable', () => {
    mockUseHasWorkspacePermission.mockReturnValueOnce(false);

    render(<WorkspacePersonalContextPage />);

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows validation error for invalid workspace parameters', () => {
    mockUseParams.mockReturnValueOnce({ workspace: '<script>alert(1)</script>' });

    render(<WorkspacePersonalContextPage />);

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
