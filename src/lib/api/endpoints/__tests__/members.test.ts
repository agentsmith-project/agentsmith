import { describe, expect, it, vi } from 'vitest';
import { MemberAPI } from '../members';

describe('MemberAPI.remove', () => {
  it('deletes memberships via the canonical project membership route', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const api = new MemberAPI({ delete: deleteFn } as never);

    await api.remove('ws_1', 'proj_1', 'user_1');

    expect(deleteFn).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/memberships/user_1');
  });
});
