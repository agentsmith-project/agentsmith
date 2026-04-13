import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('members invite acceptance truth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects invite acceptance when the authenticated email does not match the invited email', async () => {
    const { createMockProjectInviteRecord, acceptMockProjectInviteRecord } = await import('../src/mocks/handlers/members');
    const { memberProjectMembershipFixtures } = await import('../src/mocks/fixtures/members');

    const invite = createMockProjectInviteRecord({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      invitedEmail: 'guest@example.com',
      expiresInHours: 24,
      now: new Date('2026-05-01T00:00:00Z'),
    });

    const result = acceptMockProjectInviteRecord({
      token: invite.token,
      actor: {
        user_id: 'user_999',
        user_email: 'not-matching@example.com',
        user_name: 'Mismatch User',
      },
      now: new Date('2026-05-01T01:00:00Z'),
    });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      error_code: 'PERMISSION_DENIED',
      message: 'invite_email_mismatch',
    });
    expect(invite.status).toBe('pending');
    expect(memberProjectMembershipFixtures.some((item) => item.project_id === 'proj_001' && item.user_id === 'user_999')).toBe(false);
  });

  it('writes an active project membership for the invited user when the email matches', async () => {
    const { createMockProjectInviteRecord, acceptMockProjectInviteRecord } = await import('../src/mocks/handlers/members');
    const { memberProjectMembershipFixtures } = await import('../src/mocks/fixtures/members');

    const invite = createMockProjectInviteRecord({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      invitedEmail: 'guest@example.com',
      expiresInHours: 24,
      now: new Date('2026-05-01T00:00:00Z'),
    });

    const result = acceptMockProjectInviteRecord({
      token: invite.token,
      actor: {
        user_id: 'user_009',
        user_email: 'guest@example.com',
        user_name: 'Guest User',
      },
      now: new Date('2026-05-01T01:00:00Z'),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      workspace_id: 'ws_default',
      project_id: 'proj_001',
    });
    expect(invite.status).toBe('accepted');
    expect(memberProjectMembershipFixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        project_id: 'proj_001',
        user_id: 'user_009',
        status: 'active',
        joined_at: '2026-05-01T01:00:00.000Z',
      }),
    ]));
  });
});
