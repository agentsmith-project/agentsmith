import { describe, expect, it, vi } from 'vitest';
import {
  projectScopedKey,
  readProjectPermissionContext,
  readRequestId,
  validatePolicyRuleKeys,
} from './project-source-route-handler-utils.js';

describe('project-source-route-handler utils', () => {
  it('reads request ids from string and array headers', () => {
    expect(readRequestId({ headers: { 'x-request-id': ' req-1 ' } } as never)).toBe('req-1');
    expect(readRequestId({ headers: { 'x-request-id': [' ', 'req-2'] } } as never)).toBe('req-2');
    expect(readRequestId({ headers: {} } as never)).toBeUndefined();
  });

  it('builds scoped keys', () => {
    expect(projectScopedKey('ws', 'proj')).toBe('ws:proj');
  });

  it('validates resource policy rules against allowed keys', () => {
    const allowedRateKeys = {
      endpoint: ['endpoint.requests_per_minute'],
      source_library: ['source_library.requests_per_minute'],
      agent: [],
    } as const;
    const allowedLimitKeys = {
      endpoint: ['endpoint.spending_usd_per_day'],
      source_library: ['source_library.max_total_files'],
      agent: [],
    } as const;

    expect(
      validatePolicyRuleKeys({
        resourceType: 'endpoint',
        kind: 'rate_limits',
        payload: { rules: [{ key: 'endpoint.requests_per_minute', value: 10 }] },
        allowedRateKeys,
        allowedLimitKeys,
      }),
    ).toEqual({ ok: true });

    expect(
      validatePolicyRuleKeys({
        resourceType: 'endpoint',
        kind: 'rate_limits',
        payload: { rules: [{ key: 'endpoint.unknown', value: 10 }] },
        allowedRateKeys,
        allowedLimitKeys,
      }),
    ).toEqual({ ok: false, message: 'rate_limits_rule_key_invalid' });
  });

  it('reads project permission context and falls back to null on lookup error', async () => {
    const execute = vi.fn().mockResolvedValue({
      owner_id: 'owner-1',
      governance_json: {},
    });
    const deps = {
      getProjectUseCase: { execute },
    } as never;

    const context = await readProjectPermissionContext({
      deps,
      workspaceId: 'ws',
      projectId: 'proj',
      actorUserId: 'owner-1',
    });

    expect(context?.ownerId).toBe('owner-1');
    expect(context?.permissions).toContain('project:lifecycle:update');

    execute.mockRejectedValueOnce(new Error('boom'));
    await expect(
      readProjectPermissionContext({
        deps,
        workspaceId: 'ws',
        projectId: 'proj',
        actorUserId: 'owner-1',
      }),
    ).resolves.toBeNull();
  });
});
