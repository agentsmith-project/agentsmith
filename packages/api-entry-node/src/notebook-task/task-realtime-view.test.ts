import { afterEach, describe, expect, it } from 'vitest';
import { mapTaskMessagesForExecution } from './task-realtime-view.js';
import { MESSAGES_BY_TASK } from './task-runtime-state.js';

describe('mapTaskMessagesForExecution', () => {
  afterEach(() => {
    MESSAGES_BY_TASK.clear();
  });

  it('only forwards the latest non-empty user turn for resumed notebook execution', () => {
    MESSAGES_BY_TASK.set('task_1', [
      {
        id: 'msg_user_1',
        task_id: 'task_1',
        role: 'user',
        content: 'first user turn',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_agent_1',
        task_id: 'task_1',
        role: 'agent',
        content: 'first assistant reply',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_user_2',
        task_id: 'task_1',
        role: 'user',
        content: 'second user turn',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_agent_pending',
        task_id: 'task_1',
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      },
    ]);

    expect(mapTaskMessagesForExecution('task_1', 'msg_agent_pending')).toEqual([
      {
        role: 'user',
        content: 'second user turn',
      },
    ]);
  });

  it('returns no execution messages when there is no prior user turn', () => {
    MESSAGES_BY_TASK.set('task_2', [
      {
        id: 'msg_agent_pending',
        task_id: 'task_2',
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      },
    ]);

    expect(mapTaskMessagesForExecution('task_2', 'msg_agent_pending')).toEqual([]);
  });
});
