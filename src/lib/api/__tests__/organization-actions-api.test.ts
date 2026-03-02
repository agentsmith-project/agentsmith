import { describe, expect, it, vi } from 'vitest';
import { OrganizationActionsAPI } from '@/lib/api/endpoints/organization-actions';

describe('OrganizationActionsAPI', () => {
  it('lists organization action records by ids', async () => {
    const getMock = vi.fn().mockResolvedValue({ items: [] });
    const api = new OrganizationActionsAPI({
      get: getMock,
    } as unknown as ConstructorParameters<typeof OrganizationActionsAPI>[0]);

    await api.list(['action:ws_1:project:proj_1', 'action:ws_2:project:proj_2']);

    expect(getMock).toHaveBeenCalledWith('/internal/organization-actions?action_ids=action%3Aws_1%3Aproject%3Aproj_1%2Caction%3Aws_2%3Aproject%3Aproj_2');
  });

  it('updates organization action status', async () => {
    const postMock = vi.fn().mockResolvedValue({ action_id: 'action:ws_1:project:proj_1', status: 'completed' });
    const api = new OrganizationActionsAPI({
      post: postMock,
    } as unknown as ConstructorParameters<typeof OrganizationActionsAPI>[0]);

    await api.updateStatus('action:ws_1:project:proj_1', {
      status: 'completed',
      actor_user_id: 'user_1',
      actor_name: 'User One',
      note: 'completed in overview',
    });

    expect(postMock).toHaveBeenCalledWith('/internal/organization-actions/action%3Aws_1%3Aproject%3Aproj_1/status', {
      status: 'completed',
      actor_user_id: 'user_1',
      actor_name: 'User One',
      note: 'completed in overview',
    });
  });

  it('lists organization action audit history', async () => {
    const getMock = vi.fn().mockResolvedValue({ action_id: 'action:ws_1:project:proj_1', total: 0, items: [] });
    const api = new OrganizationActionsAPI({
      get: getMock,
    } as unknown as ConstructorParameters<typeof OrganizationActionsAPI>[0]);

    await api.listHistory('action:ws_1:project:proj_1', 30);

    expect(getMock).toHaveBeenCalledWith('/internal/organization-actions/action%3Aws_1%3Aproject%3Aproj_1/history?limit=30');
  });
});
