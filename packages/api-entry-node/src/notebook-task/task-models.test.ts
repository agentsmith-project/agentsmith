import { describe, expect, expectTypeOf, it } from 'vitest';
import { normalizeTaskRecord, type TaskRecord } from './task-models.js';

function buildTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = '2026-03-18T12:00:00.000Z';
  return {
    id: 'task_model_1',
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    owner_user_id: 'user_1',
    title: 'Task model',
    status: 'active',
    attached_inputs: [],
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    ...overrides,
  };
}

describe('TaskRecord active model', () => {
  it('does not carry legacy agent fields in the active TypeScript shape', () => {
    expectTypeOf<TaskRecord>().not.toHaveProperty('agent_id');
    expectTypeOf<TaskRecord>().not.toHaveProperty('agent_name');
  });

  it('strips legacy agent fields at the persisted-record boundary', () => {
    const pollutedTask = {
      ...buildTaskRecord(),
      agent_id: 'agent_legacy_polluted',
      agent_name: 'Legacy Polluted Agent',
    } as unknown as TaskRecord;

    const normalized = normalizeTaskRecord(pollutedTask);

    expect(normalized).not.toHaveProperty('agent_id');
    expect(normalized).not.toHaveProperty('agent_name');
  });
});
