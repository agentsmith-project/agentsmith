import type { NodeApiDeps } from '../node-api-deps.js';
import { resolveWorkspaceScopedCollection } from '../workspace-tenant-collections.js';
import {
  asObject,
  buildId,
  normalizeTaskRecord,
  type TaskArtifactRecord,
  type TaskMessageRecord,
  type TaskRecord,
} from './task-models.js';
import {
  ARTIFACTS_BY_TASK,
  findTaskById,
  getTaskArtifacts,
  MESSAGES_BY_TASK,
  projectKey,
  TASKS_BY_PROJECT,
  nowIso,
} from './task-runtime-state.js';

const TASKS_COLLECTION = 'notebook_tasks';
const TASK_MESSAGES_COLLECTION = 'notebook_task_messages';
const TASK_ARTIFACTS_COLLECTION = 'notebook_task_artifacts';

export function notebookTasksCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASKS_COLLECTION, workspaceId);
}

export function notebookTaskMessagesCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASK_MESSAGES_COLLECTION, workspaceId);
}

export function notebookTaskArtifactsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASK_ARTIFACTS_COLLECTION, workspaceId);
}

export async function loadProjectTasks(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
): Promise<TaskRecord[]> {
  const key = projectKey(workspaceId, projectId);
  const cached = TASKS_BY_PROJECT.get(key);
  if (cached) return cached;
  const listed = await deps.docStore.list<TaskRecord>(notebookTasksCollection(workspaceId), {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  const sorted = listed.map((item) => normalizeTaskRecord(item)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  TASKS_BY_PROJECT.set(key, sorted);
  return sorted;
}

export async function loadTaskMessages(deps: NodeApiDeps, taskId: string): Promise<TaskMessageRecord[]> {
  const cached = MESSAGES_BY_TASK.get(taskId);
  if (cached) return cached;
  const task = findTaskById(taskId);
  if (!task) return [];
  const listed = await deps.docStore.list<TaskMessageRecord>(notebookTaskMessagesCollection(task.workspace_id), { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  MESSAGES_BY_TASK.set(taskId, sorted);
  return sorted;
}

export async function loadTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<TaskArtifactRecord[]> {
  const cached = ARTIFACTS_BY_TASK.get(taskId);
  if (cached) return cached;
  const task = findTaskById(taskId);
  if (!task) return [];
  const listed = await deps.docStore.list<TaskArtifactRecord>(notebookTaskArtifactsCollection(task.workspace_id), { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  ARTIFACTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

export async function createTaskArtifactRecord(
  deps: NodeApiDeps,
  args: {
    taskId: string;
    payload: {
      artifact_type: 'text' | 'image' | 'file' | 'other';
      task_relative_path: string;
      title?: string;
      content?: string;
      thumbnail_url?: string;
      file_size?: number;
      mime_type?: string;
      filename?: string;
    };
  },
): Promise<TaskArtifactRecord> {
  const { taskId, payload } = args;
  const task = findTaskById(taskId);
  if (!task) {
    throw new Error('task_not_found');
  }
  const normalizedTitle = payload.title?.trim() || payload.filename?.trim() || undefined;
  const normalizedPath = payload.task_relative_path.trim();
  const items = getTaskArtifacts(taskId);
  const existing = items.find((item) => {
    if (item.type !== payload.artifact_type) return false;
    const samePath = typeof item.task_relative_path === 'string'
      ? item.task_relative_path === normalizedPath
      : (item.title?.trim() || '') === (normalizedTitle ?? '');
    if (!samePath) return false;
    if ((item.file_size ?? null) !== (typeof payload.file_size === 'number' ? payload.file_size : null)) return false;
    if ((item.mime_type ?? null) !== (typeof payload.mime_type === 'string' ? payload.mime_type : null)) return false;
    if ((item.content ?? null) !== (typeof payload.content === 'string' ? payload.content : null)) return false;
    if ((item.thumbnail_url ?? null) !== (typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url : null)) return false;
    return true;
  });
  if (existing) return existing;

  const artifact: TaskArtifactRecord = {
    id: buildId('artifact'),
    task_id: taskId,
    type: payload.artifact_type,
    ...(normalizedPath ? { task_relative_path: normalizedPath } : {}),
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
    ...(typeof payload.thumbnail_url === 'string' ? { thumbnail_url: payload.thumbnail_url } : {}),
    ...(typeof payload.file_size === 'number' ? { file_size: payload.file_size } : {}),
    ...(typeof payload.mime_type === 'string' ? { mime_type: payload.mime_type } : {}),
    created_at: nowIso(),
  };
  items.push(artifact);
  await deps.docStore.upsert<TaskArtifactRecord>(notebookTaskArtifactsCollection(task.workspace_id), artifact.id, artifact);
  return artifact;
}

export async function deleteTaskMessages(deps: NodeApiDeps, taskId: string): Promise<void> {
  const task = findTaskById(taskId);
  if (!task) return;
  const collection = notebookTaskMessagesCollection(task.workspace_id);
  const existing = await deps.docStore.list<TaskMessageRecord>(collection, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(collection, item.id)));
}

export async function deleteTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<void> {
  const task = findTaskById(taskId);
  if (!task) return;
  const collection = notebookTaskArtifactsCollection(task.workspace_id);
  const existing = await deps.docStore.list<TaskArtifactRecord>(collection, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(collection, item.id)));
}
