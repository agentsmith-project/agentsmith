import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { recordUsageFact } from './audit-usage-store.js';
import { getMemberQuotaState } from './project-member-quota-store.js';
import { checkMemberEndpointDailyTokenQuota } from './project-member-quota-enforcer.js';

describe('project-member-quota-enforcer', () => {
  it('allows below daily token limit and blocks once reached', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const userId = 'user_a';
    const endpointId = 'ep_1';
    getMemberQuotaState(workspaceId, projectId).set(userId, {
      overrides: { endpoint: { daily_token_limit: 100 } },
      history: [],
    });

    const before = await checkMemberEndpointDailyTokenQuota({
      docStore,
      workspaceId,
      projectId,
      endpointId,
      userId,
      nowMs: Date.UTC(2026, 1, 24, 10, 0, 0, 0),
    });
    expect(before).toMatchObject({ allowed: true, effective_daily_token_limit: 100, current_tokens_today: 0 });

    await recordUsageFact(docStore, {
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      resource_id: endpointId,
      end_user_id: userId,
      requests: 1,
      tokens_total: 100,
      result: 'ok',
      timestamp: new Date(Date.UTC(2026, 1, 24, 11, 0, 0, 0)).toISOString(),
    });

    const after = await checkMemberEndpointDailyTokenQuota({
      docStore,
      workspaceId,
      projectId,
      endpointId,
      userId,
      nowMs: Date.UTC(2026, 1, 24, 12, 0, 0, 0),
    });
    expect(after).toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
      effective_daily_token_limit: 100,
      current_tokens_today: 100,
    });
  });
});
