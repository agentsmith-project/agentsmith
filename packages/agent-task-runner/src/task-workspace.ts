import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';

const RETRYABLE_TASK_WORKSPACE_WRITE_FAILURE_CODES = new Set(['EIO', 'ESTALE', 'ENOTCONN']);
const TASK_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type AgentTaskRunnerMode = 'developer' | 'managed_local' | 'managed_platform';
export type TaskRuntimeProfile = 'managed' | 'developer';
export type TaskWorkspaceBindingMode = 'file_library' | 'pre_mounted';
export type TaskHomeBindingMode = 'pre_mounted';
export type TaskWorkspaceHolderKind = 'runner_workspace' | 'terminal_session' | 'notebook_run';

export type TaskWorkspaceLease = {
  mountPath: string;
  leaseId: string;
  revision: number;
  holderId: string;
  taskId: string;
  fileLibraryId: string;
  taskHomeSegment: string;
  bindingGeneration: string;
  leaseEpoch: string;
  holderKind: TaskWorkspaceHolderKind;
  issuedAt: string;
  expiresAt: string;
};

type TaskWorkspaceAccessReleaseFence = Pick<
  TaskWorkspaceLease,
  'holderId' | 'fileLibraryId' | 'bindingGeneration' | 'leaseEpoch'
>;

type FileLibraryWorkspaceExecutionContext = {
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  api_base?: string;
  task_home_path?: string;
  workspace_path?: string;
  artifacts_path?: string;
  library_root_path?: string;
  execution_ticket?: string;
  workspace_binding_mode?: TaskWorkspaceBindingMode;
  runtime_profile?: TaskRuntimeProfile;
  task_home_segment?: string;
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
};

type TaskWorkspaceHolderFence = {
  holderId: string;
  holderKind: TaskWorkspaceHolderKind;
  bindingGeneration: string;
  leaseEpoch: string;
  issuedAt: string;
  expiresAt: string;
};

type TaskWorkspaceIdentity = {
  taskId: string;
  fileLibraryId: string;
  workspaceBindingMode: TaskWorkspaceBindingMode;
  runtimeProfile: TaskRuntimeProfile;
  taskHomeSegment: string;
};

export type TaskHomeBindingPayload = {
  binding_id: string;
  provider: 'afscp';
  mode: TaskHomeBindingMode;
  task_id: string;
  file_library_id: string;
  task_home_segment: string;
  generation: string;
  holder: {
    holder_id: string;
    holder_kind: TaskWorkspaceHolderKind;
    binding_generation: string;
    lease_epoch: string;
    issued_at: string;
    expires_at: string;
  };
  paths: {
    task_home_path: string;
    workspace_path: string;
    artifacts_path: string;
    library_root_path: '.';
  };
};

export type TaskWorkspaceAccessPayload = {
  task_home_binding: TaskHomeBindingPayload;
};

export type TaskWorkspacePaths = {
  mode: AgentTaskRunnerMode;
  runtimeProfile: TaskRuntimeProfile;
  taskHomeSegment: string;
  taskHome: string;
  workspaceDir: string;
  visibleRoot: string;
  libraryRoot: '.';
  mountRoot: string;
  taskRoot: string;
  runtimeRoot: string;
  homeDir: string;
  codexDir: string;
  artifactsDir: string;
  mbosDir: string;
  skillsDir: string;
};

const RAW_WORKSPACE_ACCESS_FIELDS = [
  'metadata_url',
  'storage_bucket_url',
  'recommended_mount_path',
  'recommended_mount_commands',
  'filesystem_name',
  'workspace_dir_name',
  'mount_command',
  'mount_commands',
];

function sanitizeWorkspacePath(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function sanitizePathPart(input: string | null | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || fallback;
}

function normalizeRequiredString(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(errorCode);
  }
  return value.trim();
}

function normalizeTaskHomeSegment(value: unknown, errorCode: string): string {
  const segment = normalizeRequiredString(value, errorCode);
  if (
    !TASK_HOME_SEGMENT_PATTERN.test(segment)
    || segment === '.'
    || segment === '..'
    || segment.split(/[\\/]+/).some((part) => part === '..')
    || normalize(segment) !== segment
  ) {
    throw new Error(errorCode);
  }
  return segment;
}

