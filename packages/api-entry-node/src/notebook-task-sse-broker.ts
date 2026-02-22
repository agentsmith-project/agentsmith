import type http from 'node:http';

interface BufferedTaskSseEvent {
  id: string;
  payload: unknown;
}

const TASK_EVENT_CLIENTS = new Map<string, Set<http.ServerResponse>>();
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

export function emitNotebookTaskEvent(taskId: string, payload: unknown): void {
  const seq = (TASK_EVENT_SEQUENCE_BY_TASK.get(taskId) ?? 0) + 1;
  TASK_EVENT_SEQUENCE_BY_TASK.set(taskId, seq);
  const sseEventId = `${taskId}:${seq}`;
  appendTaskEventHistory(taskId, { id: sseEventId, payload });
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      continue;
    }
    try {
      writeNotebookTaskSseEvent(client, payload, sseEventId);
    } catch {
      clients.delete(client);
    }
  }
  if (clients.size === 0) {
    TASK_EVENT_CLIENTS.delete(taskId);
  }
}

export function replayBufferedNotebookTaskEvents(
  res: http.ServerResponse,
  taskId: string,
  lastEventId: string | null,
): void {
  if (!lastEventId) return;
  const history = TASK_EVENT_HISTORY_BY_TASK.get(taskId);
  if (!history || history.length === 0) return;
  const idx = history.findIndex((item) => item.id === lastEventId);
  const replayItems = idx >= 0 ? history.slice(idx + 1) : history;
  for (const item of replayItems) {
    writeNotebookTaskSseEvent(res, item.payload, item.id);
  }
}

export function subscribeNotebookTaskEvents(taskId: string, res: http.ServerResponse): void {
  let clients = TASK_EVENT_CLIENTS.get(taskId);
  if (!clients) {
    clients = new Set<http.ServerResponse>();
    TASK_EVENT_CLIENTS.set(taskId, clients);
  }
  clients.add(res);
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
  const clientCount = [...TASK_EVENT_CLIENTS.values()].reduce((acc, set) => acc + set.size, 0);
  return {
    client_count: clientCount,
    history_task_count: TASK_EVENT_HISTORY_BY_TASK.size,
    max_events_per_task: MAX_TASK_SSE_EVENTS_PER_TASK,
  };
}

