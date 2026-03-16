import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeProjectAuditEvent } = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
}));

import { getProjectResourcePolicyOrDefault } from './project-resource-policy-store.js';
import { handleProjectResourcePolicyRoute } from './project-resource-policy-routes.js';

const allowedRateKeys = {
  endpoint: ['endpoint.requests_per_minute'],
  file_library: ['file_library.requests_per_minute'],
  agent: [],
} as const;

const allowedLimitKeys = {
  endpoint: ['endpoint.spending_usd_per_day'],
  file_library: ['file_library.max_total_files'],
  agent: [],
} as const;

describe('project-resource-policy-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
  });

  it('returns default policy for supported resources', async () => {
    const json = vi.fn();
    const res = {} as never;

    await expect(handleProjectResourcePolicyRoute({
      method: 'GET',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      resourceType: 'endpoint',
      resourceId: 'ep-1',
      req: { headers: {} } as never,
      res,
      deps: {} as never,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      json,
      readBody: vi.fn(),
      allowedRateKeys,
      allowedLimitKeys,
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      200,
      getProjectResourcePolicyOrDefault('ws-1', 'proj-1', 'endpoint', 'ep-1'),
    );
  });

  it('rejects invalid top-level rule keys during policy updates', async () => {
    const json = vi.fn();
    const res = {} as never;

    await expect(handleProjectResourcePolicyRoute({
      method: 'PATCH',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      resourceType: 'endpoint',
      resourceId: 'ep-1',
      req: { headers: { 'x-request-id': 'req-1' } } as never,
      res,
      deps: {} as never,
      user: { id: 'user-1', email: 'user-1@example.com', name: 'User One' },
      json,
      readBody: vi.fn().mockResolvedValue({
        access_mode: 'allow_list',
        allowed_subjects: [],
        rate_limits: {
          rules: [{ key: 'endpoint.invalid', value: 10 }],
        },
      }),
      allowedRateKeys,
      allowedLimitKeys,
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      res,
      422,
      { error_code: 'VALIDATION_ERROR', message: 'rate_limits_rule_key_invalid' },
    );
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: 'resource_policy.updated',
        result: 'error',
        requestId: 'req-1',
        errorMessage: 'rate_limits_rule_key_invalid',
      }),
    );
  });

  it('updates policy state and records audit metadata', async () => {
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;
    const deps = {} as never;

    await expect(handleProjectResourcePolicyRoute({
      method: 'PATCH',
      workspaceId: 'ws-2',
      projectId: 'proj-2',
      resourceType: 'file_library',
      resourceId: 'lib-1',
      req: { headers: { 'x-request-id': 'req-2' } } as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({
        access_mode: 'allow_list',
        allowed_subjects: [
          {
            subject_type: 'user',
            subject_id: 'user-1',
            rate_limits: {
              rules: [{ key: 'file_library.requests_per_minute', value: 5 }],
            },
          },
        ],
        spending_limits: {
          rules: [{ key: 'file_library.max_total_files', value: 100 }],
        },
      }),
      allowedRateKeys,
      allowedLimitKeys,
    })).resolves.toBe(true);

    const saved = getProjectResourcePolicyOrDefault('ws-2', 'proj-2', 'file_library', 'lib-1');
    expect(saved).toEqual(expect.objectContaining({
      access_mode: 'allow_list',
      allowed_subjects: [
        expect.objectContaining({
          subject_type: 'user',
          subject_id: 'user-1',
        }),
      ],
    }));
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        action: 'resource_policy.updated',
        requestId: 'req-2',
        metadata: expect.objectContaining({
          governed_resource_type: 'file_library',
          governed_resource_id: 'lib-1',
        }),
      }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });
});
