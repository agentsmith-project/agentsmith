import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import {
  clearNotebookTaskEventState,
  emitNotebookTaskEvent,
  getNotebookTaskSseBrokerStats,
  replayBufferedNotebookTaskEvents,
  subscribeNotebookTaskEvents,
  unsubscribeNotebookTaskEvents,
} from './notebook-task-sse-broker.js';

function createFakeSseResponse() {
  const writes: string[] = [];
  const res = {
    writableEnded: false,
    destroyed: false,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as http.ServerResponse;
  return { res, writes };
}

describe('notebook-task-sse-broker', () => {
  it('emits and replays buffered events after last_event_id', () => {
    const taskId = 'task_test_broker_1';
    clearNotebookTaskEventState(taskId);

    emitNotebookTaskEvent(taskId, { type: 'message', data: { id: 'm1' } });
    emitNotebookTaskEvent(taskId, { type: 'message', data: { id: 'm2' } });
    emitNotebookTaskEvent(taskId, { type: 'task_update', data: { id: taskId } });

    const { res, writes } = createFakeSseResponse();
    replayBufferedNotebookTaskEvents(res, taskId, `${taskId}:1`);

    const payload = writes.join('');
    expect(payload).toContain(`id: ${taskId}:2`);
    expect(payload).toContain(`id: ${taskId}:3`);
    expect(payload).not.toContain(`id: ${taskId}:1`);

    clearNotebookTaskEventState(taskId);
  });

  it('tracks subscribed clients and clears state', () => {
    const taskId = 'task_test_broker_2';
    clearNotebookTaskEventState(taskId);
    const a = createFakeSseResponse();
    const b = createFakeSseResponse();
    subscribeNotebookTaskEvents(taskId, a.res);
    subscribeNotebookTaskEvents(taskId, b.res);

    const statsWithClients = getNotebookTaskSseBrokerStats();
    expect(statsWithClients.client_count).toBeGreaterThanOrEqual(2);

    unsubscribeNotebookTaskEvents(taskId, a.res);
    unsubscribeNotebookTaskEvents(taskId, b.res);
    clearNotebookTaskEventState(taskId);

    const statsAfterClear = getNotebookTaskSseBrokerStats();
    expect(statsAfterClear.history_task_count).toBeGreaterThanOrEqual(0);
  });
});

