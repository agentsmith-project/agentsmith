import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  classifyMountedWorkspaceOwnerAuthority,
  type MountedWorkspaceOwnerAuthority,
  type RunnerProcessSnapshot,
} from './task-workspace-ownership.js';

const execFile = promisify(execFileCallback);
const DEFAULT_MOUNT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_MOUNT_READY_POLL_MS = 250;
const DEFAULT_MOUNT_RETRY_COUNT = 2;
const DEFAULT_MOUNT_RETRY_DELAY_MS = 750;
const MAX_RELEASE_ATTEMPTS_HISTORY = 5;

export type AgentTaskRunnerMode = 'developer' | 'managed_local' | 'managed_platform';
export type TaskWorkspaceLease = {
  mountPath: string;
  leaseId: string;
  revision: number;
};
type MountRegistryState = 'mounted' | 'releasing' | 'release_failed' | 'released';
type MountReleaseOutcome = 'not_started' | 'pending' | 'released' | 'failed';
type PersistedMountReleaseAttempt = {
  attempted_at: string;
  outcome: Exclude<MountReleaseOutcome, 'not_started'>;
  error: string | null;
};

type FileLibraryWorkspaceExecutionContext = {
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  api_base?: string;
  task_home_path?: string;
  workspace_path?: string;
  artifacts_path?: string;
  execution_ticket?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
};

type TaskWorkspaceAccessPayload = {
  task_id: string;
  workspace_binding_mode: 'file_library';
  task_home_path?: unknown;
  workspace_path?: unknown;
  artifacts_path?: unknown;
  workspace_dir_name: string;
  file_library_id: string;
  file_library_name: string;
  filesystem_name: string;
  metadata_url: string;
  storage_bucket_url?: string;
  recommended_mount_path?: string;
  created_at?: string;
};

export type TaskWorkspacePaths = {
  mode: AgentTaskRunnerMode;
  taskHome: string;
  workspaceDir: string;
  visibleRoot: string;
  mountRoot: string;
  taskRoot: string;
  runtimeRoot: string;
  homeDir: string;
  codexDir: string;
  artifactsDir: string;
  mbosDir: string;
  skillsDir: string;
};

type MountedWorkspaceSession = {
  mountPath: string;
  mode: AgentTaskRunnerMode;
  metadataUrl: string;
  storageBucketUrl?: string;
  logPath: string;
  refs: number;
  child: ChildProcess | null;
  childExited: boolean;
  ownerProcessPid: number | null;
  runnerInstanceId: string | null;
  leaseId: string | null;
  leaseRevision: number;
  createdAt: string | null;
  mountedAt: string | null;
  lastRefChangeAt: string | null;
  lastReleaseAttemptAt: string | null;
  lastReleaseOutcome: MountReleaseOutcome;
  lastReleaseError: string | null;
  lastReleasedAt: string | null;
  releaseAttempts: PersistedMountReleaseAttempt[];
  updatedAt: string | null;
  state: MountRegistryState;
};

type PersistedMountedWorkspaceSession = {
  mount_path: string;
  mode: AgentTaskRunnerMode;
  metadata_url: string;
  storage_bucket_url?: string;
  log_path: string;
  refs: number;
  owner_process_pid: number | null;
  owner_runner_instance_id: string | null;
  lease_id: string | null;
  lease_revision: number;
  created_at: string | null;
  mounted_at: string | null;
  last_ref_change_at: string | null;
  last_release_attempt_at: string | null;
  last_release_outcome: MountReleaseOutcome;
  last_release_error: string | null;
  last_released_at: string | null;
  release_attempts: PersistedMountReleaseAttempt[];
  updated_at: string | null;
  state: MountRegistryState;
};

const mountedWorkspaceByMountPath = new Map<string, MountedWorkspaceSession>();
const releasedMountedWorkspaceByMountPath = new Set<string>();
const RETRYABLE_TASK_WORKSPACE_WRITE_FAILURE_CODES = new Set(['EIO', 'ESTALE', 'ENOTCONN']);
const TASK_WORKSPACE_MOUNT_SESSIONS_FILE = 'task-workspace-mount-sessions.json';
const TASK_WORKSPACE_MOUNT_SESSIONS_VERSION = 4;
const DEFAULT_MOUNT_RELEASE_TIMEOUT_MS = 10_000;
const DEFAULT_MOUNT_CHILD_EXIT_TIMEOUT_MS = 5_000;
let cleanupHooksRegistered = false;
let releaseAllPreparedTaskWorkspacesPromise: Promise<void> | null = null;
const RUNNER_INSTANCE_ID = (process.env.MBOS_AGENT_RUNNER_INSTANCE_ID ?? '').trim() || randomUUID();
if (!(process.env.MBOS_AGENT_RUNNER_INSTANCE_ID ?? '').trim()) {
  process.env.MBOS_AGENT_RUNNER_INSTANCE_ID = RUNNER_INSTANCE_ID;
}