function normalizeWorkspaceBindingMode(value: unknown, errorCode: string): TaskWorkspaceBindingMode {
  if (value === 'file_library' || value === 'pre_mounted') return value;
  throw new Error(errorCode);
}

function normalizeRuntimeProfile(value: unknown, errorCode: string): TaskRuntimeProfile {
  if (value === 'managed' || value === 'developer') return value;
  throw new Error(errorCode);
}

function normalizeHolderKind(value: unknown, errorCode: string): TaskWorkspaceHolderKind {
  switch (value) {
    case 'runner_workspace':
    case 'terminal_session':
    case 'notebook_run':
      return value;
    default:
      throw new Error(errorCode);
  }
}

function assertIsoTimestamp(value: string, errorCode: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(errorCode);
  }
}

function hasOwnField(input: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function assertNoRawWorkspaceAccessFields(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('task_workspace_access_invalid');
  }
  for (const field of RAW_WORKSPACE_ACCESS_FIELDS) {
    if (hasOwnField(payload, field)) {
      throw new Error(`task_workspace_access_raw_storage_field:${field}`);
    }
  }
  const serialized = JSON.stringify(payload);
  if (/juicefs\s+mount/i.test(serialized)) {
    throw new Error('task_workspace_access_raw_storage_field:juicefs_mount');
  }
}

function normalizeTaskHomeBindingMode(value: unknown): TaskHomeBindingMode {
  if (value === 'pre_mounted') return value;
  throw new Error('task_workspace_access_binding_mode_invalid');
}

function normalizeTaskHomeBinding(payload: unknown): TaskHomeBindingPayload {
  assertNoRawWorkspaceAccessFields(payload);
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('task_workspace_access_invalid');
  }
  const binding = (payload as { task_home_binding?: unknown }).task_home_binding;
  if (typeof binding !== 'object' || binding === null) {
    throw new Error('task_workspace_access_binding_missing');
  }
  assertNoRawWorkspaceAccessFields(binding);
  const rawBinding = binding as Record<string, unknown>;
  if (rawBinding.provider !== 'afscp') {
    throw new Error('task_workspace_access_provider_invalid');
  }
  const holder = rawBinding.holder;
  if (typeof holder !== 'object' || holder === null) {
    throw new Error('task_workspace_access_holder_missing');
  }
  const paths = rawBinding.paths;
  if (typeof paths !== 'object' || paths === null) {
    throw new Error('task_workspace_access_paths_missing');
  }
  const rawHolder = holder as Record<string, unknown>;
  const issuedAt = normalizeRequiredString(rawHolder.issued_at, 'task_workspace_access_holder_field_missing:issued_at');
  const expiresAt = normalizeRequiredString(rawHolder.expires_at, 'task_workspace_access_holder_field_missing:expires_at');
  assertIsoTimestamp(issuedAt, 'task_workspace_access_holder_field_invalid:issued_at');
  assertIsoTimestamp(expiresAt, 'task_workspace_access_holder_field_invalid:expires_at');
  const rawPaths = paths as Record<string, unknown>;
  return {
    binding_id: normalizeRequiredString(rawBinding.binding_id, 'task_workspace_access_binding_id_missing'),
    provider: 'afscp',
    mode: normalizeTaskHomeBindingMode(rawBinding.mode),
    task_id: normalizeRequiredString(rawBinding.task_id, 'task_workspace_access_identity_missing:task_id'),
    file_library_id: normalizeRequiredString(
      rawBinding.file_library_id,
      'task_workspace_access_identity_missing:file_library_id',
    ),
    task_home_segment: normalizeTaskHomeSegment(
      rawBinding.task_home_segment,
      'task_workspace_access_identity_invalid:task_home_segment',
    ),
    generation: normalizeRequiredString(rawBinding.generation, 'task_workspace_access_generation_missing'),
    holder: {
      holder_id: normalizeRequiredString(rawHolder.holder_id, 'task_workspace_access_holder_field_missing:holder_id'),
      holder_kind: normalizeHolderKind(
        rawHolder.holder_kind,
        'task_workspace_access_holder_field_invalid:holder_kind',
      ),
      binding_generation: normalizeRequiredString(
        rawHolder.binding_generation,
        'task_workspace_access_holder_field_missing:binding_generation',
      ),
      lease_epoch: normalizeRequiredString(
        rawHolder.lease_epoch,
        'task_workspace_access_holder_field_missing:lease_epoch',
      ),
      issued_at: issuedAt,
      expires_at: expiresAt,
    },
    paths: {
      task_home_path: normalizeRequiredString(rawPaths.task_home_path, 'task_workspace_access_path_missing:task_home_path'),
      workspace_path: normalizeRequiredString(rawPaths.workspace_path, 'task_workspace_access_path_missing:workspace_path'),
      artifacts_path: normalizeRequiredString(rawPaths.artifacts_path, 'task_workspace_access_path_missing:artifacts_path'),
      library_root_path: normalizeRequiredString(
        rawPaths.library_root_path,
        'task_workspace_access_path_missing:library_root_path',
      ) as '.',
    },
  };
}

