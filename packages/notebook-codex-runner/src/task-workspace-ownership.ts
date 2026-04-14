import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface RunnerProcessSnapshot {
  pid: number;
  command: string;
  cwd?: string | null;
}

export interface MountedWorkspaceOwnerRecord {
  ownerProcessPid: number | null;
  runnerInstanceId: string | null;
}

export type MountedWorkspaceOwnerAuthority =
  | {
    kind: 'current_runner';
    reason: 'current_runner_pid' | 'current_runner_instance';
  }
  | {
    kind: 'live_foreign_runner';
    reason: 'foreign_runner_instance_alive';
  }
  | {
    kind: 'live_foreign_runner_legacy';
    reason: 'foreign_runner_alive_without_instance_marker';
  }
  | {
    kind: 'stale_owner';
    reason: 'owner_pid_dead' | 'owner_pid_reused' | 'owner_pid_now_current_runner';
  }
  | {
    kind: 'ownerless_reclaimable';
    reason: 'no_other_runner_alive';
  }
  | {
    kind: 'ownerless_other_runner_live';
    reason: 'other_runner_alive_without_owner_evidence';
  };

const NOTEBOOK_RUNNER_PROCESS_TITLE = 'agentsmith-notebook-codex-runner';
const NOTEBOOK_RUNNER_ENTRYPOINT_PATTERN = /(?:^|[/\\])(?:packages[/\\])?notebook-codex-runner[/\\](?:dist[/\\]index\.js|src[/\\]index\.ts)$/;
const NOTEBOOK_RUNNER_RELATIVE_ENTRYPOINT_PATTERN = /^(?:(?:\.\.?(?:[/\\]))+)?(?:dist[/\\]index\.js|src[/\\]index\.ts)$/;
const NODE_LAUNCHER_BASENAMES = new Set(['node', 'node.exe']);
const TSX_LAUNCHER_BASENAMES = new Set(['tsx', 'tsx.cmd']);
const NODE_OPTIONS_WITH_VALUE = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--env-file',
  '--max-old-space-size',
  '--title',
  '-C',
  '--conditions',
]);
const TSX_OPTIONS_WITH_VALUE = new Set([
  '--tsconfig',
]);

export function buildRunnerInstanceMarker(instanceId: string): string {
  return `runner_instance_id=${instanceId.trim()}`;
}

export function buildNotebookRunnerProcessTitle(instanceId: string): string {
  return `agentsmith-notebook-codex-runner ${buildRunnerInstanceMarker(instanceId)}`;
}

export function installNotebookRunnerProcessIdentity(instanceId: string): void {
  if (!instanceId.trim()) {
    return;
  }
  try {
    process.title = buildNotebookRunnerProcessTitle(instanceId);
  } catch {
    // Ignore process title write failures on unsupported platforms.
  }
}

function unquoteCommandToken(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith('\'') && token.endsWith('\''))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function tokenizeCommand(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((token) => unquoteCommandToken(token).trim())
    .filter(Boolean);
}

function normalizeCommandToken(token: string): string {
  return token.replace(/\\/g, '/');
}

function normalizeCommandCwd(cwd: string | null | undefined): string | null {
  if (!cwd?.trim()) {
    return null;
  }
  const normalized = normalizeCommandToken(cwd).trim();
  if (!normalized || normalized === '-') {
    return null;
  }
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function isAbsoluteCommandPath(token: string): boolean {
  return token.startsWith('/')
    || token.startsWith('//')
    || /^[a-zA-Z]:\//.test(token);
}

function commandBasename(token: string): string {
  const normalized = normalizeCommandToken(token);
  const slashIndex = normalized.lastIndexOf('/');
  return (slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized).toLowerCase();
}

function isNotebookRunnerProcessTitle(tokens: readonly string[]): boolean {
  return tokens[0] === NOTEBOOK_RUNNER_PROCESS_TITLE;
}

function resolveCommandTokenPath(token: string, cwd: string | null | undefined): string {
  const normalizedToken = normalizeCommandToken(token);
  if (!normalizedToken || isAbsoluteCommandPath(normalizedToken)) {
    return path.posix.normalize(normalizedToken);
  }
  const normalizedCwd = normalizeCommandCwd(cwd);
  if (!normalizedCwd) {
    return normalizedToken;
  }
  return path.posix.normalize(path.posix.join(normalizedCwd, normalizedToken));
}

function isNotebookRunnerEntrypointToken(token: string, cwd: string | null | undefined): boolean {
  return NOTEBOOK_RUNNER_ENTRYPOINT_PATTERN.test(resolveCommandTokenPath(token, cwd));
}

function isNodeLauncherToken(token: string): boolean {
  return NODE_LAUNCHER_BASENAMES.has(commandBasename(token));
}

function isTsxLauncherToken(token: string): boolean {
  const basename = commandBasename(token);
  if (TSX_LAUNCHER_BASENAMES.has(basename)) {
    return true;
  }
  const normalized = normalizeCommandToken(token);
  return /(?:^|\/)tsx(?:\/dist)?\/cli\.mjs$/.test(normalized);
}

function skipLauncherOptions(
  tokens: readonly string[],
  startIndex: number,
  optionsWithValue: ReadonlySet<string>,
): number {
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token.startsWith('-')) {
      return index;
    }
    const [optionName] = token.split('=', 1);
    if (token === '--') {
      return index + 1;
    }
    index += optionsWithValue.has(optionName) && !token.includes('=') ? 2 : 1;
  }
  return index;
}

