import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  __resetProjectResourcePolicyRateCountersForTests,
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectEndpointRateLimitsForUser,
  checkProjectEndpointSpendingLimitsForUser,
  checkProjectFileLibraryLimitRules,
} from './project-resource-policy-enforcer.js';
import type { ProjectResourcePolicyRecord } from './project-resource-policy-store.js';
import { recordUsageFact } from './audit-usage-store.js';
import { PROJECT_BUILT_IN_GROUP_IDS } from './project-governance-model.js';
import { saveProjectGroup, setProjectAdminGroupMembersPersisted, upsertProjectMembershipRecord } from './project-member-governance-persistence.js';

describe('project-resource-policy-enforcer', () => {
  it('enforces endpoint requests_per_minute at policy root', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_minute', value: 1 }],
      },
    };
    const first = await checkAndConsumeProjectResourceRateLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_000_000,
    });
    const second = await checkAndConsumeProjectResourceRateLimitsForUser({
      docStore,
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

  it('supports subject-level override via group rule', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const userId = 'user_a';
    await saveProjectGroup(docStore, workspaceId, projectId, {
      id: 'grp_ops',
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
    const one = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs });
    const two = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs + 1 });
    const three = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_2', userId, policy, nowMs: baseMs + 2 });
    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(true);
    expect(three).toMatchObject({ allowed: false, scope: 'subject', effective_limit_per_minute: 2 });
  });

  it('supports subject-level override via the built-in admin group rule', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const userId = 'user_admin';
    await upsertProjectMembershipRecord(docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: userId,
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await setProjectAdminGroupMembersPersisted({
      docStore,
      workspaceId,
      projectId,
      memberIds: [userId],
    });
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_default_group',
      access_mode: 'allow_all_members',
      allowed_subjects: [
        {
          subject_type: 'group',
          subject_id: PROJECT_BUILT_IN_GROUP_IDS.admins,
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 2 }] },
        },
      ],
      rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1 }] },
    };
    const baseMs = 1_700_000_160_000;
    const one = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_default_group', userId, policy, nowMs: baseMs });
    const two = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_default_group', userId, policy, nowMs: baseMs + 1 });
    const three = await checkAndConsumeProjectResourceRateLimitsForUser({ docStore, workspaceId, projectId, resourceType: 'endpoint', resourceId: 'ep_default_group', userId, policy, nowMs: baseMs + 2 });
    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(true);
    expect(three).toMatchObject({ allowed: false, scope: 'subject', effective_limit_per_minute: 2 });
  });

  it('enforces file_library requests_per_minute at policy root', async () => {
    __resetProjectResourcePolicyRateCountersForTests();
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'file_library',
      resource_id: 'lib_1',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'file_library.requests_per_minute', value: 1 }],
      },
    };
    const first = await checkAndConsumeProjectResourceRateLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'file_library',
      resourceId: 'lib_1',
      userId: 'user_1',
      policy,
      nowMs: 1_700_000_120_000,
    });
    const second = await checkAndConsumeProjectResourceRateLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceType: 'file_library',
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

  it('enforces endpoint requests_per_5_hours using usage facts', async () => {
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_rate_5h',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: {
        rules: [{ key: 'endpoint.requests_per_5_hours', value: 2 }],
      },
    };
    await recordUsageFact(docStore, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: 'ep_rate_5h',
      end_user_id: 'user_1',
      requests: 2,
      result: 'ok',
      timestamp: new Date(Date.UTC(2026, 1, 26, 8, 0, 0, 0)).toISOString(),
    });
    const decision = await checkProjectEndpointRateLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceId: 'ep_rate_5h',
      userId: 'user_1',
      policy,
      nowMs: Date.UTC(2026, 1, 26, 10, 0, 0, 0),
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      rate_key: 'endpoint.requests_per_5_hours',
      effective_limit: 2,
      current_requests: 2,
    });
  });

  it('enforces endpoint spending_usd_per_day using usage metadata cost', async () => {
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'endpoint',
      resource_id: 'ep_spending_day',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      spending_limits: {
        rules: [{ key: 'endpoint.spending_usd_per_day', value: 1.5 }],
      },
    };
    await recordUsageFact(docStore, {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: 'ep_spending_day',
      end_user_id: 'user_1',
      requests: 1,
      result: 'ok',
      metadata_json: { cost_usd: 1.6 },
      timestamp: new Date(Date.UTC(2026, 1, 26, 8, 0, 0, 0)).toISOString(),
    });
    const decision = await checkProjectEndpointSpendingLimitsForUser({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      resourceId: 'ep_spending_day',
      userId: 'user_1',
      policy,
      nowMs: Date.UTC(2026, 1, 26, 12, 0, 0, 0),
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'spending_limited',
      spending_key: 'endpoint.spending_usd_per_day',
      effective_limit_usd: 1.5,
      current_spending_usd: 1.6,
    });
  });

  it('enforces file library file count and file size limits', async () => {
    const docStore = new InMemoryJsonDocStore();
    const policy: ProjectResourcePolicyRecord = {
      resource_type: 'file_library',
      resource_id: 'lib_limit',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      spending_limits: {
        rules: [
          { key: 'file_library.max_total_files', value: 1 },
          { key: 'file_library.max_file_size_bytes', value: 4 },
        ],
      },
    };

    const oversized = await checkProjectFileLibraryLimitRules({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      userId: 'user_1',
      policy,
      currentFileCount: 0,
      nextFileSizeBytes: 5,
    });
    expect(oversized).toMatchObject({
      allowed: false,
      limit_key: 'file_library.max_file_size_bytes',
      effective_max_file_size_bytes: 4,
      current_file_size_bytes: 5,
      usage_unit: 'bytes',
    });

    const tooMany = await checkProjectFileLibraryLimitRules({
      docStore,
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      userId: 'user_1',
      policy,
      currentFileCount: 1,
      nextFileSizeBytes: 1,
    });
    expect(tooMany).toMatchObject({
      allowed: false,
      limit_key: 'file_library.max_total_files',
      effective_max_total_files: 1,
      current_total_files: 1,
      usage_unit: 'files',
    });
  });
});