function normalizeWorkspaceAccessHolderFence(
  binding: TaskHomeBindingPayload,
): TaskWorkspaceHolderFence {
  return {
    holderId: binding.holder.holder_id,
    holderKind: binding.holder.holder_kind,
    bindingGeneration: binding.holder.binding_generation,
    leaseEpoch: binding.holder.lease_epoch,
    issuedAt: binding.holder.issued_at,
    expiresAt: binding.holder.expires_at,
  };
}

function debugTaskWorkspace(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-task-runner][task-workspace] ${message}${payload}\n`);
}

export function shouldRetryTaskWorkspaceMount(): boolean {
  return false;
}

export function shouldRetryTaskWorkspaceWriteFailure(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (RETRYABLE_TASK_WORKSPACE_WRITE_FAILURE_CODES.has(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return message.includes('stale file handle')
    || message.includes('transport endpoint is not connected')
    || message.includes('input/output error');
}

export function resolveAgentTaskRunnerMode(): AgentTaskRunnerMode {
  const raw = (process.env.MBOS_AGENT_TASK_RUNNER_MODE ?? '').trim();
  switch (raw) {
    case 'developer':
    case 'managed_local':
    case 'managed_platform':
      return raw;
    default:
      throw new Error(`agent_task_runner_mode_invalid:${raw || 'missing'}`);
  }
}

function normalizeTaskWorkspacePath(raw: string | undefined, field: string): string {
  const value = sanitizeWorkspacePath(raw);
  if (!value) {
    throw new Error(`task_workspace_paths_missing:${field}`);
  }
  if (!isAbsolute(value)) {
    throw new Error(`task_workspace_paths_not_absolute:${field}`);
  }
  if (value.split('/').some((part) => part === '..')) {
    throw new Error(`task_workspace_paths_traversal:${field}`);
  }
  const normalized = normalize(value);
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
}

function normalizeTaskLibraryRootPath(raw: string | undefined, field: string): '.' {
  const value = sanitizeWorkspacePath(raw ?? '.');
  if (value !== '.') {
    throw new Error(`task_workspace_paths_inconsistent:${field}`);
  }
  return '.';
}

function buildTaskWorkspaceIdentity(
  executionContext: FileLibraryWorkspaceExecutionContext,
  expectedTaskId: string,
): TaskWorkspaceIdentity {
  const taskId = normalizeRequiredString(
    executionContext.task_id,
    'task_workspace_identity_missing:task_id',
  );
  if (taskId !== expectedTaskId) {
    throw new Error('task_workspace_identity_mismatch:task_id');
  }
  const fileLibraryId = normalizeRequiredString(
    executionContext.workspace_file_library_id,
    'task_workspace_identity_missing:workspace_file_library_id',
  );
  const workspaceBindingMode = normalizeWorkspaceBindingMode(
    executionContext.workspace_binding_mode,
    'task_workspace_identity_invalid:workspace_binding_mode',
  );
  const runtimeProfile = normalizeRuntimeProfile(
    executionContext.runtime_profile,
    'task_workspace_identity_invalid:runtime_profile',
  );
  const taskHomeSegment = normalizeTaskHomeSegment(
    executionContext.task_home_segment,
    'task_workspace_identity_invalid:task_home_segment',
  );
  const libraryRootPath = normalizeRequiredString(
    executionContext.library_root_path,
    'task_workspace_identity_missing:library_root_path',
  );
  if (libraryRootPath !== '.') {
    throw new Error('task_workspace_identity_invalid:library_root_path');
  }
  return {
    taskId,
    fileLibraryId,
    workspaceBindingMode,
    runtimeProfile,
    taskHomeSegment,
  };
}

export function buildTaskWorkspacePaths(input: {
  mode: AgentTaskRunnerMode;
  runtimeProfile?: TaskRuntimeProfile;
  taskHomeSegment?: string;
  taskHomePath?: string;
  workspacePath?: string;
  artifactsPath?: string;
  libraryRootPath?: string;
}): TaskWorkspacePaths {
  const taskHome = normalizeTaskWorkspacePath(input.taskHomePath, 'task_home_path');
  const workspaceDir = normalizeTaskWorkspacePath(input.workspacePath, 'workspace_path');
  const artifactsDir = normalizeTaskWorkspacePath(input.artifactsPath, 'artifacts_path');
  const libraryRoot = normalizeTaskLibraryRootPath(input.libraryRootPath, 'library_root_path');
  const runtimeProfile = input.runtimeProfile ?? (input.mode === 'developer' ? 'developer' : 'managed');
  const taskHomeSegment = input.taskHomeSegment
    ? normalizeTaskHomeSegment(input.taskHomeSegment, 'task_workspace_paths_invalid:task_home_segment')
    : taskHome.split('/').filter(Boolean).at(-1) ?? '';
  if (!taskHomeSegment) {
    throw new Error('task_workspace_paths_invalid:task_home_segment');
  }
  if (input.mode === 'developer' && runtimeProfile !== 'developer') {
    throw new Error('task_workspace_paths_runtime_profile_mismatch');
  }
  if (input.mode !== 'developer' && runtimeProfile !== 'managed') {
    throw new Error('task_workspace_paths_runtime_profile_mismatch');
  }
  if (taskHome === '/') {
    throw new Error('task_workspace_paths_invalid:task_home_path');
  }
  if (!taskHome.endsWith(`/${taskHomeSegment}`)) {
    throw new Error('task_workspace_paths_inconsistent:task_home_segment');
  }
  if (runtimeProfile === 'managed' && taskHome !== join('/home', taskHomeSegment)) {
    throw new Error('task_workspace_paths_inconsistent:runtime_profile');
  }
  if (workspaceDir !== join(taskHome, 'workspace')) {
    throw new Error('task_workspace_paths_inconsistent:workspace_path');
  }
  if (artifactsDir !== join(workspaceDir, '.artifacts')) {
    throw new Error('task_workspace_paths_inconsistent:artifacts_path');
  }
  return {
    mode: input.mode,
    runtimeProfile,
    taskHomeSegment,
    taskHome,
    workspaceDir,
    visibleRoot: workspaceDir,
    libraryRoot,
    mountRoot: taskHome,
    taskRoot: taskHome,
    runtimeRoot: taskHome,
    homeDir: taskHome,
    codexDir: join(taskHome, '.codex'),
    artifactsDir,
    mbosDir: join(taskHome, '.mbos'),
    skillsDir: join(taskHome, '.agents', 'skills'),
  };
}

function assertTaskHomeBindingMatches(input: {
  binding: TaskHomeBindingPayload;
  identity: TaskWorkspaceIdentity;
  paths: TaskWorkspacePaths;
}): TaskWorkspaceHolderFence {
  const checks = [
    ['task_id', input.binding.task_id, input.identity.taskId],
    ['file_library_id', input.binding.file_library_id, input.identity.fileLibraryId],
    ['task_home_segment', input.binding.task_home_segment, input.identity.taskHomeSegment],
  ] as const;
  for (const [field, raw, expected] of checks) {
    if (raw !== expected) {
      throw new Error(`task_workspace_access_identity_mismatch:${field}`);
    }
  }

  const pathChecks = [
    ['task_home_path', input.binding.paths.task_home_path, input.paths.taskHome],
    ['workspace_path', input.binding.paths.workspace_path, input.paths.workspaceDir],
    ['artifacts_path', input.binding.paths.artifacts_path, input.paths.artifactsDir],
  ] as const;
  for (const [field, raw, expected] of pathChecks) {
    const echoed = normalizeTaskWorkspacePath(raw, `workspace_access.${field}`);
    if (echoed !== expected) {
      throw new Error(`task_workspace_access_path_mismatch:${field}`);
    }
  }

  if (input.binding.paths.library_root_path !== input.paths.libraryRoot) {
    throw new Error('task_workspace_access_library_root_path_invalid');
  }
  return normalizeWorkspaceAccessHolderFence(input.binding);
}

export function resolveTaskCwd(input: {
  taskId: string;
  runtimeProfile?: TaskRuntimeProfile;
  taskHomeSegment?: string;
  taskHomePath?: string;
  workspacePath?: string;
  artifactsPath?: string;
  libraryRootPath?: string;
}): { cwd: string; source: 'path_fields'; mode: AgentTaskRunnerMode; paths: TaskWorkspacePaths } {
  const mode = resolveAgentTaskRunnerMode();
  const paths = buildTaskWorkspacePaths({
    mode,
    runtimeProfile: input.runtimeProfile,
    taskHomeSegment: input.taskHomeSegment,
    taskHomePath: input.taskHomePath,
    workspacePath: input.workspacePath,
    artifactsPath: input.artifactsPath,
    libraryRootPath: input.libraryRootPath,
  });
  return {
    cwd: paths.workspaceDir,
    source: 'path_fields',
    mode,
    paths,
  };
}

export async function fetchTaskWorkspaceAccess(
  executionContext: FileLibraryWorkspaceExecutionContext,
): Promise<TaskWorkspaceAccessPayload> {
  const apiBase = sanitizeWorkspacePath(executionContext.api_base)?.replace(/\/+$/, '');
  const workspaceId = sanitizePathPart(executionContext.workspace_id, '');
  const projectId = sanitizePathPart(executionContext.project_id, '');
  const taskId = sanitizePathPart(executionContext.task_id, '');
  const executionTicket = (executionContext.execution_ticket ?? '').trim();
  if (!apiBase || !workspaceId || !projectId || !taskId || !executionTicket) {
    throw new Error('task_workspace_access_context_missing');
  }

  debugTaskWorkspace('fetch_workspace_access_start', {
    api_base: apiBase,
    workspace_id: workspaceId,
    project_id: projectId,
    task_id: taskId,
  });

  const response = await fetch(
    `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/tasks/${encodeURIComponent(taskId)}/workspace-access`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${executionTicket}`,
      },
    },
  );
  if (!response.ok) {
    debugTaskWorkspace('fetch_workspace_access_failed', {
      status: response.status,
      api_base: apiBase,
      task_id: taskId,
    });
    throw new Error(`task_workspace_access_failed:${response.status}`);
  }
  const payload = await response.json() as unknown;
  const binding = normalizeTaskHomeBinding(payload);
  debugTaskWorkspace('fetch_workspace_access_ready', {
    task_id: taskId,
    binding_id: binding.binding_id,
    binding_mode: binding.mode,
  });
  return { task_home_binding: binding };
}

