import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createGovernancePolicyOverride,
  listGovernancePolicyOverrides,
  updateGovernancePolicyOverrideDecision,
} from './governance-policy-override-store.js';

describe('governance-policy-override-store', () => {
  afterEach(() => {
    delete process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
  });

  it('uses tenant-prefixed collections for workspace-scoped overrides', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-override-tenant-registry-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          workspace_admin: 'owner@example.com',
          tenant: {
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
            key_prefix: 'ws_default:',
          },
        },
      ]),
      'utf-8',
    );

    const store = new InMemoryJsonDocStore();
    const created = await createGovernancePolicyOverride(store, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      reportName: 'report_a',
      incidentId: 'incident_1',
      issueId: 'issue_1',
      issueSource: 'execution',
      issueMessage: 'issue message',
      reasonCategory: 'approved_exception',
      reason: 'approved for test',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdByUserId: 'user_1',
      createdByName: 'User One',
    });

    expect(await store.list('governance_policy_overrides', {})).toHaveLength(0);
    expect(await store.list('ws_default_governance_policy_overrides', {})).toHaveLength(1);

    const listed = await listGovernancePolicyOverrides(store, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      reportName: 'report_a',
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const updated = await updateGovernancePolicyOverrideDecision(store, {
      overrideId: created.id,
      status: 'approved',
      decidedByUserId: 'approver_1',
      decidedByName: 'Approver One',
    });
    expect(updated?.status).toBe('approved');
    expect((await store.list('ws_default_governance_policy_overrides', {}))[0]?.status).toBe('approved');

    rmSync(dir, { recursive: true, force: true });
  });
});
