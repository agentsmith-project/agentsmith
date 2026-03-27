import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const DEFAULT_MOUNT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_MOUNT_READY_POLL_MS = 250;

type FileLibraryWorkspaceExecutionContext = {
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  api_base?: string;
  workspace_path?: string;
  user_bearer_token?: string;
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
  sharedSkillsDir: string;
  codexDir: string;
  homeDir: string;
  artifactsDir: string;
};

const mountedWorkspaceByMountPath = new Set<string>();

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

export function buildTaskWorkspacePaths(cwd: string, _taskId: string): TaskWorkspacePaths {
  return {
    rootCwd: cwd,
    sharedSkillsDir: join(cwd, '.codex', 'skills'),
    codexDir: join(cwd, '.codex'),
    homeDir: cwd,
    artifactsDir: join(cwd, '.artifacts'),
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
  const userBearerToken = (executionContext.user_bearer_token ?? '').trim();
  if (!apiBase || !workspaceId || !projectId || !taskId || !userBearerToken) {
    throw new Error('task_workspace_access_context_missing');
  }

  const response = await fetch(
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/tasks/${encodeURIComponent(taskId)}/workspace-access`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userBearerToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`task_workspace_access_failed:${response.status}`);
  }
  return await response.json() as TaskWorkspaceAccessPayload;
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
    return;
  }
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
  child.unref();
  await waitForMountPointReady(mountPath, logPath);
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
      await mountTaskWorkspace(workspaceAccess.metadata_url, mountPath, workspaceAccess.storage_bucket_url);
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
