import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';

import type { NodeApiDeps } from './node-api-deps.js';
import {
  deleteTaskTraceEvents,
  loadTaskTraceEvents,
  storeTaskTraceEvent,
  type TaskTraceEventRecord,
} from './notebook-trace-store.js';

describe('notebook-trace-store', () => {
  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  it('uses tenant-prefixed collections for task trace events', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        substrate_label: 'primary',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

    const docStore = new InMemoryJsonDocStore();
    const deps = { docStore } as unknown as NodeApiDeps;
    const event: TaskTraceEventRecord = {
      id: 'trace_1',
      task_id: 'task_1',
      message_id: 'msg_1',
      run_id: 'run_1',
      seq: 1,
      at: new Date().toISOString(),
      category: 'lifecycle',
      name: 'run.lifecycle',
      summary: 'started',
      phase: 'start',
      status: 'running',
    };

    await storeTaskTraceEvent(deps, 'ws_default', 'task_1', event);

    expect(await docStore.list('agent_task_trace_events', {})).toHaveLength(0);
    expect(await docStore.list('notebook_task_trace_events', {})).toHaveLength(0);
    expect(await docStore.list('ws_default_agent_task_trace_events', {})).toHaveLength(1);
    expect(await loadTaskTraceEvents(deps, 'ws_default', 'task_1')).toHaveLength(1);

    await deleteTaskTraceEvents(deps, 'ws_default', 'task_1');
    expect(await docStore.list('ws_default_agent_task_trace_events', {})).toHaveLength(0);
  });
});
