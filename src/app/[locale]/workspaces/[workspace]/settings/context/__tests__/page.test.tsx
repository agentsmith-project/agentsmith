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

import WorkspaceContextPage from '../page';

describe('WorkspaceContextPage', () => {
  it('renders context manager for the current workspace', () => {
    render(<WorkspaceContextPage />);

    expect(screen.getByText('workspace_scope_note')).toBeInTheDocument();
    expect(screen.getByTestId('context-manager')).toBeInTheDocument();
    expect(mockContextManager).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'workspace',
        workspaceId: 'ws_1',
      }),
    );
  });

  it('shows permission denied when governance update is unavailable', () => {
    mockUseHasWorkspacePermission.mockReturnValueOnce(false);
    render(<WorkspaceContextPage />);
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
