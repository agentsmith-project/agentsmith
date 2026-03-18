import { execFile as execFileCallback } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

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
  recommended_mount_path?: string;
  created_at?: string;
};

const mountedWorkspaceByTaskId = new Map<string, string>();

function sanitizeWorkspacePath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value;
}

function sanitizePathPart(input: string | null | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
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

async function mountTaskWorkspace(metadataUrl: string, mountPath: string): Promise<void> {
  await mkdir(mountPath, { recursive: true });
  await execFile('juicefs', ['mount', metadataUrl, mountPath, '-d']);
}

export async function prepareTaskWorkspace(input: {
  executionContext: FileLibraryWorkspaceExecutionContext;
  username: string;
  taskId: string;
}): Promise<{ cwd: string; source: 'workspace_path' | 'tmp_fallback' | 'file_library_mount' }> {
  if (input.executionContext.workspace_binding_mode === 'pre_mounted') {
    return resolveTaskCwd({
      workspacePath: input.executionContext.workspace_path,
      username: input.username,
      taskId: input.taskId,
    });
  }

  if (input.executionContext.workspace_binding_mode === 'file_library') {
    const workspaceAccess = await fetchTaskWorkspaceAccess(input.executionContext);
    const cached = mountedWorkspaceByTaskId.get(input.taskId);
    if (cached) {
      return {
        cwd: cached,
        source: 'file_library_mount',
      };
    }
    const mountPath = buildTaskWorkspaceMountPath({
      username: input.username,
      workspaceDirName: workspaceAccess.workspace_dir_name,
      taskId: input.taskId,
      workspaceRoot: process.env.MBOS_AGENT_WORKSPACE_ROOT,
    });
    await mountTaskWorkspace(workspaceAccess.metadata_url, mountPath);
    mountedWorkspaceByTaskId.set(input.taskId, mountPath);
    return {
      cwd: mountPath,
      source: 'file_library_mount',
    };
  }

  return resolveTaskCwd({
    workspacePath: input.executionContext.workspace_path ?? process.env.WORKSPACE_PATH,
    username: input.username,
    taskId: input.taskId,
  });
}

export function clearPreparedTaskWorkspaces(): void {
  mountedWorkspaceByTaskId.clear();
}