export async function releaseTaskWorkspaceAccess(
  executionContext: FileLibraryWorkspaceExecutionContext,
  lease: TaskWorkspaceAccessReleaseFence | TaskWorkspaceLease,
): Promise<void> {
  const apiBase = sanitizeWorkspacePath(executionContext.api_base)?.replace(/\/+$/, '');
  const workspaceId = sanitizePathPart(executionContext.workspace_id, '');
  const projectId = sanitizePathPart(executionContext.project_id, '');
  const taskId = sanitizePathPart(executionContext.task_id, '');
  const executionTicket = (executionContext.execution_ticket ?? '').trim();
  if (!apiBase || !workspaceId || !projectId || !taskId || !executionTicket) {
    throw new Error('task_workspace_access_release_context_missing');
  }

  const response = await fetch(
    `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/tasks/${encodeURIComponent(taskId)}/workspace-access/release`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${executionTicket}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        holder_id: lease.holderId,
        file_library_id: lease.fileLibraryId,
        binding_generation: lease.bindingGeneration,
        lease_epoch: lease.leaseEpoch,
      }),
    },
  );
  if (!response.ok) {
    debugTaskWorkspace('release_workspace_access_failed', {
      status: response.status,
      task_id: taskId,
      holder_id: lease.holderId,
      binding_generation: lease.bindingGeneration,
      lease_epoch: lease.leaseEpoch,
    });
    throw new Error(`task_workspace_access_release_failed:${response.status}`);
  }
}

