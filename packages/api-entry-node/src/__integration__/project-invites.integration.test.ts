import { describe, expect, it } from 'vitest';
import { apiFetchWithToken, startServer } from './test-support.js';
import { getProjectMembership, listProjectGroups } from '../project-member-governance-persistence.js';

describe('api-entry-node project invites', () => {
  it('accepts invite into default members group only', async () => {
    const { baseUrl, deps } = startServer();

    const createInvite = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/invites',
      'test-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'alt@example.com',
          expires_in_hours: 24,
        }),
      },
    );
    expect(createInvite.status).toBe(201);
    const invite = (await createInvite.json()) as { invite_url: string };
    const token = new URL(invite.invite_url, 'http://localhost').searchParams.get('token');
    expect(token).toBeTruthy();

    const acceptInvite = await apiFetchWithToken(
      baseUrl,
      '/api/v1/join/accept',
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
    );
    expect(acceptInvite.status).toBe(200);
    await expect(acceptInvite.json()).resolves.toMatchObject({
      ok: true,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });

    const membership = await getProjectMembership(deps.docStore, 'ws_default', 'proj_1', 'user_alt');
    expect(membership).toMatchObject({
      user_id: 'user_alt',
      project_id: 'proj_1',
      status: 'active',
    });

    const groups = await listProjectGroups(deps.docStore, 'ws_default', 'proj_1', 'user_owner');
    const memberIds = groups.find((group) => group.id === 'grp_project_members')?.member_ids ?? [];
    const adminIds = groups.find((group) => group.id === 'grp_project_admins')?.member_ids ?? [];
    expect(memberIds).toContain('user_alt');
    expect(adminIds).not.toContain('user_alt');
  });

  it('rejects accepting invite with mismatched user email', async () => {
    const { baseUrl } = startServer();
    const createInvite = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/invites',
      'test-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alt@example.com' }),
      },
    );
    expect(createInvite.status).toBe(201);
    const invite = (await createInvite.json()) as { invite_url: string };
    const token = new URL(invite.invite_url, 'http://localhost').searchParams.get('token');

    const acceptInvite = await apiFetchWithToken(
      baseUrl,
      '/api/v1/join/accept',
      'secret-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
    );
    expect(acceptInvite.status).toBe(403);
    await expect(acceptInvite.json()).resolves.toMatchObject({
      error_code: 'PERMISSION_DENIED',
      message: 'invite_email_mismatch',
    });
  });
});
