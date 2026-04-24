import { randomUUID } from 'node:crypto';

export interface TaskRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_id: string;
  agent_name: string;
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  status: 'active' | 'archived';
  attached_inputs: TaskInputRefRecord[];
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface TaskListItem extends TaskRecord {
  agent_presence?: 'online' | 'offline' | 'managed' | 'unknown';
  run_state?: 'running' | 'cancelling' | 'terminating' | 'finalizing' | 'idle';
  stop_mode?: 'cancel' | 'terminate';
  can_escalate?: boolean;
  escalation_reason?: 'already_terminating' | 'unmanaged_runner' | 'unsupported_runner';
  stats?: {
    user_turn_count: number;
    message_count: number;
    artifact_count: number;
    attached_input_count: number;
  };
}

export type TaskInputRefRecord =
  | {
      id: string;
      kind: 'library_object';
      library_id: string;
      key: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      task_relative_path?: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      name?: string;
      imported_library_id?: string;
      imported_key?: string;
      content_type?: string;
      size_bytes?: number;
    };

export interface TaskMessageRecord {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
  turn_id?: string;
}

export interface TaskArtifactRecord {
  id: string;
  task_id: string;
  type: 'text' | 'image' | 'file' | 'other';
  task_relative_path?: string;
  title?: string;
  content?: string;
  thumbnail_url?: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
}

export function buildId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

export function readTaskInputRefs(raw: unknown): TaskInputRefRecord[] {
  if (!Array.isArray(raw)) return [];
  const results: TaskInputRefRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const obj = asObject(item);
    const kind = typeof obj.kind === 'string' ? obj.kind.trim() : '';
    if (kind === 'library_object') {
      const libraryId = typeof obj.library_id === 'string' ? obj.library_id.trim() : '';
      const key = typeof obj.key === 'string' ? obj.key.trim() : '';
      if (!libraryId || !key) continue;
      const dedupeKey = `library_object:${libraryId}:${key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'library_object',
        library_id: libraryId,
        key,
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
      continue;
    }
    if (kind === 'artifact') {
      const taskId = typeof obj.task_id === 'string' ? obj.task_id.trim() : '';
      const artifactId = typeof obj.artifact_id === 'string' ? obj.artifact_id.trim() : '';
      if (!taskId || !artifactId) continue;
      const dedupeKey = `artifact:${taskId}:${artifactId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'artifact',
        task_id: taskId,
        artifact_id: artifactId,
        ...(typeof obj.task_relative_path === 'string' && obj.task_relative_path.trim()
          ? { task_relative_path: obj.task_relative_path.trim() }
          : {}),
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
      continue;
    }
    if (kind === 'url') {
      const url = typeof obj.url === 'string' ? obj.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) continue;
      const dedupeKey = `url:${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'url',
        url,
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.imported_library_id === 'string' && obj.imported_library_id.trim()
          ? { imported_library_id: obj.imported_library_id.trim() }
          : {}),
        ...(typeof obj.imported_key === 'string' && obj.imported_key.trim()
          ? { imported_key: obj.imported_key.trim() }
          : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
    }
  }
  return results;
}

export function normalizeTaskRecord(input: TaskRecord): TaskRecord {
  const raw = asObject(input);
  const attachedInputs = readTaskInputRefs(raw.attached_inputs);
  return {
    ...input,
    attached_inputs: attachedInputs,
  };
}
