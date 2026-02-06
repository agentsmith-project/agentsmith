import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import UserdataPage from '../page';

const mockUseUserdataSummary = vi.fn(() => ({
  data: {
    total_bytes: 0,
    docdb_collections: 0,
    vectordb_indexes: 0,
  },
}));
const mockUseUserdataEndUsers = vi.fn(() => ({ data: [] }));

vi.mock('@/lib/hooks/use-userdata', () => ({
  useUserdataSummary: (workspaceId: string, projectId: string) =>
    mockUseUserdataSummary(workspaceId, projectId),
  useUserdataEndUsers: (workspaceId: string, projectId: string) =>
    mockUseUserdataEndUsers(workspaceId, projectId),
}));

describe('UserdataPage route', () => {
  it('renders header and toolbar layout', async () => {
    const ui = await UserdataPage({
      params: Promise.resolve({
        workspace: 'ws_1',
        project: 'proj_1',
        locale: 'en',
      }),
    });

    render(ui);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(screen.queryByTestId('page-layout__toolbar')).not.toBeInTheDocument();
  });

  it('passes workspace and project ids to userdata page', async () => {
    mockUseUserdataSummary.mockClear();
    mockUseUserdataEndUsers.mockClear();
    const ui = await UserdataPage({
      params: Promise.resolve({
        workspace: 'ws_1',
        project: 'proj_1',
        locale: 'en',
      }),
    });

    render(ui);

    expect(mockUseUserdataSummary).toHaveBeenCalledWith('ws_1', 'proj_1');
    expect(mockUseUserdataEndUsers).toHaveBeenCalledWith('ws_1', 'proj_1');
  });
});