function extractTsxLaunchedNotebookRunnerScriptToken(tokens: readonly string[], launcherIndex: number): string | null {
  const scriptIndex = skipLauncherOptions(tokens, launcherIndex + 1, TSX_OPTIONS_WITH_VALUE);
  return scriptIndex < tokens.length ? tokens[scriptIndex] : null;
}

function extractNodeLaunchedNotebookRunnerScriptToken(tokens: readonly string[], launcherIndex: number): string | null {
  const scriptIndex = skipLauncherOptions(tokens, launcherIndex + 1, NODE_OPTIONS_WITH_VALUE);
  if (scriptIndex >= tokens.length) {
    return null;
  }
  const scriptToken = tokens[scriptIndex];
  if (isTsxLauncherToken(scriptToken)) {
    return extractTsxLaunchedNotebookRunnerScriptToken(tokens, scriptIndex);
  }
  return scriptToken;
}

function extractNotebookRunnerScriptToken(tokens: readonly string[]): string | null {
  if (tokens.length === 0 || isNotebookRunnerProcessTitle(tokens)) {
    return null;
  }
  if (isNodeLauncherToken(tokens[0])) {
    return extractNodeLaunchedNotebookRunnerScriptToken(tokens, 0);
  }
  if (isTsxLauncherToken(tokens[0])) {
    return extractTsxLaunchedNotebookRunnerScriptToken(tokens, 0);
  }
  return tokens[0];
}

export function notebookRunnerProcessNeedsCwd(command: string): boolean {
  const tokens = tokenizeCommand(command);
  const scriptToken = extractNotebookRunnerScriptToken(tokens);
  if (!scriptToken) {
    return false;
  }
  const normalizedToken = normalizeCommandToken(scriptToken);
  return NOTEBOOK_RUNNER_RELATIVE_ENTRYPOINT_PATTERN.test(normalizedToken)
    && !NOTEBOOK_RUNNER_ENTRYPOINT_PATTERN.test(normalizedToken);
}

function loadProcessCwdSync(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    const stdout = execFileSync(
      'ps',
      ['-ww', '-o', 'cwd=', '-p', String(pid)],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    );
    const cwd = stdout
      .split('\n')
      .map((entry) => entry.trim())
      .find(Boolean);
    return normalizeCommandCwd(cwd ?? null);
  } catch {
    return null;
  }
}

function resolveProcessCwd(processInfo: Pick<RunnerProcessSnapshot, 'pid' | 'cwd'>): string | null {
  return normalizeCommandCwd(processInfo.cwd ?? null) ?? loadProcessCwdSync(processInfo.pid);
}

export function isNotebookRunnerProcessSnapshot(processInfo: Pick<RunnerProcessSnapshot, 'pid' | 'command' | 'cwd'>): boolean {
  const tokens = tokenizeCommand(processInfo.command);
  if (tokens.length === 0) {
    return false;
  }
  if (isNotebookRunnerProcessTitle(tokens)) {
    return true;
  }
  const scriptToken = extractNotebookRunnerScriptToken(tokens);
  if (!scriptToken) {
    return false;
  }
  const cwd = notebookRunnerProcessNeedsCwd(processInfo.command)
    ? resolveProcessCwd(processInfo)
    : normalizeCommandCwd(processInfo.cwd ?? null);
  return isNotebookRunnerEntrypointToken(scriptToken, cwd);
}

export function isNotebookRunnerProcessCommand(command: string): boolean {
  return isNotebookRunnerProcessSnapshot({
    pid: 0,
    command,
    cwd: null,
  });
}

export function classifyMountedWorkspaceOwnerAuthority(args: {
  ownerRecord: MountedWorkspaceOwnerRecord;
  currentRunnerPid: number;
  currentRunnerInstanceId: string;
  processTableByPid: ReadonlyMap<number, RunnerProcessSnapshot>;
}): MountedWorkspaceOwnerAuthority {
  const ownerProcessPid = args.ownerRecord.ownerProcessPid;
  const runnerInstanceId = args.ownerRecord.runnerInstanceId?.trim() || null;

  if (ownerProcessPid !== null) {
    if (ownerProcessPid === args.currentRunnerPid) {
      if (!runnerInstanceId || runnerInstanceId === args.currentRunnerInstanceId) {
        return {
          kind: 'current_runner',
          reason: runnerInstanceId === args.currentRunnerInstanceId ? 'current_runner_instance' : 'current_runner_pid',
        };
      }
      return {
        kind: 'stale_owner',
        reason: 'owner_pid_now_current_runner',
      };
    }

    const ownerProcess = args.processTableByPid.get(ownerProcessPid);
    if (!ownerProcess) {
      return {
        kind: 'stale_owner',
        reason: 'owner_pid_dead',
      };
    }
    if (!isNotebookRunnerProcessSnapshot(ownerProcess)) {
      return {
        kind: 'stale_owner',
        reason: 'owner_pid_reused',
      };
    }
    if (runnerInstanceId && ownerProcess.command.includes(buildRunnerInstanceMarker(runnerInstanceId))) {
      return {
        kind: 'live_foreign_runner',
        reason: 'foreign_runner_instance_alive',
      };
    }
    return {
      kind: 'live_foreign_runner_legacy',
      reason: 'foreign_runner_alive_without_instance_marker',
    };
  }

  const otherRunnerAlive = [...args.processTableByPid.values()].some((processInfo) => (
    processInfo.pid !== args.currentRunnerPid
    && isNotebookRunnerProcessSnapshot(processInfo)
  ));
  return otherRunnerAlive
    ? {
      kind: 'ownerless_other_runner_live',
      reason: 'other_runner_alive_without_owner_evidence',
    }
    : {
      kind: 'ownerless_reclaimable',
      reason: 'no_other_runner_alive',
    };
}
