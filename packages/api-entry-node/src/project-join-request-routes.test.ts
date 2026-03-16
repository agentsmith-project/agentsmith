import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  writeProjectAuditEvent,
  upsertProjectMembership,
  readProjectPermissionContext,
} = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
  upsertProjectMembership: vi.fn(),
  readProjectPermissionContext: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
}));

vi.mock('./project-memberships-store.js', () => ({
  upsertProjectMembership,
}));

vi.mock('./project-route-handler-utils.js', async () => {
  const actual = await vi.importActual<typeof import('./project-route-handler-utils.js')>(
    './project-route-handler-utils.js',
  );
  return {
    ...actual,
    readProjectPermissionContext,
  };
});

import {
  getProjectJoinRequestsState,
  handleProjectJoinRequestsRoute,
  resetProjectJoinRequestsState,
} from './project-join-request-routes.js';

describe('project-join-request-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    readProjectPermissionContext.mockResolvedValue({ permissions: ['project:membership:update'] });
    resetProjectJoinRequestsState();
  });

  it('creates and lists join requests', async () => {
    const json = vi.fn();
    const res = { end: vi.fn() } as never;
    const deps = {
      getProjectUseCase: {
        execute: vi.fn().mockResolvedValue({ owner_id: 'owner-1' }),
      },
    } as never;

    await expect(handleProjectJoinRequestsRoute({
      routeKind: 'projectJoinRequests',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      method: 'POST',
      req: {} as never,
      res,
      deps,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      json,
      readBody: vi.fn().mockResolvedValue({ reason: ' Need access ' }),
    })).resolves.toBe(true);

    await expect(handleProjectJoinRequestsRoute({
      routeKind: 'projectJoinRequests',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      method: 'GET',
      req: {} as never,
      res,
      deps,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        action: 'member.join_request.created',
        metadata: {
          requested_user_id: 'user-1',
          reason_present: true,
        },
      }),
    );
    expect(json).toHaveBeenLastCalledWith(
      res,
      200,
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({
          project_id: 'proj-1',
          user_id: 'user-1',
          reason: 'Need access',
          status: 'pending',
        })],
      }),
    );
  });

  it('rejects duplicate pending join requests', async () => {
    getProjectJoinRequestsState('ws-1', 'proj-1').push({
      id: 'jr_1',
      project_id: 'proj-1',
      user_id: 'user-1',
      user_email: 'user-1@example.com',
      user_name: 'User One',
      reason: '',
      status: 'pending',
      requested_at: '2026-03-01T00:00:00Z',
    });
    const json = vi.fn();
    const res = {} as never;

    await expect(handleProjectJoinRequestsRoute({
      routeKind: 'projectJoinRequests',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      method: 'POST',
      req: {} as never,
      res,
      deps: {
        getProjectUseCase: {
          execute: vi.fn().mockResolvedValue({ owner_id: 'owner-1' }),
        },
      } as never,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      json,
      readBody: vi.fn().mockResolvedValue({ reason: '' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      409,
      { error_code: 'JOIN_REQUEST_ALREADY_PENDING', message: 'A pending join request already exists' },
    );
  });

  it('approves and rejects join requests through the extracted handlers', async () => {
    const items = getProjectJoinRequestsState('ws-1', 'proj-1');
    items.push({
      id: 'jr_1',
      project_id: 'proj-1',
      user_id: 'user-1',
      user_email: 'user-1@example.com',
      user_name: 'User One',
      reason: 'Please',
      status: 'pending',
      requested_at: '2026-03-01T00:00:00Z',
    });
    items.push({
      id: 'jr_2',
      project_id: 'proj-1',
      user_id: 'user-2',
      user_email: 'user-2@example.com',
      user_name: 'User Two',
      reason: '',
      status: 'pending',
      requested_at: '2026-03-01T00:00:00Z',
    });
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;
    const deps = {} as never;

    await expect(handleProjectJoinRequestsRoute({
      routeKind: 'projectJoinRequestApprove',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      joinId: 'jr_1',
      method: 'POST',
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    await expect(handleProjectJoinRequestsRoute({
      routeKind: 'projectJoinRequestReject',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      joinId: 'jr_2',
      method: 'POST',
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({ reason: 'not now' }),
    })).resolves.toBe(true);

    expect(upsertProjectMembership).toHaveBeenCalledWith('ws-1', 'proj-1', expect.objectContaining({
      user_id: 'user-1',
      approved_via_join_request_id: 'jr_1',
    }));
    expect(items[0]).toEqual(expect.objectContaining({
      id: 'jr_1',
      status: 'approved',
      reviewed_by: 'owner-1',
    }));
    expect(items[1]).toEqual(expect.objectContaining({
      id: 'jr_2',
      status: 'rejected',
      reviewed_by: 'owner-1',
      reject_reason: 'not now',
    }));
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ action: 'member.join_request.approved', resourceId: 'jr_1' }),
    );
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ action: 'member.join_request.rejected', resourceId: 'jr_2' }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledTimes(2);
  });
});
