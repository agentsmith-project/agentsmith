import { constants as fsConstants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { spawn as spawnPty } from 'node-pty';
import {
  buildTaskHeadlessPreamble,
  prepareTaskWorkspaceAssets,
} from './task-assets.js';
import {
  prepareTaskWorkspace,
  shouldRetryTaskWorkspaceWriteFailure,
  type TaskWorkspacePaths,
} from './task-workspace.js';
import { buildAgentRuntimeEnv } from './agent-runtime-env.js';
import { prepareLaunchCommand } from './child-launcher.js';
import { inspectBuiltinSkills, resolveBuiltinSkillsConfig, seedBuiltinSkills } from './builtin-skills.js';
import { buildTaskUserInstallEnv } from './user-install-env.js';
import { assertTaskExecutionContext, type TaskExecutionContext } from '@mbos/agent-runner';
import {
  inspectTerminalPidMetadata,
  type TerminalPidMetadata,
} from './terminal-process-tree.js';

export {
  terminateTerminalProcessTree,
  type TerminalPidMetadata,
  type TerminalProcessTreeTerminationOptions,
  type TerminalProcessTreeTerminationResult,
} from './terminal-process-tree.js';

export type TerminalExecutionContext = TaskExecutionContext;

export type TerminalProcess = {
  readonly exitCode: number | null;
  readonly pidMetadata: TerminalPidMetadata;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number | null; signal?: string | number | null }) => void): void;
  waitForWorkspaceRelease(): Promise<void>;
};

function debugTerminalRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.MBOS_AGENT_RUNNER_DEBUG !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-task-runner][terminal-runtime] ${message}${payload}\n`);
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

function isAbsoluteLikeExecutable(pathLike: string): boolean {
  return pathLike.includes('/') || pathLike.includes('\\') || /^[a-zA-Z]:/.test(pathLike);
}

async function resolveTerminalShellExecutable(shellOverride?: string): Promise<string> {
  const requestedShell = resolveTerminalShell(shellOverride).trim();
  if (!requestedShell) {
    throw new Error('invalid_shell');
  }
  if (isAbsoluteLikeExecutable(requestedShell)) {
    try {
      await access(requestedShell, fsConstants.X_OK);
      return requestedShell;
    } catch {
      throw new Error('invalid_shell');
    }
  }
  const pathEntries = (process.env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of pathEntries) {
    const resolvedCandidate = join(entry, requestedShell);
    try {
      await access(resolvedCandidate, fsConstants.X_OK);
      return resolvedCandidate;
    } catch {
      // keep searching PATH
    }
  }
  throw new Error('invalid_shell');
}

function buildInteractiveCommand(shellFile: string): {
  file: string;
  args: string[];
} {
  if (/pwsh(?:\.exe)?$/i.test(shellFile) || /powershell(?:\.exe)?$/i.test(shellFile)) {
    return {
      file: shellFile,
      args: ['-NoLogo'],
    };
  }
  return {
    file: shellFile,
    args: ['-i'],
  };
}

async function primeShellDotfiles(homeDir: string, shellFile: string): Promise<void> {
  if (!/zsh(?:\.exe)?$/i.test(shellFile)) return;
  await writeFile(join(homeDir, '.zshrc'), '# AgentSmith Terminal Session\n', {
    flag: 'a',
  });
}

async function ensureTerminalWorkspaceDirectories(cwd: string, taskPaths: TaskWorkspacePaths): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await mkdir(taskPaths.codexDir, { recursive: true });
  await mkdir(taskPaths.mbosDir, { recursive: true });
  await mkdir(join(taskPaths.homeDir, '.agents'), { recursive: true });
  await mkdir(taskPaths.skillsDir, { recursive: true });
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
  release: () => Promise<void>;
}> {
  let executionContext: TaskExecutionContext;
  try {
    executionContext = assertTaskExecutionContext(input.executionContext);
  } catch {
    throw new Error('task_terminal_execution_context_invalid');
  }
  const shellFile = await resolveTerminalShellExecutable(input.shell);
  debugTerminalRuntime('prepare_workspace_start', {
    task_id: executionContext.task_id ?? null,
    workspace_binding_mode: executionContext.workspace_binding_mode ?? null,
    workspace_path: executionContext.workspace_path ?? null,
    has_execution_ticket: typeof executionContext.execution_ticket === 'string' && executionContext.execution_ticket.length > 0,
  });
  const username = sanitizePathPart(executionContext.username, 'unknown_user');
  const taskId = sanitizePathPart(executionContext.task_id, 'terminal-task');
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const cwdResult = await prepareTaskWorkspace({
      executionContext,
      username,
      taskId,
    });
    debugTerminalRuntime('prepare_workspace_task_ready', {
      cwd: cwdResult.cwd,
      source: cwdResult.source,
      attempt,
    });
    const cwd = cwdResult.cwd;
    const taskPaths = cwdResult.paths;
    try {
      await ensureTerminalWorkspaceDirectories(cwd, taskPaths);
      await primeShellDotfiles(taskPaths.homeDir, shellFile);
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

      const taskInputs = Array.isArray(executionContext.task_inputs) ? executionContext.task_inputs : [];
      await prepareTaskWorkspaceAssets({
        cwd,
        paths: taskPaths,
        executionContext,
        taskInputs,
      });
      debugTerminalRuntime('prepare_workspace_assets_ready', {
        cwd,
        artifacts_dir: taskPaths.artifactsDir,
      });
      const env = buildTaskUserInstallEnv(taskPaths.homeDir, {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        NO_COLOR: '1',
        TASK_HOME: taskPaths.taskHome,
        WORKSPACE_PATH: taskPaths.workspaceDir,
        ARTIFACTS_PATH: taskPaths.artifactsDir,
        ...buildAgentRuntimeEnv(executionContext),
        MBOS_AGENT_TASK_PREAMBLE: buildTaskHeadlessPreamble({
          artifactsDir: taskPaths.artifactsDir,
        }),
      });
      const interactiveCommand = buildInteractiveCommand(shellFile);
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
        release: cwdResult.release,
      };
    } catch (error) {
      lastError = error;
      debugTerminalRuntime('prepare_workspace_attempt_failed', {
        cwd,
        source: cwdResult.source,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        await cwdResult.release();
      } catch (releaseError) {
        debugTerminalRuntime('prepare_workspace_release_failed', {
          cwd,
          source: cwdResult.source,
          attempt,
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
      if (attempt >= maxAttempts || !shouldRetryTaskWorkspaceWriteFailure(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('terminal_workspace_prepare_failed');
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
  let child: ReturnType<typeof spawnPty>;
  try {
    child = spawnPty(prepared.shellFile, prepared.shellArgs, {
      cwd: prepared.cwd,
      env: prepared.env,
      cols: input.cols ?? 120,
      rows: input.rows ?? 30,
      name: prepared.env.TERM || 'xterm-256color',
    });
  } catch (error) {
    await prepared.release();
    throw error;
  }

  let exitCode: number | null = null;
  let releasePromise: Promise<void> | null = null;
  const releasePreparedWorkspace = () => {
    if (releasePromise) {
      return releasePromise;
    }
    releasePromise = prepared.release().catch((error) => {
      debugTerminalRuntime('release_workspace_failed', {
        cwd: prepared.cwd,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return releasePromise;
  };
  child.onExit((event) => {
    exitCode = event.exitCode;
    void releasePreparedWorkspace();
  });
  const ptyPid = (child as { pid?: unknown }).pid;
  const pidMetadata = await inspectTerminalPidMetadata(ptyPid);
  debugTerminalRuntime('spawn_pty_ready', {
    cwd: prepared.cwd,
    pty_pid: pidMetadata.ptyPid,
    pgid: pidMetadata.pgid,
    sid: pidMetadata.sid,
    diagnostics: pidMetadata.diagnostics,
  });

  return {
    child: {
      get exitCode() {
        return exitCode;
      },
      get pidMetadata() {
        return pidMetadata;
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
      waitForWorkspaceRelease() {
        return releasePreparedWorkspace();
      },
    },
    cwd: prepared.cwd,
  };
}
