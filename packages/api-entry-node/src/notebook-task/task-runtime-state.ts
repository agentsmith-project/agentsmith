import type {
  TaskArtifactRecord,
  TaskMessageRecord,
  TaskRecord,
} from './task-models.js';

export const TASKS_BY_PROJECT = new Map<string, TaskRecord[]>();
export const MESSAGES_BY_TASK = new Map<string, TaskMessageRecord[]>();
export const ARTIFACTS_BY_TASK = new Map<string, TaskArtifactRecord[]>();
export const ACTIVE_RUNS_BY_TASK = new Set<string>();
export const ACTIVE_RUN_CANCEL_BY_TASK = new Map<
  string,
  { runId: string; requestId: string; cancel: () => void; requestCancel: () => void }
>();
export const ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK = new Map<string, { runId: string; requestedAt: string }>();

export function projectKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getTasks(workspaceId: string, projectId: string): TaskRecord[] {
  const key = projectKey(workspaceId, projectId);
  let existing = TASKS_BY_PROJECT.get(key);
  if (!existing) {
    existing = [];
    TASKS_BY_PROJECT.set(key, existing);
  }
  return existing;
}

export function getTaskMessages(taskId: string): TaskMessageRecord[] {
  let existing = MESSAGES_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    MESSAGES_BY_TASK.set(taskId, existing);
  }
  return existing;
}

export function getTaskArtifacts(taskId: string): TaskArtifactRecord[] {
  let existing = ARTIFACTS_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    ARTIFACTS_BY_TASK.set(taskId, existing);
  }
  return existing;
}

export function findTask(workspaceId: string, projectId: string, taskId: string): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((item) => item.id === taskId);
}

export function findTaskById(taskId: string): TaskRecord | undefined {
  for (const tasks of TASKS_BY_PROJECT.values()) {
    const found = tasks.find((item) => item.id === taskId);
    if (found) return found;
  }
  return undefined;
}

export function updateTaskActivity(task: TaskRecord): void {
  const now = nowIso();
  task.last_activity_at = now;
  task.updated_at = now;
}

export function readSortValue(task: TaskRecord, sortBy: string): string {
  if (sortBy === 'created_at') return task.created_at;
  if (sortBy === 'updated_at') return task.updated_at;
  if (sortBy === 'last_activity_at') return task.last_activity_at;
  return task.last_activity_at;
}

export function sanitizePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}