async function ensureTaskWorkspaceWritable(paths: TaskWorkspacePaths): Promise<void> {
  await mkdir(paths.workspaceDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
}

function buildTaskWorkspaceLease(input: {
  paths: TaskWorkspacePaths;
  identity: TaskWorkspaceIdentity;
  holderFence: TaskWorkspaceHolderFence;
}): TaskWorkspaceLease {
  return {
    mountPath: input.paths.taskHome,
    leaseId: randomUUID(),
    revision: 1,
    holderId: input.holderFence.holderId,
    taskId: input.identity.taskId,
    fileLibraryId: input.identity.fileLibraryId,
    taskHomeSegment: input.identity.taskHomeSegment,
    bindingGeneration: input.holderFence.bindingGeneration,
    leaseEpoch: input.holderFence.leaseEpoch,
    holderKind: input.holderFence.holderKind,
    issuedAt: input.holderFence.issuedAt,
    expiresAt: input.holderFence.expiresAt,
  };
}

function resolveFallbackHome(): string {
  return process.env.HOME || homedir() || '/tmp';
}

export async function prepareTaskWorkspace(input: {
  executionContext: FileLibraryWorkspaceExecutionContext;
  username: string;
  taskId: string;
}): Promise<{
  cwd: string;
  source: 'path_fields';
  paths: TaskWorkspacePaths;
  lease?: TaskWorkspaceLease;
  release: () => Promise<void>;
}> {
  void input.username;
  void resolveFallbackHome();
  void resolveAgentTaskRunnerMode();
  const identity = buildTaskWorkspaceIdentity(input.executionContext, input.taskId);
  const resolved = resolveTaskCwd({
    taskHomePath: input.executionContext.task_home_path,
    workspacePath: input.executionContext.workspace_path,
    artifactsPath: input.executionContext.artifacts_path,
    libraryRootPath: input.executionContext.library_root_path,
    runtimeProfile: identity.runtimeProfile,
    taskHomeSegment: identity.taskHomeSegment,
    taskId: input.taskId,
  });
  const paths = resolved.paths;

  if (identity.workspaceBindingMode === 'pre_mounted') {
    await ensureTaskWorkspaceWritable(paths);
    return {
      cwd: resolved.cwd,
      source: 'path_fields',
      paths,
      release: async () => undefined,
    };
  }

  const workspaceAccess = await fetchTaskWorkspaceAccess(input.executionContext);
  const binding = workspaceAccess.task_home_binding;
  let holderFence: TaskWorkspaceHolderFence;
  try {
    holderFence = assertTaskHomeBindingMatches({ binding, identity, paths });
  } catch (error) {
    await releaseTaskWorkspaceAccess(input.executionContext, {
      holderId: binding.holder.holder_id,
      fileLibraryId: binding.file_library_id,
      bindingGeneration: binding.holder.binding_generation,
      leaseEpoch: binding.holder.lease_epoch,
    }).catch((releaseError) => {
      debugTaskWorkspace('release_workspace_access_after_prepare_validation_failed', {
        task_id: identity.taskId,
        message: releaseError instanceof Error ? releaseError.message : String(releaseError),
      });
    });
    throw error;
  }

  const lease = buildTaskWorkspaceLease({
    paths,
    identity,
    holderFence,
  });
  let workspaceAccessReleased = false;
  const releaseOnce = async (): Promise<void> => {
    if (workspaceAccessReleased) return;
    workspaceAccessReleased = true;
    await releaseTaskWorkspaceAccess(input.executionContext, lease);
  };

  await ensureTaskWorkspaceWritable(paths);
  return {
    cwd: paths.workspaceDir,
    source: 'path_fields',
    paths,
    lease,
    release: releaseOnce,
  };
}

export function clearPreparedTaskWorkspaces(): void {
  // Workspace state is owned by the backend holder fence and AFSCP binding.
}

export async function releaseAllPreparedTaskWorkspaces(): Promise<void> {
  // Path binding ownership lives in the backend holder fence.
}

export async function releasePreparedTaskWorkspace(): Promise<void> {
  // Path binding ownership lives in the backend holder fence.
}

export async function evictPreparedTaskWorkspace(): Promise<void> {
  // Path binding ownership lives in the backend holder fence.
}
