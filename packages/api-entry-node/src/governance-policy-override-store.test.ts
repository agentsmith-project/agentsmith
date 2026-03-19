import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';

import {
  createGovernancePolicyOverride,
  listGovernancePolicyOverrides,
  updateGovernancePolicyOverrideDecision,
} from './governance-policy-override-store.js';

describe('governance-policy-override-store', () => {
  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  it('uses tenant-prefixed collections for workspace-scoped overrides', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
        substrate_label: 'primary',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

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
  });
});
