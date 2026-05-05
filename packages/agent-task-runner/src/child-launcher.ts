import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { resolveAgentTaskRunnerMode, type AgentTaskRunnerMode } from './task-workspace.js';

type LaunchCommand = {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

let checkedBwrapPath: string | null | undefined;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBwrapPath(): Promise<string | null> {
  if (checkedBwrapPath !== undefined) return checkedBwrapPath;
  for (const candidate of ['/usr/bin/bwrap', '/bin/bwrap']) {
    if (await pathExists(candidate)) {
      checkedBwrapPath = candidate;
      return checkedBwrapPath;
    }
  }
  checkedBwrapPath = null;
  return checkedBwrapPath;
}

function shouldUseBwrap(mode: AgentTaskRunnerMode): boolean {
  return mode === 'developer' || mode === 'managed_local';
}

function isStrictBwrapRequired(mode: AgentTaskRunnerMode): boolean {
  if (mode === 'managed_local') return true;
  const raw = (process.env.MBOS_AGENT_TASK_RUNNER_REQUIRE_BWRAP ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function buildBwrapCommand(input: {
  bwrapPath: string;
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): LaunchCommand {
  const forwardedEnv = new Map<string, string>();
  for (const [key, value] of Object.entries(input.env)) {
    if (typeof value !== 'string') continue;
    forwardedEnv.set(key, value);
  }
  if (!forwardedEnv.has('TERM')) {
    forwardedEnv.set('TERM', 'xterm-256color');
  }

  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--share-net',
    '--clearenv',
    '--ro-bind', '/', '/',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', input.cwd, input.cwd,
  ];
  const homeDir = forwardedEnv.get('HOME')?.trim();
  if (homeDir && isAbsolute(homeDir) && homeDir !== input.cwd) {
    args.push('--bind', homeDir, homeDir);
  }
  args.push('--chdir', input.cwd);
  for (const [key, value] of forwardedEnv.entries()) {
    args.push('--setenv', key, value);
  }
  args.push('--', input.file, ...input.args);

  return {
    file: input.bwrapPath,
    args,
    env: {
      ...process.env,
      ...input.env,
    },
  };
}

export function resetChildLauncherForTests(): void {
  checkedBwrapPath = undefined;
}

export async function prepareLaunchCommand(input: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<LaunchCommand> {
  const mode = resolveAgentTaskRunnerMode();
  if (!shouldUseBwrap(mode)) {
    return {
      file: input.file,
      args: input.args,
      env: input.env,
    };
  }
  const bwrapPath = await resolveBwrapPath();
  if (!bwrapPath) {
    if (isStrictBwrapRequired(mode)) {
      throw new Error('bwrap_missing_for_agent_task_runner');
    }
    if (mode === 'developer') {
      process.stderr.write('[agent-task-runner][child-launcher] bwrap not found; falling back to direct launch for developer\n');
      return {
        file: input.file,
        args: input.args,
        env: input.env,
      };
    }
    throw new Error('bwrap_missing_for_agent_task_runner');
  }
  return buildBwrapCommand({
    ...input,
    bwrapPath,
  });
}
