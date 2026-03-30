import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';

const {
  appendUserNotification,
  writeProjectAuditEvent,
  readProjectPermissionContext,
} = vi.hoisted(() => ({
  appendUserNotification: vi.fn(),
  writeProjectAuditEvent: vi.fn(),
  readProjectPermissionContext: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
}));

vi.mock('./me-notifications-store.js', async () => {
  const actual = await vi.importActual<typeof import('./me-notifications-store.js')>('./me-notifications-store.js');
  return {
    ...actual,
    appendUserNotification,
  };
});

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
  getProjectJoinRequest,
  handleProjectJoinRequestsRoute,
  saveProjectJoinRequest,
} from './project-join-request-routes.js';
import { getProjectMembership } from './project-member-governance-persistence.js';

describe('project-join-request-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    appendUserNotification.mockResolvedValue(undefined);
    readProjectPermissionContext.mockResolvedValue({ permissions: ['project:membership:update'] });
  });

  it('creates and lists join requests', async () => {
    const json = vi.fn();
    const res = { end: vi.fn() } as never;
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      getProjectUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'proj-1',
          name: 'Shared Project',
          owner_id: 'owner-1',
          visibility: 'public',
          join_policy: 'approval_required',
          status: 'active',
        }),
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
    expect(json).toHaveBeenNthCalledWith(
      1,
      res,
      201,
      expect.objectContaining({
        outcome: 'pending',
      }),
    );
    expect(json).toHaveBeenNthCalledWith(
      2,
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
    const docStore = new InMemoryJsonDocStore();
    await saveProjectJoinRequest(docStore, 'ws-1', {
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
        docStore,
        getProjectUseCase: {
          execute: vi.fn().mockResolvedValue({
            id: 'proj-1',
            name: 'Shared Project',
            owner_id: 'owner-1',
            visibility: 'public',
            join_policy: 'approval_required',
            status: 'active',
          }),
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
    const docStore = new InMemoryJsonDocStore();
    await saveProjectJoinRequest(docStore, 'ws-1', {
      id: 'jr_1',
      project_id: 'proj-1',
      user_id: 'user-1',
      user_email: 'user-1@example.com',
      user_name: 'User One',
      reason: 'Please',
      status: 'pending',
      requested_at: '2026-03-01T00:00:00Z',
    });
    await saveProjectJoinRequest(docStore, 'ws-1', {
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
    const deps = {
      docStore,
      getProjectUseCase: {
        execute: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Shared Project' }),
      },
    } as never;

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

    expect(await getProjectMembership(docStore, 'ws-1', 'proj-1', 'user-1')).toEqual(expect.objectContaining({
      user_id: 'user-1',
      approved_via_join_request_id: 'jr_1',
    }));
    const approved = await getProjectJoinRequest(docStore, 'ws-1', 'proj-1', 'jr_1');
    const rejected = await getProjectJoinRequest(docStore, 'ws-1', 'proj-1', 'jr_2');
    expect(approved).toEqual(expect.objectContaining({
      id: 'jr_1',
      status: 'approved',
      reviewed_by: 'owner-1',
    }));
    expect(rejected).toEqual(expect.objectContaining({
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
    expect(appendUserNotification).toHaveBeenCalledWith(
      docStore,
      'user-1',
      expect.objectContaining({
        type: 'join_request_approved',
        link_url: '/workspaces/ws-1/projects/proj-1/overview',
      }),
    );
    expect(appendUserNotification).toHaveBeenCalledWith(
      docStore,
      'user-2',
      expect.objectContaining({
        type: 'join_request_rejected',
        link_url: '/workspaces/ws-1/projects',
      }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledTimes(2);
  });

  it('allows direct join for public open projects', async () => {
    const json = vi.fn();
    const res = { end: vi.fn() } as never;
    const deps = {
      docStore: new InMemoryJsonDocStore(),
      getProjectUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'proj-1',
          name: 'Open Project',
          owner_id: 'owner-1',
          visibility: 'public',
          join_policy: 'open',
          status: 'active',
        }),
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
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(await getProjectMembership(deps.docStore, 'ws-1', 'proj-1', 'user-1')).toEqual(
      expect.objectContaining({ user_id: 'user-1', status: 'active' }),
    );
    expect(json).toHaveBeenCalledWith(
      res,
      201,
      { outcome: 'joined', membership_status: 'active' },
    );
  });
});