function parseAgentTaskRunnerMode(raw: unknown): AgentTaskRunnerMode | null {
  switch (typeof raw === 'string' ? raw.trim() : '') {
    case 'developer':
    case 'managed_local':
    case 'managed_platform':
      return raw as AgentTaskRunnerMode;
    default:
      return null;
  }
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMountRegistryState(value: unknown): MountRegistryState {
  switch (value) {
    case 'mounted':
    case 'releasing':
    case 'release_failed':
    case 'released':
      return value;
    default:
      return 'mounted';
  }
}

function normalizeMountReleaseOutcome(value: unknown): MountReleaseOutcome {
  switch (value) {
    case 'not_started':
    case 'pending':
    case 'released':
    case 'failed':
      return value;
    default:
      return 'not_started';
  }
}

function debugTaskWorkspace(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-task-runner][task-workspace] ${message}${payload}\n`);
}

function normalizeExecFileStdout(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result === 'object' && result !== null && 'stdout' in result) {
    return String((result as { stdout?: unknown }).stdout ?? '');
  }
  return '';
}

export function shouldRetryTaskWorkspaceMount(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('task_workspace_mount_not_ready')
    || message.includes('connection reset by peer')
    || message.includes('failed to receive message');
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

function sanitizeWorkspacePath(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function sanitizePathPart(input: string | null | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || fallback;
}

function parseJuicefsMountOptions(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

const JUICEFS_CLI_KEY_VALUE_OPTIONS = new Set([
  'cache-size',
  'prefetch',
  'buffer-size',
  'free-space-ratio',
  'cache-items',
  'upload-limit',
  'download-limit',
  'max-uploads',
  'max-deletes',
  'io-retries',
  'get-timeout',
  'put-timeout',
]);

function splitJuicefsMountOptions(raw: string | undefined): {
  fuseOptions: string[];
  cliArgs: string[];
} {
  const fuseOptions: string[] = [];
  const cliArgs: string[] = [];
  for (const option of parseJuicefsMountOptions(raw)) {
    if (option.startsWith('--')) {
      const trimmed = option.trim();
      if (trimmed.includes('=')) {
        const [flag, ...rest] = trimmed.split('=');
        const value = rest.join('=').trim();
        if (flag && value) {
          cliArgs.push(flag, value);
          continue;
        }
      }
      cliArgs.push(trimmed);
      continue;
    }
    const separatorIndex = option.indexOf('=');
    if (separatorIndex > 0) {
      const key = option.slice(0, separatorIndex).trim();
      const value = option.slice(separatorIndex + 1).trim();
      if (JUICEFS_CLI_KEY_VALUE_OPTIONS.has(key) && value.length > 0) {
        cliArgs.push(`--${key}`, value);
        continue;
      }
    }
    fuseOptions.push(option);
  }
  return { fuseOptions, cliArgs };
}

function buildJuicefsMountEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
  delete env.NO_PROXY;
  delete env.no_proxy;
  return env;
}

function buildJuicefsMountArgs(input: {
  metadataUrl: string;
  mountPath: string;
  cacheDir: string;
  logPath: string;
  storageBucketUrl?: string;
}): string[] {
  const commandArgs = [
    'mount',
    input.metadataUrl,
    input.mountPath,
    '--cache-dir',
    input.cacheDir,
    '--log',
    input.logPath,
    '--check-storage',
    '--attr-cache',
    '0',
    '--entry-cache',
    '0',
    '--dir-entry-cache',
    '0',
  ];
  if ((input.storageBucketUrl ?? '').trim()) {
    commandArgs.push('--bucket', input.storageBucketUrl!.trim());
  }
  const mountOptions = splitJuicefsMountOptions(process.env.MBOS_AGENT_JUICEFS_MOUNT_OPTIONS);
  if (mountOptions.fuseOptions.length > 0) {
    commandArgs.push('-o', mountOptions.fuseOptions.join(','));
  }
  if (mountOptions.cliArgs.length > 0) {
    commandArgs.push(...mountOptions.cliArgs);
  }
  return commandArgs;
}

async function isMountPointReady(mountPath: string): Promise<boolean> {
  try {
    await execFile('mountpoint', ['-q', mountPath]);
    return true;
  } catch {
    return false;
  }
}

async function readMountLogExcerpt(logPath: string): Promise<string> {
  try {
    const content = (await readFile(logPath, 'utf8')).trim();
    if (!content) return '';
    return content.split('\n').slice(-20).join('\n');
  } catch {
    return '';
  }
}

async function waitForMountPointReady(mountPath: string, logPath: string): Promise<void> {
  const timeoutMs = Number.parseInt(process.env.MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS ?? '', 10)
    || DEFAULT_MOUNT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isMountPointReady(mountPath)) return;
    await sleep(DEFAULT_MOUNT_READY_POLL_MS);
  }
  const logExcerpt = await readMountLogExcerpt(logPath);
  throw new Error(
    logExcerpt
      ? `task_workspace_mount_not_ready:${logExcerpt}`
      : 'task_workspace_mount_not_ready',
  );
}

async function waitForMountPointReleased(mountPath: string): Promise<void> {
  const timeoutMs = Number.parseInt(process.env.MBOS_AGENT_JUICEFS_MOUNT_RELEASE_TIMEOUT_MS ?? '', 10)
    || DEFAULT_MOUNT_RELEASE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isMountPointReady(mountPath)) return;
    await sleep(DEFAULT_MOUNT_READY_POLL_MS);
  }
  throw new Error(`task_workspace_umount_not_ready:${mountPath}`);
}

type MountedWorkspaceTruthVerification =
  | {
    status: 'match';
    reason: 'findmnt_source_matches_filesystem' | 'findmnt_source_matches_metadata_url' | 'findmnt_source_matches_bucket_url';
    source: string;
    fstype: string | null;
  }
  | {
    status: 'mismatch';
    reason: 'findmnt_source_filesystem_mismatch' | 'findmnt_source_metadata_url_mismatch' | 'findmnt_source_non_juicefs';
    source: string;
    fstype: string | null;
  }
  | {
    status: 'unverified';
    reason: 'findmnt_unavailable' | 'findmnt_empty' | 'findmnt_source_unrecognized';
    source: string | null;
    fstype: string | null;
  };

function parseFindmntSourceRecord(stdout: string): { source: string | null; fstype: string | null } {
  const record = stdout
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!record) {
    return {
      source: null,
      fstype: null,
    };
  }
  const [source, fstype] = record.split(/\s+/, 2);
  return {
    source: source?.trim() || null,
    fstype: fstype?.trim() || null,
  };
}

function extractMountedFilesystemName(source: string): string | null {
  const match = source.trim().match(/^juicefs:(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function verifyMountedWorkspaceTruth(args: {
  mountPath: string;
  filesystemName: string;
  metadataUrl: string;
  storageBucketUrl?: string;
}): Promise<MountedWorkspaceTruthVerification> {
  try {
    const stdout = normalizeExecFileStdout(await execFile(
      'findmnt',
      ['-T', args.mountPath, '-n', '-o', 'SOURCE,FSTYPE'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    ));
    const { source, fstype } = parseFindmntSourceRecord(stdout);
    if (!source) {
      return {
        status: 'unverified',
        reason: 'findmnt_empty',
        source: null,
        fstype,
      };
    }
    if (fstype && !fstype.toLowerCase().includes('juicefs')) {
      return {
        status: 'mismatch',
        reason: 'findmnt_source_non_juicefs',
        source,
        fstype,
      };
    }
    const mountedFilesystemName = extractMountedFilesystemName(source);
    if (mountedFilesystemName) {
      return mountedFilesystemName === args.filesystemName
        ? {
          status: 'match',
          reason: 'findmnt_source_matches_filesystem',
          source,
          fstype,
        }
        : {
          status: 'mismatch',
          reason: 'findmnt_source_filesystem_mismatch',
          source,
          fstype,
        };
    }
    if (source === args.filesystemName) {
      return {
        status: 'match',
        reason: 'findmnt_source_matches_filesystem',
        source,
        fstype,
      };
    }
    if (source === args.metadataUrl) {
      return {
        status: 'match',
        reason: 'findmnt_source_matches_metadata_url',
        source,
        fstype,
      };
    }
    if (args.storageBucketUrl && source === args.storageBucketUrl) {
      return {
        status: 'match',
        reason: 'findmnt_source_matches_bucket_url',
        source,
        fstype,
      };
    }
    if (source.includes('://')) {
      return {
        status: 'mismatch',
        reason: 'findmnt_source_metadata_url_mismatch',
        source,
        fstype,
      };
    }
    return {
      status: 'unverified',
      reason: 'findmnt_source_unrecognized',
      source,
      fstype,
    };
  } catch {
    return {
      status: 'unverified',
      reason: 'findmnt_unavailable',
      source: null,
      fstype: null,
    };
  }
}

function resolveTaskWorkspaceSessionRegistryPath(): string {
  const workspaceRoot = sanitizeWorkspacePath(process.env.MBOS_AGENT_WORKSPACE_ROOT);
  if (workspaceRoot) {
    return join(workspaceRoot, TASK_WORKSPACE_MOUNT_SESSIONS_FILE);
  }
  return join(process.env.HOME || homedir() || '/tmp', '.mbos', TASK_WORKSPACE_MOUNT_SESSIONS_FILE);
}

function buildPersistedReleaseAttempts(raw: unknown): PersistedMountReleaseAttempt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((attempt) => {
      if (typeof attempt !== 'object' || attempt === null) {
        return null;
      }
      const attemptedAt = normalizeOptionalString((attempt as { attempted_at?: unknown }).attempted_at);
      if (!attemptedAt) {
        return null;
      }
      const outcome = normalizeMountReleaseOutcome((attempt as { outcome?: unknown }).outcome);
      if (outcome === 'not_started') {
        return null;
      }
      return {
        attempted_at: attemptedAt,
        outcome,
        error: normalizeOptionalString((attempt as { error?: unknown }).error),
      } satisfies PersistedMountReleaseAttempt;
    })
    .filter((attempt): attempt is PersistedMountReleaseAttempt => attempt !== null)
    .slice(-MAX_RELEASE_ATTEMPTS_HISTORY);
}

function buildRegistrySessionSnapshot(session: MountedWorkspaceSession): PersistedMountedWorkspaceSession {
  return {
    mount_path: session.mountPath,
    mode: session.mode,
    metadata_url: session.metadataUrl,
    storage_bucket_url: session.storageBucketUrl,
    log_path: session.logPath,
    refs: session.refs,
    owner_process_pid: session.ownerProcessPid,
    owner_runner_instance_id: session.runnerInstanceId,
    lease_id: session.leaseId,
    lease_revision: session.leaseRevision,
    created_at: session.createdAt,
    mounted_at: session.mountedAt,
    last_ref_change_at: session.lastRefChangeAt,
    last_release_attempt_at: session.lastReleaseAttemptAt,
    last_release_outcome: session.lastReleaseOutcome,
    last_release_error: session.lastReleaseError,
    last_released_at: session.lastReleasedAt,
    release_attempts: session.releaseAttempts.slice(-MAX_RELEASE_ATTEMPTS_HISTORY),
    updated_at: session.updatedAt,
    state: session.state,
  };
}

function buildRegistrySessionFromPersisted(
  raw: unknown,
  fallbackMode: AgentTaskRunnerMode,
): PersistedMountedWorkspaceSession | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const mountPath = normalizeOptionalString((raw as { mount_path?: unknown }).mount_path);
  if (!mountPath) {
    return null;
  }
  const mode = parseAgentTaskRunnerMode((raw as { mode?: unknown }).mode) ?? fallbackMode;
  return {
    mount_path: mountPath,
    mode,
    metadata_url: normalizeOptionalString(
      (raw as { metadata_url?: unknown; metadataUrl?: unknown }).metadata_url
      ?? (raw as { metadataUrl?: unknown }).metadataUrl,
    ) ?? '',
    storage_bucket_url: normalizeOptionalString(
      (raw as { storage_bucket_url?: unknown; storageBucketUrl?: unknown }).storage_bucket_url
      ?? (raw as { storageBucketUrl?: unknown }).storageBucketUrl,
    ) ?? undefined,
    log_path: normalizeOptionalString(
      (raw as { log_path?: unknown; logPath?: unknown }).log_path
      ?? (raw as { logPath?: unknown }).logPath,
    ) ?? '',
    refs: normalizePositiveInteger((raw as { refs?: unknown }).refs) ?? 1,
    owner_process_pid: normalizePositiveInteger(
      (raw as { owner_process_pid?: unknown; ownerProcessPid?: unknown }).owner_process_pid
      ?? (raw as { ownerProcessPid?: unknown }).ownerProcessPid,
    ),
    owner_runner_instance_id: normalizeOptionalString(
      (raw as {
        owner_runner_instance_id?: unknown;
        ownerRunnerInstanceId?: unknown;
        runner_instance_id?: unknown;
      }).owner_runner_instance_id
      ?? (raw as { runner_instance_id?: unknown }).runner_instance_id
      ?? (raw as { ownerRunnerInstanceId?: unknown }).ownerRunnerInstanceId,
    ),
    lease_id: normalizeOptionalString(
      (raw as { lease_id?: unknown; leaseId?: unknown }).lease_id
      ?? (raw as { leaseId?: unknown }).leaseId,
    ),
    lease_revision: normalizeNonNegativeInteger(
      (raw as { lease_revision?: unknown; leaseRevision?: unknown }).lease_revision
      ?? (raw as { leaseRevision?: unknown }).leaseRevision,
    ) ?? 0,
    created_at: normalizeOptionalString(
      (raw as { created_at?: unknown; createdAt?: unknown }).created_at
      ?? (raw as { createdAt?: unknown }).createdAt,
    ),
    mounted_at: normalizeOptionalString(
      (raw as { mounted_at?: unknown; mountedAt?: unknown }).mounted_at
      ?? (raw as { mountedAt?: unknown }).mountedAt,
    ),
    last_ref_change_at: normalizeOptionalString(
      (raw as { last_ref_change_at?: unknown; lastRefChangeAt?: unknown }).last_ref_change_at
      ?? (raw as { lastRefChangeAt?: unknown }).lastRefChangeAt,
    ),
    last_release_attempt_at: normalizeOptionalString(
      (raw as { last_release_attempt_at?: unknown; lastReleaseAttemptAt?: unknown }).last_release_attempt_at
      ?? (raw as { lastReleaseAttemptAt?: unknown }).lastReleaseAttemptAt,
    ),
    last_release_outcome: normalizeMountReleaseOutcome(
      (raw as { last_release_outcome?: unknown; lastReleaseOutcome?: unknown }).last_release_outcome
      ?? (raw as { lastReleaseOutcome?: unknown }).lastReleaseOutcome,
    ),
    last_release_error: normalizeOptionalString(
      (raw as { last_release_error?: unknown; lastReleaseError?: unknown }).last_release_error
      ?? (raw as { lastReleaseError?: unknown }).lastReleaseError,
    ),
    last_released_at: normalizeOptionalString(
      (raw as { last_released_at?: unknown; lastReleasedAt?: unknown }).last_released_at
      ?? (raw as { lastReleasedAt?: unknown }).lastReleasedAt,
    ),
    release_attempts: buildPersistedReleaseAttempts(
      (raw as { release_attempts?: unknown; releaseAttempts?: unknown }).release_attempts
      ?? (raw as { releaseAttempts?: unknown }).releaseAttempts,
    ),
    updated_at: normalizeOptionalString(
      (raw as { updated_at?: unknown; updatedAt?: unknown }).updated_at
      ?? (raw as { updatedAt?: unknown }).updatedAt,
    ),
    state: normalizeMountRegistryState(
      (raw as { state?: unknown; status?: unknown }).state ?? (raw as { status?: unknown }).status,
    ),
  };
}

async function loadPersistedMountedWorkspaceSessions(): Promise<Map<string, PersistedMountedWorkspaceSession>> {
  const registryPath = resolveTaskWorkspaceSessionRegistryPath();
  try {
    const content = (await readFile(registryPath, 'utf8')).trim();
    if (!content) {
      return new Map();
    }
    const parsed = JSON.parse(content) as { sessions?: unknown[] } | unknown[];
    const sessions = new Map<string, PersistedMountedWorkspaceSession>();
    const fallbackMode = parseAgentTaskRunnerMode(process.env.MBOS_AGENT_TASK_RUNNER_MODE) ?? 'developer';
    const rawSessions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [];
    for (const rawSession of rawSessions) {
      const session = buildRegistrySessionFromPersisted(rawSession, fallbackMode);
      if (!session) {
        continue;
      }
      sessions.set(session.mount_path, session);
    }
    return sessions;
  } catch {
    return new Map();
  }
}

function hydrateMountedWorkspaceSession(
  session: PersistedMountedWorkspaceSession,
): MountedWorkspaceSession {
  return {
    mountPath: session.mount_path,
    mode: session.mode,
    metadataUrl: session.metadata_url,
    storageBucketUrl: session.storage_bucket_url,
    logPath: session.log_path,
    refs: session.refs,
    child: null,
    childExited: true,
    ownerProcessPid: session.owner_process_pid,
    runnerInstanceId: session.owner_runner_instance_id,
    leaseId: session.lease_id,
    leaseRevision: session.lease_revision,
    createdAt: session.created_at,
    mountedAt: session.mounted_at,
    lastRefChangeAt: session.last_ref_change_at,
    lastReleaseAttemptAt: session.last_release_attempt_at,
    lastReleaseOutcome: session.last_release_outcome,
    lastReleaseError: session.last_release_error,
    lastReleasedAt: session.last_released_at,
    releaseAttempts: session.release_attempts,
    updatedAt: session.updated_at,
    state: session.state,
  };
}

function hasMountedWorkspaceOwnerEvidence(session: MountedWorkspaceSession): boolean {
  return session.ownerProcessPid !== null
    && typeof session.runnerInstanceId === 'string'
    && session.runnerInstanceId.length > 0;
}

function hasMountedWorkspaceLeaseEvidence(session: MountedWorkspaceSession): boolean {
  return typeof session.leaseId === 'string'
    && session.leaseId.length > 0
    && session.leaseRevision > 0;
}

function hasTrackedMountedWorkspaceEvidence(session: MountedWorkspaceSession): boolean {
  return hasMountedWorkspaceOwnerEvidence(session) && hasMountedWorkspaceLeaseEvidence(session);
}

function appendReleaseAttempt(
  session: MountedWorkspaceSession,
  attempt: PersistedMountReleaseAttempt,
): void {
  session.releaseAttempts = [...session.releaseAttempts, attempt].slice(-MAX_RELEASE_ATTEMPTS_HISTORY);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

async function loadRunnerProcessTable(): Promise<{
  loaded: boolean;
  byPid: Map<number, RunnerProcessSnapshot>;
}> {
  try {
    const stdout = normalizeExecFileStdout(await execFile(
      'ps',
      ['-ww', '-eo', 'pid=,command='],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    ));
    const byPid = new Map<number, RunnerProcessSnapshot>();
    for (const line of stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        continue;
      }
      const pid = Number.parseInt(match[1], 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        continue;
      }
      byPid.set(pid, {
        pid,
        command: match[2],
      });
    }
    return {
      loaded: true,
      byPid,
    };
  } catch (error) {
    debugTaskWorkspace('load_runner_process_table_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      loaded: false,
      byPid: new Map(),
    };
  }
}

async function resolveMountedWorkspaceOwnerAuthority(
  session: MountedWorkspaceSession,
): Promise<MountedWorkspaceOwnerAuthority> {
  const processTable = await loadRunnerProcessTable();
  if (processTable.loaded) {
    return classifyMountedWorkspaceOwnerAuthority({
      ownerRecord: {
        ownerProcessPid: session.ownerProcessPid,
        runnerInstanceId: session.runnerInstanceId,
      },
      currentRunnerPid: process.pid,
      currentRunnerInstanceId: RUNNER_INSTANCE_ID,
      processTableByPid: processTable.byPid,
    });
  }

  if (session.ownerProcessPid !== null) {
    if (
      session.ownerProcessPid === process.pid
      && (!session.runnerInstanceId || session.runnerInstanceId === RUNNER_INSTANCE_ID)
    ) {
      return {
        kind: 'current_runner',
        reason: session.runnerInstanceId === RUNNER_INSTANCE_ID ? 'current_runner_instance' : 'current_runner_pid',
      };
    }
    if (isProcessAlive(session.ownerProcessPid)) {
      return {
        kind: 'live_foreign_runner_legacy',
        reason: 'foreign_runner_alive_without_instance_marker',
      };
    }
    return {
      kind: 'stale_owner',
      reason: 'owner_pid_dead',
    };
  }

  return {
    kind: 'ownerless_other_runner_live',
    reason: 'other_runner_alive_without_owner_evidence',
  };
}

function isMountedWorkspaceOwnerLiveForeign(authority: MountedWorkspaceOwnerAuthority): boolean {
  return authority.kind === 'live_foreign_runner' || authority.kind === 'live_foreign_runner_legacy';
}

function isMountedWorkspaceSessionOwnedByCurrentRunner(session: MountedWorkspaceSession): boolean {
  return hasMountedWorkspaceOwnerEvidence(session)
    && session.runnerInstanceId === RUNNER_INSTANCE_ID
    && session.ownerProcessPid === process.pid;
}

function isMountedWorkspaceSessionOwnedByAnotherRunner(session: MountedWorkspaceSession): boolean {
  return !isMountedWorkspaceSessionOwnedByCurrentRunner(session)
    && (session.runnerInstanceId !== null || session.ownerProcessPid !== null);
}

function ensureMountedWorkspaceLease(
  session: MountedWorkspaceSession,
  previousRevision?: number,
): TaskWorkspaceLease {
  if (session.leaseId && session.leaseRevision > 0) {
    return {
      mountPath: session.mountPath,
      leaseId: session.leaseId,
      revision: session.leaseRevision,
    };
  }
  session.leaseId = randomUUID();
  session.leaseRevision = Math.max(previousRevision ?? session.leaseRevision, 0) + 1;
  return {
    mountPath: session.mountPath,
    leaseId: session.leaseId,
    revision: session.leaseRevision,
  };
}

function getMountedWorkspaceLease(
  session: MountedWorkspaceSession,
): TaskWorkspaceLease | null {
  if (!session.leaseId || session.leaseRevision <= 0) {
    return null;
  }
  return {
    mountPath: session.mountPath,
    leaseId: session.leaseId,
    revision: session.leaseRevision,
  };
}

function rotateMountedWorkspaceLease(
  session: MountedWorkspaceSession,
  previousRevision?: number,
): TaskWorkspaceLease {
  session.leaseId = randomUUID();
  session.leaseRevision = Math.max(previousRevision ?? session.leaseRevision, 0) + 1;
  return {
    mountPath: session.mountPath,
    leaseId: session.leaseId,
    revision: session.leaseRevision,
  };
}

function doesTaskWorkspaceLeaseMatchSession(
  session: MountedWorkspaceSession,
  lease: TaskWorkspaceLease,
): boolean {
  return lease.mountPath === session.mountPath
    && lease.leaseId === session.leaseId
    && lease.revision === session.leaseRevision;
}

function markMountedSessionAcquired(
  session: MountedWorkspaceSession,
  options?: {
    resetReleaseState?: boolean;
    preserveCreatedAt?: boolean;
    preserveMountedAt?: boolean;
  },
): void {
  const timestamp = nowIsoString();
  session.ownerProcessPid = process.pid;
  session.runnerInstanceId = RUNNER_INSTANCE_ID;
  ensureMountedWorkspaceLease(session);
  session.state = 'mounted';
  session.refs += 1;
  session.updatedAt = timestamp;
  session.lastRefChangeAt = timestamp;
  session.createdAt = options?.preserveCreatedAt === false ? timestamp : (session.createdAt ?? timestamp);
  session.mountedAt = options?.preserveMountedAt === false ? timestamp : (session.mountedAt ?? timestamp);
  if (options?.resetReleaseState ?? true) {
    session.lastReleaseAttemptAt = null;
    session.lastReleaseOutcome = 'not_started';
    session.lastReleaseError = null;
    session.lastReleasedAt = null;
  }
}

function buildMountedWorkspaceSession(input: {
  mountPath: string;
  mode: AgentTaskRunnerMode;
  metadataUrl: string;
  storageBucketUrl?: string;
  logPath: string;
  refs?: number;
  leaseId?: string | null;
  leaseRevision?: number;
  createdAt?: string | null;
  mountedAt?: string | null;
  lastReleaseAttemptAt?: string | null;
  lastReleaseOutcome?: MountReleaseOutcome;
  lastReleaseError?: string | null;
  lastReleasedAt?: string | null;
  releaseAttempts?: PersistedMountReleaseAttempt[];
  updatedAt?: string | null;
  state?: MountRegistryState;
}): MountedWorkspaceSession {
  return {
    mountPath: input.mountPath,
    mode: input.mode,
    metadataUrl: input.metadataUrl,
    storageBucketUrl: input.storageBucketUrl,
    logPath: input.logPath,
    refs: input.refs ?? 0,
    child: null,
    childExited: true,
    ownerProcessPid: process.pid,
    runnerInstanceId: RUNNER_INSTANCE_ID,
    leaseId: input.leaseId ?? null,
    leaseRevision: input.leaseRevision ?? 0,
    createdAt: input.createdAt ?? null,
    mountedAt: input.mountedAt ?? null,
    lastRefChangeAt: null,
    lastReleaseAttemptAt: input.lastReleaseAttemptAt ?? null,
    lastReleaseOutcome: input.lastReleaseOutcome ?? 'not_started',
    lastReleaseError: input.lastReleaseError ?? null,
    lastReleasedAt: input.lastReleasedAt ?? null,
    releaseAttempts: [...(input.releaseAttempts ?? [])].slice(-MAX_RELEASE_ATTEMPTS_HISTORY),
    updatedAt: input.updatedAt ?? null,
    state: input.state ?? 'mounted',
  };
}

function serializeMountedWorkspaceSession(session: MountedWorkspaceSession): PersistedMountedWorkspaceSession {
  return buildRegistrySessionSnapshot(session);
}

async function persistMountedWorkspaceSessions(): Promise<void> {
  const registryPath = resolveTaskWorkspaceSessionRegistryPath();
  await mkdir(dirname(registryPath), { recursive: true });
  const persistedSessions = await loadPersistedMountedWorkspaceSessions();
  for (const mountPath of releasedMountedWorkspaceByMountPath) {
    persistedSessions.delete(mountPath);
  }
  for (const session of mountedWorkspaceByMountPath.values()) {
    if (releasedMountedWorkspaceByMountPath.has(session.mountPath)) {
      persistedSessions.delete(session.mountPath);
      continue;
    }
    persistedSessions.set(session.mountPath, serializeMountedWorkspaceSession(session));
  }
  const sessions = Array.from(persistedSessions.values())
    .sort((left, right) => left.mount_path.localeCompare(right.mount_path));
  await writeFile(
    registryPath,
    `${JSON.stringify({ version: TASK_WORKSPACE_MOUNT_SESSIONS_VERSION, sessions })}\n`,
    'utf8',
  );
}

function resolveSignalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case 'SIGHUP':
      return 129;
    case 'SIGINT':
      return 130;
    case 'SIGQUIT':
      return 131;
    case 'SIGTERM':
      return 143;
    default:
      return 1;
  }
}

function startReleaseAllPreparedTaskWorkspaces(): Promise<void> {
  if (releaseAllPreparedTaskWorkspacesPromise) {
    return releaseAllPreparedTaskWorkspacesPromise;
  }
  releaseAllPreparedTaskWorkspacesPromise = releaseAllPreparedTaskWorkspaces().finally(() => {
    releaseAllPreparedTaskWorkspacesPromise = null;
  });
  return releaseAllPreparedTaskWorkspacesPromise;
}

function ensureMountCleanupHooksRegistered(): void {
  if (cleanupHooksRegistered) return;
  cleanupHooksRegistered = true;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.once(signal, () => {
      void startReleaseAllPreparedTaskWorkspaces().finally(() => {
        process.exit(resolveSignalExitCode(signal));
      });
    });
  }
  process.once('beforeExit', () => {
    if (mountedWorkspaceByMountPath.size === 0) return;
    void startReleaseAllPreparedTaskWorkspaces();
  });
}

export function resolveAgentTaskRunnerMode(): AgentTaskRunnerMode {
  const raw = (process.env.MBOS_AGENT_TASK_RUNNER_MODE ?? '').trim();
  const parsed = parseAgentTaskRunnerMode(raw);
  if (parsed) {
    return parsed;
  }
  throw new Error(`agent_task_runner_mode_invalid:${raw || 'missing'}`);
}

export function buildTaskWorkspaceMountPath(input: {
  mode: AgentTaskRunnerMode;
  taskId: string;
}): string {
  return join('/home', sanitizePathPart(input.taskId, 'task-workspace'));
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

export function buildTaskWorkspacePaths(input: {
  mode: AgentTaskRunnerMode;
  taskHomePath?: string;
  workspacePath?: string;
  artifactsPath?: string;
}): TaskWorkspacePaths {
  const taskHome = normalizeTaskWorkspacePath(input.taskHomePath, 'task_home_path');
  const workspaceDir = normalizeTaskWorkspacePath(input.workspacePath, 'workspace_path');
  const artifactsDir = normalizeTaskWorkspacePath(input.artifactsPath, 'artifacts_path');
  if (taskHome === '/') {
    throw new Error('task_workspace_paths_invalid:task_home_path');
  }
  if (workspaceDir !== join(taskHome, 'workspace')) {
    throw new Error('task_workspace_paths_inconsistent:workspace_path');
  }
  if (artifactsDir !== join(workspaceDir, '.artifacts')) {
    throw new Error('task_workspace_paths_inconsistent:artifacts_path');
  }
  const mbosDir = join(taskHome, '.mbos');
  return {
    mode: input.mode,
    taskHome,
    workspaceDir,
    visibleRoot: workspaceDir,
    mountRoot: taskHome,
    taskRoot: taskHome,
    runtimeRoot: taskHome,
    homeDir: taskHome,
    codexDir: join(taskHome, '.codex'),
    artifactsDir,
    mbosDir,
    skillsDir: join(taskHome, '.agents', 'skills'),
  };
}

function assertWorkspaceAccessPathEchoMatches(input: {
  workspaceAccess: TaskWorkspaceAccessPayload;
  paths: TaskWorkspacePaths;
}): void {
  const checks = [
    {
      field: 'task_home_path',
      raw: input.workspaceAccess.task_home_path,
      expected: input.paths.taskHome,
    },
    {
      field: 'workspace_path',
      raw: input.workspaceAccess.workspace_path,
      expected: input.paths.workspaceDir,
    },
    {
      field: 'artifacts_path',
      raw: input.workspaceAccess.artifacts_path,
      expected: input.paths.artifactsDir,
    },
  ] as const;

  for (const check of checks) {
    if (check.raw === undefined) {
      continue;
    }
    if (typeof check.raw !== 'string') {
      throw new Error(`task_workspace_access_path_invalid:${check.field}`);
    }
    const echoed = normalizeTaskWorkspacePath(check.raw, `workspace_access.${check.field}`);
    if (echoed !== check.expected) {
      throw new Error(`task_workspace_access_path_mismatch:${check.field}`);
    }
  }
}

export function resolveTaskCwd(input: {
  taskId: string;
  taskHomePath?: string;
  workspacePath?: string;
  artifactsPath?: string;
}): { cwd: string; source: 'path_fields'; mode: AgentTaskRunnerMode; paths: TaskWorkspacePaths } {
  const mode = resolveAgentTaskRunnerMode();
  const paths = buildTaskWorkspacePaths({
    mode,
    taskHomePath: input.taskHomePath,
    workspacePath: input.workspacePath,
    artifactsPath: input.artifactsPath,
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
  const payload = await response.json() as TaskWorkspaceAccessPayload;
  debugTaskWorkspace('fetch_workspace_access_ready', {
    task_id: taskId,
    metadata_url: payload.metadata_url,
    storage_bucket_url: payload.storage_bucket_url ?? null,
  });
  return payload;
}

async function mountTaskWorkspace(
  mode: AgentTaskRunnerMode,
  metadataUrl: string,
  mountPath: string,
  storageBucketUrl?: string,
): Promise<MountedWorkspaceSession> {
  await mkdir(mountPath, { recursive: true });
  const cacheRoot = (
    process.env.MBOS_AGENT_JUICEFS_CACHE_ROOT?.trim()
    || join(process.env.HOME || homedir() || '/tmp', '.juicefs', 'cache', 'agentsmith')
  );
  const cacheDir = join(cacheRoot, sanitizePathPart(mountPath, 'workspace'));
  const logRoot = join(process.env.HOME || homedir() || '/tmp', '.juicefs', 'log', 'agentsmith');
  const logPath = join(logRoot, `${sanitizePathPart(mountPath, 'workspace')}.log`);
  await mkdir(cacheDir, { recursive: true });
  await mkdir(logRoot, { recursive: true });
  if (await isMountPointReady(mountPath)) {
    debugTaskWorkspace('mount_workspace_already_ready', {
      mount_path: mountPath,
    });
    const session = buildMountedWorkspaceSession({
      mountPath,
      mode,
      metadataUrl,
      storageBucketUrl,
      logPath,
    });
    markMountedSessionAcquired(session, {
      preserveCreatedAt: false,
      preserveMountedAt: false,
    });
    session.refs = 0;
    return session;
  }
  debugTaskWorkspace('mount_workspace_start', {
    mount_path: mountPath,
    metadata_url: metadataUrl,
    storage_bucket_url: storageBucketUrl ?? null,
    log_path: logPath,
  });
  const child = spawn(
    'juicefs',
    buildJuicefsMountArgs({
      metadataUrl,
      mountPath,
      cacheDir,
      logPath,
      storageBucketUrl,
      }),
    {
      env: buildJuicefsMountEnv(),
      stdio: 'ignore',
    },
  );
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError);
      child.off('exit', onExit);
      resolve();
    };
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      child.off('exit', onExit);
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      reject(new Error(`task_workspace_mount_process_exited:${String(code ?? signal ?? 'unknown')}`));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('exit', onExit);
  });
  await waitForMountPointReady(mountPath, logPath);
  const session = buildMountedWorkspaceSession({
    mountPath,
    mode,
    metadataUrl,
    storageBucketUrl,
    logPath,
  });
  session.child = child;
  session.childExited = false;
  markMountedSessionAcquired(session, {
    preserveCreatedAt: false,
    preserveMountedAt: false,
  });
  session.refs = 0;
  child.once('exit', () => {
    session.childExited = true;
  });
  debugTaskWorkspace('mount_workspace_ready', {
    mount_path: mountPath,
  });
  return session;
}

async function ensureTaskWorkspaceWritable(paths: TaskWorkspacePaths): Promise<void> {
  await mkdir(paths.workspaceDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
}

async function waitForChildProcessExit(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null) {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(false);
    }, DEFAULT_MOUNT_CHILD_EXIT_TIMEOUT_MS);
    const onExit = () => {
      clearTimeout(timeout);
      child.off('error', onError);
      resolve(true);
    };
    const onError = () => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      resolve(true);
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopMountedWorkspaceHelper(session: MountedWorkspaceSession): Promise<void> {
  if (!session.child || session.childExited || session.child.exitCode !== null) {
    return;
  }
  session.child.kill('SIGTERM');
  let exited = await waitForChildProcessExit(session.child);
  if (!exited && session.child.exitCode === null) {
    session.child.kill('SIGKILL');
    exited = await waitForChildProcessExit(session.child);
  }
  if (exited) {
    session.childExited = true;
  }
}

async function runUnmountCommand(input: {
  command: string;
  args: string[];
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      input.command,
      input.args,
      {
        env: buildJuicefsMountEnv(),
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`task_workspace_umount_failed:${input.command}:${input.args.join(' ')}:${String(code ?? 'unknown')}`));
    });
  });
}

async function runJuicefsUmount(mountPath: string, options?: { force?: boolean }): Promise<void> {
  await runUnmountCommand({
    command: 'juicefs',
    args: ['umount', ...(options?.force ? ['-f'] : []), mountPath],
  });
}

async function runLazyHostUmount(mountPath: string): Promise<void> {
  await runUnmountCommand({
    command: 'umount',
    args: ['-l', mountPath],
  });
}

async function runForceLazyHostUmount(mountPath: string): Promise<void> {
  await runUnmountCommand({
    command: 'umount',
    args: ['-lf', mountPath],
  });
}

async function releaseMountPathWithFallback(
  mountPath: string,
  session?: MountedWorkspaceSession,
): Promise<void> {
  const attempts = [
    {
      label: 'juicefs_umount',
      run: () => runJuicefsUmount(mountPath),
    },
    {
      label: 'juicefs_force_umount',
      run: () => runJuicefsUmount(mountPath, { force: true }),
    },
    {
      label: 'runner_lazy_umount',
      run: () => runLazyHostUmount(mountPath),
    },
    {
      label: 'runner_force_lazy_umount',
      run: () => runForceLazyHostUmount(mountPath),
    },
  ];
  let helperStopped = session === undefined;
  for (let index = 0; index < attempts.length; index += 1) {
    if (!helperStopped && index > 0 && session) {
      await stopMountedWorkspaceHelper(session);
      helperStopped = true;
    }
    if (!await isMountPointReady(mountPath)) {
      return;
    }
    try {
      await attempts[index].run();
    } catch (error) {
      debugTaskWorkspace('release_mount_attempt_failed', {
        mount_path: mountPath,
        attempt: attempts[index].label,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (await waitForMountPointReleased(mountPath).then(() => true, () => false)) {
      return;
    }
  }
  throw new Error(`task_workspace_umount_not_ready:${mountPath}`);
}

async function assertTrackedMountEvidenceOrThrow(
  mountPath: string,
  action: 'mount' | 'release',
): Promise<void> {
  if (!await isMountPointReady(mountPath)) {
    return;
  }
  throw new Error(
    action === 'mount'
      ? `task_workspace_mount_untracked_live_mount:${mountPath}`
      : `task_workspace_release_untracked_live_mount:${mountPath}`,
  );
}

async function resolveTrackedMountedWorkspaceSession(
  mountPath: string,
): Promise<MountedWorkspaceSession | null> {
  const existing = mountedWorkspaceByMountPath.get(mountPath);
  if (existing) {
    return existing;
  }
  const persistedSessions = await loadPersistedMountedWorkspaceSessions();
  const persistedSession = persistedSessions.get(mountPath);
  if (!persistedSession) {
    return null;
  }
  const hydratedSession = hydrateMountedWorkspaceSession(persistedSession);
  mountedWorkspaceByMountPath.set(mountPath, hydratedSession);
  return hydratedSession;
}

async function releaseMountedWorkspaceSession(
  mountPath: string,
  options?: {
    force?: boolean;
    lease?: TaskWorkspaceLease;
    allowForeignStaleRelease?: boolean;
  },
): Promise<void> {
  const session = await resolveTrackedMountedWorkspaceSession(mountPath);
  if (!session) {
    await assertTrackedMountEvidenceOrThrow(mountPath, 'release');
    return;
  }
  const allowForeignStaleRelease = options?.allowForeignStaleRelease === true;
  const ownerAuthority = allowForeignStaleRelease
    ? await resolveMountedWorkspaceOwnerAuthority(session)
    : null;
  if (await isMountPointReady(mountPath) && !hasTrackedMountedWorkspaceEvidence(session)) {
    if (!(allowForeignStaleRelease && ownerAuthority?.kind === 'stale_owner')) {
      throw new Error(`task_workspace_release_untracked_live_mount:${mountPath}`);
    }
  }

  const leaseMatches = options?.lease
    ? doesTaskWorkspaceLeaseMatchSession(session, options.lease)
    : false;
  if (allowForeignStaleRelease && ownerAuthority && ownerAuthority.kind !== 'stale_owner') {
    throw new Error(`task_workspace_mount_owned_by_live_runner:${mountPath}`);
  }
  if (!leaseMatches && !allowForeignStaleRelease) {
    if (options?.lease) {
      throw new Error(`task_workspace_release_lease_mismatch:${mountPath}`);
    }
    throw new Error(`task_workspace_release_requires_lease:${mountPath}`);
  }

  if (session.state === 'released') {
    releasedMountedWorkspaceByMountPath.add(mountPath);
    await persistMountedWorkspaceSessions();
    mountedWorkspaceByMountPath.delete(mountPath);
    releasedMountedWorkspaceByMountPath.delete(mountPath);
    return;
  }

  if (!options?.force && session.refs > 1) {
    session.refs -= 1;
    session.lastRefChangeAt = nowIsoString();
    session.updatedAt = session.lastRefChangeAt;
    await persistMountedWorkspaceSessions();
    return;
  }

  const attemptedAt = nowIsoString();
  session.state = 'releasing';
  session.lastReleaseAttemptAt = attemptedAt;
  session.lastReleaseOutcome = 'pending';
  session.lastReleaseError = null;
  session.updatedAt = attemptedAt;
  await persistMountedWorkspaceSessions();

  try {
    if (await isMountPointReady(mountPath)) {
      await releaseMountPathWithFallback(mountPath, session);
    }
    await stopMountedWorkspaceHelper(session);
    const releasedAt = nowIsoString();
    session.state = 'released';
    session.refs = 0;
    session.lastRefChangeAt = releasedAt;
    session.lastReleasedAt = releasedAt;
    session.lastReleaseOutcome = 'released';
    session.lastReleaseError = null;
    session.updatedAt = releasedAt;
    appendReleaseAttempt(session, {
      attempted_at: attemptedAt,
      outcome: 'released',
      error: null,
    });
    releasedMountedWorkspaceByMountPath.add(mountPath);
    await persistMountedWorkspaceSessions();
    mountedWorkspaceByMountPath.delete(mountPath);
    releasedMountedWorkspaceByMountPath.delete(mountPath);
  } catch (error) {
    await stopMountedWorkspaceHelper(session);
    const failureMessage = error instanceof Error ? error.message : String(error);
    session.state = 'release_failed';
    session.lastReleaseOutcome = 'failed';
    session.lastReleaseError = failureMessage;
    session.updatedAt = nowIsoString();
    appendReleaseAttempt(session, {
      attempted_at: attemptedAt,
      outcome: 'failed',
      error: failureMessage,
    });
    await persistMountedWorkspaceSessions();
    throw error;
  }
}

async function acquireMountedWorkspaceSession(input: {
  mode: AgentTaskRunnerMode;
  filesystemName: string;
  metadataUrl: string;
  mountPath: string;
  storageBucketUrl?: string;
  priorLeaseRevisionFloor?: number;
}): Promise<{ session: MountedWorkspaceSession; lease: TaskWorkspaceLease }> {
  ensureMountCleanupHooksRegistered();
  const existing = await resolveTrackedMountedWorkspaceSession(input.mountPath);
  let priorSessionEvidence: MountedWorkspaceSession | null = null;
  if (existing) {
    const mountReady = await isMountPointReady(input.mountPath);
    const ownedByAnotherRunner = isMountedWorkspaceSessionOwnedByAnotherRunner(existing);
    const ownerAuthority = existing.state === 'mounted' && mountReady
      ? await resolveMountedWorkspaceOwnerAuthority(existing)
      : null;
    if (existing.state === 'mounted' && mountReady && !hasTrackedMountedWorkspaceEvidence(existing)) {
      if (isMountedWorkspaceOwnerLiveForeign(ownerAuthority ?? {
        kind: 'ownerless_other_runner_live',
        reason: 'other_runner_alive_without_owner_evidence',
      })) {
        throw new Error(`task_workspace_mount_owned_by_live_runner:${input.mountPath}`);
      }
      const canAttemptLegacyAdoption = ownerAuthority?.kind === 'current_runner'
        || ownerAuthority?.kind === 'ownerless_reclaimable';
      const mountTruth = canAttemptLegacyAdoption
        ? await verifyMountedWorkspaceTruth({
          mountPath: input.mountPath,
          filesystemName: input.filesystemName,
          metadataUrl: input.metadataUrl,
          storageBucketUrl: input.storageBucketUrl,
        })
        : null;
      if (mountTruth) {
        debugTaskWorkspace('legacy_mount_truth_verification', {
          mount_path: input.mountPath,
          owner_authority: ownerAuthority?.kind ?? null,
          status: mountTruth.status,
          reason: mountTruth.reason,
          source: mountTruth.source,
          fstype: mountTruth.fstype,
        });
        if (mountTruth.status === 'mismatch') {
          throw new Error(`task_workspace_mount_truth_mismatch:${input.mountPath}`);
        }
      }
      if (ownerAuthority?.kind === 'current_runner') {
        if (mountTruth?.status !== 'match') {
          throw new Error(`task_workspace_mount_untracked_live_mount:${input.mountPath}`);
        }
        existing.mode = input.mode;
        existing.metadataUrl = input.metadataUrl;
        existing.storageBucketUrl = input.storageBucketUrl;
        markMountedSessionAcquired(existing);
        await persistMountedWorkspaceSessions();
        return {
          session: existing,
          lease: ensureMountedWorkspaceLease(existing),
        };
      }
      if (ownerAuthority?.kind === 'ownerless_reclaimable') {
        if (mountTruth?.status !== 'match') {
          throw new Error(`task_workspace_mount_untracked_live_mount:${input.mountPath}`);
        }
        existing.mode = input.mode;
        existing.metadataUrl = input.metadataUrl;
        existing.storageBucketUrl = input.storageBucketUrl;
        existing.refs = 0;
        existing.ownerProcessPid = null;
        existing.runnerInstanceId = null;
        existing.leaseId = null;
        existing.leaseRevision = 0;
        markMountedSessionAcquired(existing);
        await persistMountedWorkspaceSessions();
        return {
          session: existing,
          lease: ensureMountedWorkspaceLease(existing),
        };
      }
      if (ownerAuthority?.kind !== 'stale_owner') {
        throw new Error(`task_workspace_mount_untracked_live_mount:${input.mountPath}`);
      }
    }
    if (existing.state === 'mounted' && mountReady && !ownedByAnotherRunner) {
      existing.mode = input.mode;
      existing.metadataUrl = input.metadataUrl;
      existing.storageBucketUrl = input.storageBucketUrl;
      markMountedSessionAcquired(existing);
      await persistMountedWorkspaceSessions();
      return {
        session: existing,
        lease: ensureMountedWorkspaceLease(existing),
      };
    }
    if (existing.state === 'mounted' && mountReady && ownedByAnotherRunner) {
      const foreignOwnerLive = isMountedWorkspaceOwnerLiveForeign(
        ownerAuthority ?? await resolveMountedWorkspaceOwnerAuthority(existing),
      );
      debugTaskWorkspace('reacquire_foreign_owned_mount', {
        mount_path: input.mountPath,
        owner_process_pid: existing.ownerProcessPid,
        owner_runner_instance_id: existing.runnerInstanceId,
        owner_alive: foreignOwnerLive,
      });
      if (foreignOwnerLive) {
        mountedWorkspaceByMountPath.delete(input.mountPath);
        throw new Error(`task_workspace_mount_owned_by_live_runner:${input.mountPath}`);
      }
    }
    if (existing.state === 'released' || !mountReady) {
      priorSessionEvidence = {
        ...existing,
        releaseAttempts: [...existing.releaseAttempts],
      };
      mountedWorkspaceByMountPath.delete(input.mountPath);
    } else {
      priorSessionEvidence = {
        ...existing,
        releaseAttempts: [...existing.releaseAttempts],
      };
      const sessionLease = !ownedByAnotherRunner && hasTrackedMountedWorkspaceEvidence(existing)
        ? ensureMountedWorkspaceLease(existing)
        : undefined;
      await releaseMountedWorkspaceSession(input.mountPath, {
        force: true,
        lease: sessionLease,
        allowForeignStaleRelease: ownedByAnotherRunner || ownerAuthority?.kind === 'stale_owner',
      }).catch((error) => {
        debugTaskWorkspace('release_stale_mount_before_reacquire_failed', {
          mount_path: input.mountPath,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    }
  }
  if (!existing) {
    await assertTrackedMountEvidenceOrThrow(input.mountPath, 'mount');
  }

  const session = await mountTaskWorkspace(
    input.mode,
    input.metadataUrl,
    input.mountPath,
    input.storageBucketUrl,
  );
  const priorLeaseRevision = Math.max(
    priorSessionEvidence?.leaseRevision ?? 0,
    input.priorLeaseRevisionFloor ?? 0,
  );
  const lease = priorLeaseRevision > 0
    ? rotateMountedWorkspaceLease(session, priorLeaseRevision)
    : ensureMountedWorkspaceLease(session);
  markMountedSessionAcquired(session, {
    preserveCreatedAt: session.createdAt !== null,
    preserveMountedAt: session.mountedAt !== null,
  });
  if (priorSessionEvidence) {
    session.releaseAttempts = priorSessionEvidence.releaseAttempts.slice(-MAX_RELEASE_ATTEMPTS_HISTORY);
  }
  mountedWorkspaceByMountPath.set(input.mountPath, session);
  await persistMountedWorkspaceSessions();
  return { session, lease };
}

export async function releaseAllPreparedTaskWorkspaces(): Promise<void> {
  for (const [mountPath, session] of Array.from(mountedWorkspaceByMountPath.entries())) {
    try {
      await releaseMountedWorkspaceSession(mountPath, {
        force: true,
        lease: isMountedWorkspaceSessionOwnedByAnotherRunner(session)
          ? undefined
          : getMountedWorkspaceLease(session) ?? ensureMountedWorkspaceLease(session),
        allowForeignStaleRelease: isMountedWorkspaceSessionOwnedByAnotherRunner(session),
      });
    } catch (error) {
      debugTaskWorkspace('release_all_mounts_failed', {
        mount_path: mountPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function prepareTaskWorkspace(input: {
  executionContext: FileLibraryWorkspaceExecutionContext;
  username: string;
  taskId: string;
}): Promise<{
  cwd: string;
  source: 'path_fields' | 'file_library_mount';
  paths: TaskWorkspacePaths;
  lease?: TaskWorkspaceLease;
  release: () => Promise<void>;
}> {
  const mode = resolveAgentTaskRunnerMode();
  const resolved = resolveTaskCwd({
    taskHomePath: input.executionContext.task_home_path,
    workspacePath: input.executionContext.workspace_path,
    artifactsPath: input.executionContext.artifacts_path,
    taskId: input.taskId,
  });
  const paths = resolved.paths;

  if (input.executionContext.workspace_binding_mode === 'pre_mounted') {
    return {
      cwd: resolved.cwd,
      source: resolved.source,
      paths,
      release: async () => undefined,
    };
  }

  if (input.executionContext.workspace_binding_mode === 'file_library') {
    const workspaceAccess = await fetchTaskWorkspaceAccess(input.executionContext);
    assertWorkspaceAccessPathEchoMatches({ workspaceAccess, paths });
    const mountPath = paths.taskHome;
    let priorLeaseRevisionFloor = 0;
    const maxAttempts = Number.parseInt(process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT ?? '', 10)
      || DEFAULT_MOUNT_RETRY_COUNT;
    const retryDelayMs = Number.parseInt(process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_DELAY_MS ?? '', 10)
      || DEFAULT_MOUNT_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let workspaceLease: TaskWorkspaceLease | null = null;
      try {
        const acquired = await acquireMountedWorkspaceSession({
          mode,
          filesystemName: workspaceAccess.filesystem_name,
          metadataUrl: workspaceAccess.metadata_url,
          mountPath,
          storageBucketUrl: workspaceAccess.storage_bucket_url,
          priorLeaseRevisionFloor,
        });
        workspaceLease = acquired.lease;
        await ensureTaskWorkspaceWritable(paths);
        return {
          cwd: paths.workspaceDir,
          source: 'file_library_mount',
          paths,
          lease: workspaceLease,
          release: async () => {
            await releaseMountedWorkspaceSession(mountPath, {
              lease: workspaceLease ?? undefined,
            });
          },
        };
      } catch (error) {
        const retryableMountFailure = shouldRetryTaskWorkspaceMount(error);
        const retryableWriteFailure = shouldRetryTaskWorkspaceWriteFailure(error);
        debugTaskWorkspace('mount_workspace_attempt_failed', {
          mount_path: mountPath,
          attempt,
          max_attempts: maxAttempts,
          force_remount: retryableWriteFailure,
          message: error instanceof Error ? error.message : String(error),
          code: typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : null,
        });
        if (retryableWriteFailure) {
          const currentSession = await resolveTrackedMountedWorkspaceSession(mountPath);
          priorLeaseRevisionFloor = Math.max(
            priorLeaseRevisionFloor,
            currentSession?.leaseRevision ?? 0,
          );
          const currentLease = currentSession && !isMountedWorkspaceSessionOwnedByAnotherRunner(currentSession)
            ? getMountedWorkspaceLease(currentSession) ?? ensureMountedWorkspaceLease(currentSession)
            : undefined;
          await releaseMountedWorkspaceSession(mountPath, {
            force: true,
            lease: currentLease,
            allowForeignStaleRelease: currentSession
              ? isMountedWorkspaceSessionOwnedByAnotherRunner(currentSession)
              : false,
          }).catch((releaseError) => {
            debugTaskWorkspace('mount_workspace_release_before_retry_failed', {
              mount_path: mountPath,
              message: releaseError instanceof Error ? releaseError.message : String(releaseError),
            });
          });
        }
        if (attempt >= maxAttempts || (!retryableMountFailure && !retryableWriteFailure)) {
          throw error;
        }
        await sleep(retryDelayMs);
      }
    }
    throw new Error(`task_workspace_mount_exhausted:${mountPath}`);
  }

  return {
    cwd: resolved.cwd,
    source: resolved.source,
    paths,
    release: async () => undefined,
  };
}

export function clearPreparedTaskWorkspaces(): void {
  mountedWorkspaceByMountPath.clear();
  releasedMountedWorkspaceByMountPath.clear();
}

export async function releasePreparedTaskWorkspace(
  mountPath: string,
  lease?: TaskWorkspaceLease,
): Promise<void> {
  await releaseMountedWorkspaceSession(mountPath, {
    force: true,
    lease,
  });
}

export async function evictPreparedTaskWorkspace(mountPath: string): Promise<void> {
  const session = await resolveTrackedMountedWorkspaceSession(mountPath);
  if (!session) {
    await assertTrackedMountEvidenceOrThrow(mountPath, 'release');
    return;
  }
  await releaseMountedWorkspaceSession(mountPath, {
    force: true,
    lease: isMountedWorkspaceSessionOwnedByAnotherRunner(session)
      ? undefined
      : getMountedWorkspaceLease(session) ?? ensureMountedWorkspaceLease(session),
    allowForeignStaleRelease: isMountedWorkspaceSessionOwnedByAnotherRunner(session),
  });
}
