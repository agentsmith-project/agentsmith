import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import UsagePage from '../page';

const mockUsagePage = vi.fn(() => <div />);

vi.mock('@/components/audit-usage/UsagePage', () => ({
  UsagePage: (props: any) => mockUsagePage(props),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => ({
    data: {
      id: 'proj_1',
      workspace_id: 'ws_1',
      name: 'Project',
      visibility: 'private',
      owner_id: 'user_001',
      status: 'active',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      role: 'user',
      permissions: ['project:usage:read'],
    },
  }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user_001' } }),
}));

describe('UsagePage route', () => {
  it('locks end_user_id for user role', async () => {
    render(
      <UsagePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(mockUsagePage).toHaveBeenCalled();
    });

    const props = mockUsagePage.mock.calls[0][0];
    expect(props.defaultEndUserId).toBe('user_001');
  });
});
