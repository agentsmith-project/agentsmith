import type http from 'node:http';

interface BufferedTaskSseEvent {
  id: string;
  payload: unknown;
}

interface NotebookTaskSseClient {
  buffered: boolean;
  pending: BufferedTaskSseEvent[];
  res: http.ServerResponse;
}

const TASK_EVENT_CLIENTS = new Map<string, Map<http.ServerResponse, NotebookTaskSseClient>>();
const TASK_EVENT_SEQUENCE_BY_TASK = new Map<string, number>();
const TASK_EVENT_HISTORY_BY_TASK = new Map<string, BufferedTaskSseEvent[]>();
const MAX_TASK_SSE_EVENTS_PER_TASK = Math.max(100, Number(process.env.NOTEBOOK_SSE_HISTORY_MAX_EVENTS ?? '2000') || 2000);

function getTaskEventHistory(taskId: string): BufferedTaskSseEvent[] {
  let existing = TASK_EVENT_HISTORY_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    TASK_EVENT_HISTORY_BY_TASK.set(taskId, existing);
  }
  return existing;
}

function appendTaskEventHistory(taskId: string, event: BufferedTaskSseEvent): void {
  const history = getTaskEventHistory(taskId);
  history.push(event);
  if (history.length <= MAX_TASK_SSE_EVENTS_PER_TASK) return;
  history.splice(0, history.length - MAX_TASK_SSE_EVENTS_PER_TASK);
}

export function writeNotebookTaskSseEvent(res: http.ServerResponse, payload: unknown, eventId?: string): void {
  if (eventId) {
    res.write(`id: ${eventId}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getTaskEventClients(taskId: string): Map<http.ServerResponse, NotebookTaskSseClient> {
  let existing = TASK_EVENT_CLIENTS.get(taskId);
  if (!existing) {
    existing = new Map<http.ServerResponse, NotebookTaskSseClient>();
    TASK_EVENT_CLIENTS.set(taskId, existing);
  }
  return existing;
}

export function emitNotebookTaskEvent(taskId: string, payload: unknown): void {
  const seq = (TASK_EVENT_SEQUENCE_BY_TASK.get(taskId) ?? 0) + 1;
  TASK_EVENT_SEQUENCE_BY_TASK.set(taskId, seq);
  const sseEventId = `${taskId}:${seq}`;
  const event = { id: sseEventId, payload };
  appendTaskEventHistory(taskId, event);
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  if (!clients || clients.size === 0) return;
  for (const [res, client] of clients.entries()) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      continue;
    }
    if (client.buffered) {
      client.pending.push(event);
      continue;
    }
    try {
      writeNotebookTaskSseEvent(res, payload, sseEventId);
    } catch {
      clients.delete(res);
    }
  }
  if (clients.size === 0) {
    TASK_EVENT_CLIENTS.delete(taskId);
  }
}

function matchesEventReplayCursor(eventId: string, lastEventId: string): boolean {
  if (eventId === lastEventId) return true;
  const suffix = eventId.split(':').at(-1);
  return Boolean(suffix) && suffix === lastEventId;
}

export function replayBufferedNotebookTaskEvents(
  res: http.ServerResponse,
  taskId: string,
  lastEventId: string | null,
): {
  status: 'skipped' | 'missing' | 'replayed';
  replayed_count: number;
} {
  if (!lastEventId) {
    return {
      status: 'skipped',
      replayed_count: 0,
    };
  }
  const history = TASK_EVENT_HISTORY_BY_TASK.get(taskId);
  if (!history || history.length === 0) {
    return {
      status: 'missing',
      replayed_count: 0,
    };
  }
  const idx = history.findIndex((item) => matchesEventReplayCursor(item.id, lastEventId));
  if (idx < 0) {
    return {
      status: 'missing',
      replayed_count: 0,
    };
  }
  const replayItems = history.slice(idx + 1);
  for (const item of replayItems) {
    writeNotebookTaskSseEvent(res, item.payload, item.id);
  }
  return {
    status: 'replayed',
    replayed_count: replayItems.length,
  };
}

export function subscribeNotebookTaskEvents(
  taskId: string,
  res: http.ServerResponse,
  options?: {
    buffered?: boolean;
  },
): void {
  const clients = getTaskEventClients(taskId);
  clients.set(res, {
    res,
    buffered: options?.buffered === true,
    pending: [],
  });
}

export function activateNotebookTaskEventSubscription(taskId: string, res: http.ServerResponse): void {
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  const client = clients?.get(res);
  if (!client) return;
  if (res.writableEnded || res.destroyed) {
    clients?.delete(res);
    if (clients && clients.size === 0) {
      TASK_EVENT_CLIENTS.delete(taskId);
    }
    return;
  }
  client.buffered = false;
  if (client.pending.length === 0) {
    return;
  }
  const pending = client.pending.splice(0, client.pending.length);
  for (const item of pending) {
    writeNotebookTaskSseEvent(res, item.payload, item.id);
  }
}

export function unsubscribeNotebookTaskEvents(taskId: string, res: http.ServerResponse): void {
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  clients?.delete(res);
  if (clients && clients.size === 0) {
    TASK_EVENT_CLIENTS.delete(taskId);
  }
}

export function clearNotebookTaskEventState(taskId: string): void {
  TASK_EVENT_CLIENTS.delete(taskId);
  TASK_EVENT_HISTORY_BY_TASK.delete(taskId);
  TASK_EVENT_SEQUENCE_BY_TASK.delete(taskId);
}

export function getNotebookTaskSseBrokerStats(): {
  client_count: number;
  history_task_count: number;
  max_events_per_task: number;
} {
  const clientCount = [...TASK_EVENT_CLIENTS.values()].reduce((acc, clients) => acc + clients.size, 0);
  return {
    client_count: clientCount,
    history_task_count: TASK_EVENT_HISTORY_BY_TASK.size,
    max_events_per_task: MAX_TASK_SSE_EVENTS_PER_TASK,
  };
}
