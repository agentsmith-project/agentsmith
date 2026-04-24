import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import {
  activateNotebookTaskEventSubscription,
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

  it('reports missing replay cursors instead of replaying unrelated tail history', () => {
    const taskId = 'task_test_broker_missing';
    clearNotebookTaskEventState(taskId);

    emitNotebookTaskEvent(taskId, { type: 'message', data: { id: 'm1' } });
    emitNotebookTaskEvent(taskId, { type: 'task_update', data: { id: taskId } });

    const { res, writes } = createFakeSseResponse();
    const replay = replayBufferedNotebookTaskEvents(res, taskId, `${taskId}:999`);

    expect(replay).toEqual({
      status: 'missing',
      replayed_count: 0,
    });
    expect(writes).toEqual([]);

    clearNotebookTaskEventState(taskId);
  });

  it('buffers live events until activation so the initial snapshot stays first', () => {
    const taskId = 'task_test_broker_buffered';
    clearNotebookTaskEventState(taskId);

    const { res, writes } = createFakeSseResponse();
    subscribeNotebookTaskEvents(taskId, res, { buffered: true });

    emitNotebookTaskEvent(taskId, { type: 'message', data: { id: 'm_live' } });
    expect(writes).toEqual([]);

    res.write('data: {"type":"task_update","data":{"id":"task_test_broker_buffered"}}\n\n');
    activateNotebookTaskEventSubscription(taskId, res);

    const payload = writes.join('');
    expect(payload.indexOf('"type":"task_update"')).toBeGreaterThanOrEqual(0);
    expect(payload.indexOf('m_live')).toBeGreaterThan(payload.indexOf('"type":"task_update"'));
    expect(payload).toContain(`id: ${taskId}:1`);

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
