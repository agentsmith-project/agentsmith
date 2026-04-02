import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import {
  buildNotebookHeadlessPreamble,
  prepareNotebookWorkspaceAssets,
} from './notebook-assets.js';
import { prepareTaskWorkspace, type TaskWorkspacePaths } from './task-workspace.js';
import { applyExecutionContextFiles, type ExecutionContextFileItem } from './execution-context-files.js';

export type TerminalExecutionContext = {
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  username?: string;
  session_id?: string;
  api_base?: string;
  execution_ticket?: string;
  workspace_path?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
  notebook_mode?: boolean;
  task_inputs?: Array<{
    kind?: 'library_object' | 'artifact' | 'url';
    library_id?: string;
    key?: string;
    task_id?: string;
    artifact_id?: string;
    task_relative_path?: string;
    url?: string;
    imported_library_id?: string;
    imported_key?: string;
    filename?: string;
    file_type?: string;
    file_size?: number;
  }>;
  credential_files?: ExecutionContextFileItem[];
};

export type TerminalProcess = ChildProcessWithoutNullStreams;

function debugTerminalRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-codex-runner][terminal-runtime] ${message}${payload}\n`);
}

function sanitizePathPart(input: string | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
}

function resolveTerminalShell(shellOverride?: string): string {
  const explicit = shellOverride?.trim();
  if (explicit) return explicit;
  const envShell = process.env.SHELL?.trim();
  if (envShell) return envShell;
  return 'bash';
}

function buildInteractiveCommand(shellOverride?: string): string {
  const shell = resolveTerminalShell(shellOverride);
  if (/pwsh(?:\.exe)?$/i.test(shell) || /powershell(?:\.exe)?$/i.test(shell)) {
    return `${shell} -NoLogo`;
  }
  return `${shell} -i`;
}

async function primeShellDotfiles(homeDir: string, shellOverride?: string): Promise<void> {
  const shell = resolveTerminalShell(shellOverride);
  if (!/zsh$/i.test(shell)) return;
  await writeFile(join(homeDir, '.zshrc'), '# AgentSmith Terminal Session\n', {
    flag: 'a',
  });
}

export async function prepareTerminalWorkspace(input: {
  executionContext: TerminalExecutionContext;
  shell?: string;
}): Promise<{
  cwd: string;
  taskPaths: TaskWorkspacePaths;
  command: string;
  env: NodeJS.ProcessEnv;
}> {
  const executionContext = input.executionContext;
  debugTerminalRuntime('prepare_workspace_start', {
    task_id: executionContext.task_id ?? null,
    workspace_binding_mode: executionContext.workspace_binding_mode ?? null,
    workspace_path: executionContext.workspace_path ?? null,
    has_execution_ticket: typeof executionContext.execution_ticket === 'string' && executionContext.execution_ticket.length > 0,
    notebook_mode: executionContext.notebook_mode === true,
  });
  const username = sanitizePathPart(executionContext.username, 'unknown_user');
  const taskId = sanitizePathPart(
    executionContext.task_id,
    sanitizePathPart(executionContext.session_id, 'terminal-task'),
  );
  const cwdResult = await prepareTaskWorkspace({
    executionContext,
    username,
    taskId,
  });
  debugTerminalRuntime('prepare_workspace_task_ready', {
    cwd: cwdResult.cwd,
    source: cwdResult.source,
  });
  const cwd = cwdResult.cwd;
  const taskPaths = cwdResult.paths;
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(taskPaths.codexHomeDir, { recursive: true }),
    mkdir(taskPaths.homeDir, { recursive: true }),
  ]);
  await primeShellDotfiles(taskPaths.homeDir, input.shell);

  const isNotebookMode = executionContext.notebook_mode === true;
  const taskInputs = Array.isArray(executionContext.task_inputs) ? executionContext.task_inputs : [];
  if (isNotebookMode) {
    await prepareNotebookWorkspaceAssets({
      cwd,
      paths: taskPaths,
      executionContext,
      taskInputs,
    });
    debugTerminalRuntime('prepare_workspace_assets_ready', {
      cwd,
      artifacts_dir: taskPaths.artifactsDir,
    });
  }
  const credentialFiles = Array.isArray(executionContext.credential_files)
    ? executionContext.credential_files
    : [];
  await applyExecutionContextFiles(cwd, credentialFiles, {
    credentialDir: taskPaths.credentialDir,
  });
  debugTerminalRuntime('prepare_workspace_credentials_ready', {
    cwd,
    credential_files_count: credentialFiles.length,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: taskPaths.homeDir,
    TERM: process.env.TERM || 'xterm-256color',
    NO_COLOR: '1',
    MBOS_TASK_CREDENTIAL_DIR: taskPaths.credentialDir,
    ...(isNotebookMode ? {
      MBOS_NOTEBOOK_API_BASE: executionContext.api_base ?? '',
      MBOS_NOTEBOOK_WORKSPACE_ID: executionContext.workspace_id ?? '',
      MBOS_NOTEBOOK_PROJECT_ID: executionContext.project_id ?? '',
      MBOS_NOTEBOOK_EXECUTION_TICKET: executionContext.execution_ticket ?? '',
      MBOS_NOTEBOOK_PREAMBLE: buildNotebookHeadlessPreamble({
        artifactsDir: taskPaths.artifactsDir,
      }),
    } : {}),
  };

  return {
    cwd,
    taskPaths,
    command: buildInteractiveCommand(input.shell),
    env,
  };
}

export async function startTerminalProcess(input: {
  executionContext: TerminalExecutionContext;
  shell?: string;
}): Promise<{
  child: TerminalProcess;
  cwd: string;
}> {
  const prepared = await prepareTerminalWorkspace(input);
  debugTerminalRuntime('spawn_script_start', {
    cwd: prepared.cwd,
    command: prepared.command,
  });
  const child = spawn(
    'script',
    ['-qf', '-c', prepared.command, '/dev/null'],
    {
      cwd: prepared.cwd,
      env: prepared.env,
      stdio: 'pipe',
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  debugTerminalRuntime('spawn_script_ready', {
    cwd: prepared.cwd,
  });
  return {
    child,
    cwd: prepared.cwd,
  };
}
