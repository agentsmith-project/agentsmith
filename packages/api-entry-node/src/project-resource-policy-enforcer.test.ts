import { describe, expect, it } from 'vitest';
import { __resetProjectResourcePolicyRateCountersForTests, checkAndConsumeProjectResourceRateLimitsForUser } from './project-resource-policy-enforcer.js';
import { getProjectGroupsState } from './project-groups-store.js';
import type { ProjectResourcePolicyRecord } from './project-resource-policy-store.js';

describe('project-resource-policy-enforcer', () => {
  it('enforces endpoint requests_per_minute at policy root', () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_minute', value: 1 }],
      },
    };
    const first = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_000_000,
    });
    const second = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_000_100,
    });
    expect(first.allowed).toBe(true);
    expect(second).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      effective_limit_per_minute: 1,
      scope: 'policy',
    });
  });

  it('supports subject-level override via group rule', () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const userId = 'user_a';
    getProjectGroupsState(workspaceId, projectId).push({
      id: 'grp_ops',
      project_id: projectId,
      name: 'ops',
      permission_template_id: 'perm_tpl_default',
      member_ids: [userId],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_2',
      access_mode: 'allow_all_members',
      allowed_subjects: [
        {
          subject_type: 'group',
          subject_id: 'grp_ops',
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 2 }] },
        },
      ],
      rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1 }] },
    };
    const baseMs = 1_700_000_060_000;
    const one = checkAndConsumeProjectResourceRateLimitsForUser({ workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs });
    const two = checkAndConsumeProjectResourceRateLimitsForUser({ workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs + 1 });
    const three = checkAndConsumeProjectResourceRateLimitsForUser({ workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs + 2 });
    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(true);
    expect(three).toMatchObject({ allowed: false, scope: 'subject', effective_limit_per_minute: 2 });
  });
});

