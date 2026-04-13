import { describe, expect, it } from 'vitest';
import {
  acceptMockProjectInviteRecord,
  createMockProjectInviteRecord,
} from '../src/mocks/handlers/members';
import { createMockAuthToken, parseMockAuthToken } from '../src/mocks/utils/mock-auth-token';

describe('member mock handlers', () => {
  it('accepts an invite when the quick-login actor token carries the invited email', () => {
    const inviterToken = createMockAuthToken({
      userId: 'user_001',
      userEmail: 'owner@example.com',
      issuedAt: 12345,
    });
    expect(parseMockAuthToken(inviterToken)).toEqual({
      userId: 'user_001',
      userEmail: 'owner@example.com',
    });

    const invite = createMockProjectInviteRecord({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      invitedEmail: 'invitee@example.com',
      now: new Date('2026-04-13T10:00:00.000Z'),
    });

    const inviteeToken = createMockAuthToken({
      userId: 'user_001',
      userEmail: 'invitee@example.com',
      issuedAt: 12345,
    });
    expect(parseMockAuthToken(inviteeToken)).toEqual({
      userId: 'user_001',
      userEmail: 'invitee@example.com',
    });

    const result = acceptMockProjectInviteRecord({
      token: invite.token,
      actor: {
        user_id: 'user_001',
        user_email: 'invitee@example.com',
        user_name: 'invitee',
      },
      now: new Date('2026-04-13T10:01:00.000Z'),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      workspace_id: 'ws_default',
      project_id: 'proj_001',
    });
  });
});
