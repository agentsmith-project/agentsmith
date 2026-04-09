import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn as spawnPty } from 'node-pty';
import {
  buildNotebookHeadlessPreamble,
  prepareNotebookWorkspaceAssets,
} from './notebook-assets.js';
import { prepareTaskWorkspace, type TaskWorkspacePaths } from './task-workspace.js';
import { buildAgentRuntimeEnv } from './agent-runtime-env.js';
import { prepareLaunchCommand } from './child-launcher.js';
import { inspectBuiltinSkills, resolveBuiltinSkillsConfig, seedBuiltinSkills } from './builtin-skills.js';
import { buildTaskUserInstallEnv } from './user-install-env.js';

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
  interaction_kind?: 'chat' | 'notebook';
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
};

export type TerminalProcess = {
  readonly exitCode: number | null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
};

function debugTerminalRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-codex-runner][terminal-runtime] ${message}${payload}\n`);
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
  if (process.platform === 'win32') {
    return 'pwsh.exe';
  }
  return 'bash';
}

function buildInteractiveCommand(shellOverride?: string): {
  file: string;
  args: string[];
} {
  const shell = resolveTerminalShell(shellOverride);
  if (/pwsh(?:\.exe)?$/i.test(shell) || /powershell(?:\.exe)?$/i.test(shell)) {
    return {
      file: shell,
      args: ['-NoLogo'],
    };
  }
  return {
    file: shell,
    args: ['-i'],
  };
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
  shellFile: string;
  shellArgs: string[];
  env: NodeJS.ProcessEnv;
}> {
  const executionContext = input.executionContext;
  debugTerminalRuntime('prepare_workspace_start', {
    task_id: executionContext.task_id ?? null,
    workspace_binding_mode: executionContext.workspace_binding_mode ?? null,
    workspace_path: executionContext.workspace_path ?? null,
    has_execution_ticket: typeof executionContext.execution_ticket === 'string' && executionContext.execution_ticket.length > 0,
    interaction_kind: executionContext.interaction_kind ?? null,
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
    mkdir(taskPaths.codexDir, { recursive: true }),
    mkdir(taskPaths.mbosDir, { recursive: true }),
    mkdir(taskPaths.skillsDir, { recursive: true }),
  ]);
  await primeShellDotfiles(taskPaths.homeDir, input.shell);
  const builtinSkillsConfig = resolveBuiltinSkillsConfig();
  const builtinSkillsResult = await inspectBuiltinSkills({
    sourceDir: builtinSkillsConfig.sourceDir,
    skills: builtinSkillsConfig.skills,
    required: builtinSkillsConfig.required,
  });
  await seedBuiltinSkills({
    sourceDir: builtinSkillsResult.sourceDir,
    skills: builtinSkillsResult.available,
    targetDir: taskPaths.skillsDir,
    manifestDir: taskPaths.mbosDir,
  });

  const isNotebookMode = executionContext.interaction_kind === 'notebook';
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
  const env = buildTaskUserInstallEnv(taskPaths.homeDir, {
    ...process.env,
    TERM: process.env.TERM || 'xterm-256color',
    NO_COLOR: '1',
    ...buildAgentRuntimeEnv(executionContext),
    ...(isNotebookMode ? {
      MBOS_NOTEBOOK_PREAMBLE: buildNotebookHeadlessPreamble({
        artifactsDir: taskPaths.artifactsDir,
      }),
    } : {}),
  });
  const interactiveCommand = buildInteractiveCommand(input.shell);
  const launchCommand = await prepareLaunchCommand({
    file: interactiveCommand.file,
    args: interactiveCommand.args,
    cwd,
    env,
  });

  return {
    cwd,
    taskPaths,
    shellFile: launchCommand.file,
    shellArgs: launchCommand.args,
    env: launchCommand.env,
  };
}

export async function startTerminalProcess(input: {
  executionContext: TerminalExecutionContext;
  shell?: string;
  cols?: number;
  rows?: number;
}): Promise<{
  child: TerminalProcess;
  cwd: string;
}> {
  const prepared = await prepareTerminalWorkspace(input);
  debugTerminalRuntime('spawn_pty_start', {
    cwd: prepared.cwd,
    shell: prepared.shellFile,
    args: prepared.shellArgs,
  });
  const child = spawnPty(prepared.shellFile, prepared.shellArgs, {
    cwd: prepared.cwd,
    env: prepared.env,
    cols: input.cols ?? 120,
    rows: input.rows ?? 30,
    name: prepared.env.TERM || 'xterm-256color',
  });
  debugTerminalRuntime('spawn_pty_ready', {
    cwd: prepared.cwd,
  });

  let exitCode: number | null = null;
  child.onExit((event) => {
    exitCode = event.exitCode;
  });

  return {
    child: {
      get exitCode() {
        return exitCode;
      },
      write(data: string) {
        child.write(data);
      },
      resize(cols: number, rows: number) {
        child.resize(cols, rows);
      },
      kill(signal?: string) {
        child.kill(signal);
      },
      onData(listener: (chunk: string) => void) {
        child.onData(listener);
      },
      onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
        child.onExit(listener);
      },
    },
    cwd: prepared.cwd,
  };
}
