import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const DEFAULT_MOUNT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_MOUNT_READY_POLL_MS = 250;
const DEFAULT_MOUNT_RETRY_COUNT = 2;
const DEFAULT_MOUNT_RETRY_DELAY_MS = 750;

type FileLibraryWorkspaceExecutionContext = {
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  api_base?: string;
  workspace_path?: string;
  execution_ticket?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
};

type TaskWorkspaceAccessPayload = {
  task_id: string;
  workspace_binding_mode: 'file_library';
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
  rootCwd: string;
  codexRootDir: string;
  codexHomeDir: string;
  homeDir: string;
  artifactsDir: string;
  credentialDir: string;
};

const mountedWorkspaceByMountPath = new Set<string>();

function debugTaskWorkspace(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-codex-runner][task-workspace] ${message}${payload}\n`);
}

export function shouldRetryTaskWorkspaceMount(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('task_workspace_mount_not_ready')
    || message.includes('connection reset by peer')
    || message.includes('failed to receive message');
}

function sanitizeWorkspacePath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value;
}

function sanitizePathPart(input: string | null | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
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
    if (!content) {
      return '';
    }
    return content
      .split('\n')
      .slice(-20)
      .join('\n');
  } catch {
    return '';
  }
}

async function waitForMountPointReady(mountPath: string, logPath: string): Promise<void> {
  const timeoutMs = Number.parseInt(process.env.MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS ?? '', 10)
    || DEFAULT_MOUNT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isMountPointReady(mountPath)) {
      return;
    }
    await sleep(DEFAULT_MOUNT_READY_POLL_MS);
  }
  const logExcerpt = await readMountLogExcerpt(logPath);
  throw new Error(
    logExcerpt
      ? `task_workspace_mount_not_ready:${logExcerpt}`
      : 'task_workspace_mount_not_ready',
  );
}

function buildStableWorkspaceStateKey(cwd: string): string {
  const label = sanitizePathPart(basename(cwd), 'workspace');
  const digest = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
  return `${label}-${digest}`;
}

export function buildTaskWorkspacePaths(cwd: string, taskId: string): TaskWorkspacePaths {
  const codexWorkspaceRoot = join(
    process.env.MBOS_AGENT_CODEX_STATE_ROOT?.trim() || '/var/tmp/agentsmith-codex',
    buildStableWorkspaceStateKey(cwd),
  );
  const codexRootDir = join(codexWorkspaceRoot, 'tasks');
  const codexHomeDir = join(codexRootDir, taskId);
  return {
    rootCwd: cwd,
    codexRootDir,
    codexHomeDir,
    homeDir: join(codexHomeDir, 'home'),
    artifactsDir: join(cwd, '.artifacts'),
    credentialDir: join(codexWorkspaceRoot, 'credentials', taskId),
  };
}

export function resolveTaskCwd(input: {
  workspacePath?: string;
  username: string;
  taskId: string;
}): { cwd: string; source: 'workspace_path' | 'tmp_fallback' } {
  const workspacePath = sanitizeWorkspacePath(input.workspacePath);
  if (workspacePath) {
    return {
      cwd: workspacePath,
      source: 'workspace_path',
    };
  }
  return {
    cwd: join('/tmp', input.username, input.taskId),
    source: 'tmp_fallback',
  };
}

export function buildTaskWorkspaceMountPath(input: {
  username: string;
  workspaceDirName?: string | null;
  taskId: string;
  workspaceRoot?: string;
}): string {
  const configuredRoot = sanitizeWorkspacePath(input.workspaceRoot);
  const fallbackRoot = join(process.env.HOME || homedir() || join('/tmp', input.username), 'ags-workspaces');
  const workspaceRoot = configuredRoot || fallbackRoot;
  return join(
    workspaceRoot,
    sanitizePathPart(input.workspaceDirName, sanitizePathPart(input.taskId, 'task-workspace')),
  );
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
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
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

async function mountTaskWorkspace(metadataUrl: string, mountPath: string, storageBucketUrl?: string): Promise<void> {
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
    return;
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
      detached: true,
      stdio: 'ignore',
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  debugTaskWorkspace('mount_workspace_spawned', {
    mount_path: mountPath,
    log_path: logPath,
  });
  child.unref();
  await waitForMountPointReady(mountPath, logPath);
  debugTaskWorkspace('mount_workspace_ready', {
    mount_path: mountPath,
  });
}

export async function prepareTaskWorkspace(input: {
  executionContext: FileLibraryWorkspaceExecutionContext;
  username: string;
  taskId: string;
}): Promise<{
  cwd: string;
  source: 'workspace_path' | 'tmp_fallback' | 'file_library_mount';
  paths: TaskWorkspacePaths;
}> {
  if (input.executionContext.workspace_binding_mode === 'pre_mounted') {
    const resolved = resolveTaskCwd({
      workspacePath: input.executionContext.workspace_path,
      username: input.username,
      taskId: input.taskId,
    });
    return {
      ...resolved,
      paths: buildTaskWorkspacePaths(resolved.cwd, input.taskId),
    };
  }

  if (input.executionContext.workspace_binding_mode === 'file_library') {
    const workspaceAccess = await fetchTaskWorkspaceAccess(input.executionContext);
    const mountPath = buildTaskWorkspaceMountPath({
      username: input.username,
      workspaceDirName: workspaceAccess.workspace_dir_name,
      taskId: input.taskId,
      workspaceRoot: process.env.MBOS_AGENT_WORKSPACE_ROOT,
    });
    if (!mountedWorkspaceByMountPath.has(mountPath)) {
      const maxAttempts = Number.parseInt(
        process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT ?? '',
        10,
      ) || DEFAULT_MOUNT_RETRY_COUNT;
      const retryDelayMs = Number.parseInt(
        process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_DELAY_MS ?? '',
        10,
      ) || DEFAULT_MOUNT_RETRY_DELAY_MS;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await mountTaskWorkspace(
            workspaceAccess.metadata_url,
            mountPath,
            workspaceAccess.storage_bucket_url,
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          debugTaskWorkspace('mount_workspace_attempt_failed', {
            mount_path: mountPath,
            attempt,
            max_attempts: maxAttempts,
            message: error instanceof Error ? error.message : String(error),
          });
          if (attempt >= maxAttempts || !shouldRetryTaskWorkspaceMount(error)) {
            throw error;
          }
          await sleep(retryDelayMs);
        }
      }
      if (lastError) {
        throw lastError;
      }
      mountedWorkspaceByMountPath.add(mountPath);
    }
    return {
      cwd: mountPath,
      source: 'file_library_mount',
      paths: buildTaskWorkspacePaths(mountPath, input.taskId),
    };
  }

  const resolved = resolveTaskCwd({
    workspacePath: input.executionContext.workspace_path ?? process.env.WORKSPACE_PATH,
    username: input.username,
    taskId: input.taskId,
  });
  return {
    ...resolved,
    paths: buildTaskWorkspacePaths(resolved.cwd, input.taskId),
  };
}

export function clearPreparedTaskWorkspaces(): void {
  mountedWorkspaceByMountPath.clear();
}
