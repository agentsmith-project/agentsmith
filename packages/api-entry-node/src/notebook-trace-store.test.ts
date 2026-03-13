import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { NodeApiDeps } from './node-api-deps.js';
import {
  deleteTaskTraceEvents,
  loadTaskTraceEvents,
  storeTaskTraceEvent,
  type TaskTraceEventRecord,
} from './notebook-trace-store.js';

describe('notebook-trace-store', () => {
  afterEach(() => {
    delete process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
  });

  it('uses tenant-prefixed collections for task trace events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-notebook-trace-registry-'));
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

    expect(await docStore.list('notebook_task_trace_events', {})).toHaveLength(0);
    expect(await docStore.list('ws_default_notebook_task_trace_events', {})).toHaveLength(1);
    expect(await loadTaskTraceEvents(deps, 'ws_default', 'task_1')).toHaveLength(1);

    await deleteTaskTraceEvents(deps, 'ws_default', 'task_1');
    expect(await docStore.list('ws_default_notebook_task_trace_events', {})).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });
});
