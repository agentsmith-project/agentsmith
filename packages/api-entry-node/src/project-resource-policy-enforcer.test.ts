import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  __resetProjectResourcePolicyRateCountersForTests,
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectResourceQuotaLimitsForUser,
  checkProjectSourceLibraryQuotaLimits,
} from './project-resource-policy-enforcer.js';
import { getProjectGroupsState } from './project-groups-store.js';
import type { ProjectResourcePolicyRecord } from './project-resource-policy-store.js';
import { recordUsageFact } from './audit-usage-store.js';

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

  it('enforces source_library requests_per_minute at policy root', () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'source_library',
      resource_id: 'lib_1',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'source_library.requests_per_minute', value: 1 }],
      },
    };
    const first = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'source_library',
      resourceId: 'lib_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_120_000,
    });
    const second = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'source_library',
      resourceId: 'lib_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_120_100,
    });
    expect(first.allowed).toBe(true);
    expect(second).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      effective_limit_per_minute: 1,
      scope: 'policy',
    });
  });

  it('enforces endpoint requests_per_day quota using request counts', async () => {
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_quota_day',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      quota_limits: {
        rules: [{ key: 'endpoint.requests_per_day', value: 2 }],
      },
    };

    await recordUsageFact(docStore, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: 'ep_quota_day',
      end_user_id: 'user_1',
      requests: 2,
      result: 'ok',
      timestamp: new Date(Date.UTC(2026, 1, 26, 8, 0, 0, 0)).toISOString(),
    });

    const decision = await checkProjectResourceQuotaLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'endpoint',
      resourceId: 'ep_quota_day',
      userId: 'user_1',
      policy,
      nowMs: Date.UTC(2026, 1, 26, 12, 0, 0, 0),
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
      quota_key: 'endpoint.requests_per_day',
      effective_requests_per_day: 2,
      current_requests_today: 2,
      usage_unit: 'requests',
    });
  });

  it('enforces source library file count and file size quotas', () => {
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'source_library',
      resource_id: 'lib_quota',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      quota_limits: {
        rules: [
          { key: 'source_library.max_total_files', value: 1 },
          { key: 'source_library.max_file_size_bytes', value: 4 },
        ],
      },
    };

    const oversized = checkProjectSourceLibraryQuotaLimits({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      userId: 'user_1',
      policy,
      currentFileCount: 0,
      nextFileSizeBytes: 5,
    });
    expect(oversized).toMatchObject({
      allowed: false,
      quota_key: 'source_library.max_file_size_bytes',
      effective_max_file_size_bytes: 4,
      current_file_size_bytes: 5,
      usage_unit: 'bytes',
    });

    const tooMany = checkProjectSourceLibraryQuotaLimits({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      userId: 'user_1',
      policy,
      currentFileCount: 1,
      nextFileSizeBytes: 1,
    });
    expect(tooMany).toMatchObject({
      allowed: false,
      quota_key: 'source_library.max_total_files',
      effective_max_total_files: 1,
      current_total_files: 1,
      usage_unit: 'files',
    });
  });
});
