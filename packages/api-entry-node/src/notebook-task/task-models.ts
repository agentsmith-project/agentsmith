import { createHash, randomUUID } from 'node:crypto';

export interface TaskRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  prompt?: string;
  task_home_segment: string;
  source?: 'runner_test';
  runner_test?: true;
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  file_library_binding_generation?: number;
  runtime_writable_affordance?: 'task_internal_home' | 'files_update';
  bound_runner_id?: string;
  bound_runner_kind?: 'managed' | 'developer';
  runner_binding_source?: 'default_managed' | 'explicit';
  bound_at?: string;
  bound_by_user_id?: string;
  status: 'active' | 'archived';
  deletion_state?: 'deleting' | 'deleted';
  deleting_started_at?: string;
  deleted_at?: string;
  delete_correlation_id?: string;
  attached_inputs: TaskInputRefRecord[];
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

type PersistedTaskRecordWithUnsupportedLegacyFields = TaskRecord & {
  agent_id?: unknown;
  agent_name?: unknown;
  runner_id?: unknown;
  runner_selection?: unknown;
  agent_runner_id?: unknown;
};

export type PublicTaskRecord = Omit<
  TaskRecord,
  'deletion_state' | 'deleting_started_at' | 'deleted_at' | 'delete_correlation_id'
>;

export function sanitizeTaskRecordForActiveModel(input: TaskRecord): PublicTaskRecord {
  const {
    agent_id: _unsupportedLegacyAgentId,
    agent_name: _unsupportedLegacyAgentName,
    runner_id: _unsupportedLegacyRunnerId,
    runner_selection: _unsupportedLegacyRunnerSelection,
    agent_runner_id: _unsupportedLegacyAgentRunnerId,
    deletion_state: _internalDeletionState,
    deleting_started_at: _internalDeletingStartedAt,
    deleted_at: _internalDeletedAt,
    delete_correlation_id: _internalDeleteCorrelationId,
    ...activeRecord
  } = input as PersistedTaskRecordWithUnsupportedLegacyFields;
  return activeRecord;
}

export interface TaskListItem extends PublicTaskRecord {
  agent_presence?: 'online' | 'offline' | 'managed' | 'unknown';
  run_state?: 'running' | 'cancelling' | 'terminating' | 'finalizing' | 'idle';
  lifecycle_status?: 'active' | 'archived';
  active_run?: {
    id: string;
    status: 'queued' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'canceled';
    runner_id: string;
    source?: 'runner_test';
    runner_test?: true;
    started_at?: string;
    finished_at?: string;
  };
  active_run_started_at?: string;
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

const DIRECT_TASK_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TASK_HOME_HASH_PREFIX = 'taskhash-';

export interface TaskHomePaths {
  taskHomePath: string;
  workspacePath: string;
  artifactsPath: string;
  libraryRootPath: '.';
}

export function buildTaskHomeSegment(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
}): string {
  const taskId = input.taskId.trim();
  const canUseTaskIdDirectly = DIRECT_TASK_HOME_SEGMENT_PATTERN.test(taskId)
    && taskId !== '.'
    && taskId !== '..'
    && !taskId.startsWith(TASK_HOME_HASH_PREFIX);
  if (canUseTaskIdDirectly) return taskId;
  const hash = createHash('sha256')
    .update(`${input.workspaceId}/${input.projectId}/${input.taskId}`)
    .digest('hex')
    .slice(0, 32);
  return `${TASK_HOME_HASH_PREFIX}${hash}`;
}

export function resolveTaskHomeSegment(input: {
  workspace_id: string;
  project_id: string;
  id: string;
  task_home_segment?: string;
}): string {
  const persisted = input.task_home_segment?.trim();
  if (persisted) return persisted;
  return buildTaskHomeSegment({
    workspaceId: input.workspace_id,
    projectId: input.project_id,
    taskId: input.id,
  });
}

export function buildTaskHomePaths(segment: string): TaskHomePaths {
  const taskHomePath = `/home/${segment}`;
  const workspacePath = `${taskHomePath}/workspace`;
  return {
    taskHomePath,
    workspacePath,
    artifactsPath: `${workspacePath}/.artifacts`,
    libraryRootPath: '.',
  };
}

export function findTaskHomeSegmentConflict(
  tasks: Array<{
    id: string;
    workspace_id: string;
    project_id: string;
    task_home_segment?: string;
  }>,
  input: {
    taskId: string;
    taskHomeSegment: string;
  },
): { id: string } | null {
  return tasks.find((task) => (
    task.id !== input.taskId
    && resolveTaskHomeSegment(task) === input.taskHomeSegment
  )) ?? null;
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
  const activeRecord = sanitizeTaskRecordForActiveModel(input);
  return {
    ...activeRecord,
    task_home_segment: resolveTaskHomeSegment(activeRecord),
    attached_inputs: attachedInputs,
  };
}
