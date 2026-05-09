import { readFile, readdir } from 'node:fs/promises';

export type TerminalPidMetadata = {
  readonly ptyPid: number | null;
  readonly rootPid: number | null;
  readonly pgid: number | null;
  readonly sid: number | null;
  readonly platform: NodeJS.Platform;
  readonly diagnostics: string[];
};

export type TerminalProcessTreeTarget = {
  readonly exitCode: number | null;
  readonly pidMetadata: TerminalPidMetadata;
  kill(signal?: NodeJS.Signals): void;
  onExit(listener: (event: { exitCode: number | null; signal?: string | number | null }) => void): void;
};

export type TerminalProcessTreeTerminationResult = {
  readonly outcome: 'terminated' | 'not_found' | 'failed';
  readonly rootPid: number | null;
  readonly ptyPid: number | null;
  readonly pgid: number | null;
  readonly sid: number | null;
  readonly terminatedPids: number[];
  readonly remainingPids: number[];
  readonly signalSequence: string[];
  readonly durationMs: number;
  readonly diagnosticCode: string | null;
  readonly diagnostics: string[];
};

export type TerminalProcessTreeTerminationOptions = {
  readonly terminalSessionId?: string;
  readonly runnerSessionId?: string;
  readonly generation?: number;
  readonly reason?: string;
  readonly graceMs?: number;
  readonly hardKillGraceMs?: number;
  readonly pollIntervalMs?: number;
};

type LinuxProcessStat = {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  readonly sid: number;
};

const DEFAULT_GRACE_MS = 8_000;
const DEFAULT_HARD_KILL_GRACE_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

function positiveInteger(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0
    ? Math.floor(input)
    : null;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code) === code;
}

function isProcessMissingError(error: unknown): boolean {
  return isErrnoCode(error, 'ESRCH') || isErrnoCode(error, 'ENOENT');
}

function parseLinuxProcStat(content: string): LinuxProcessStat | null {
  const closeParenIndex = content.lastIndexOf(')');
  if (closeParenIndex < 0 || closeParenIndex + 2 >= content.length) return null;
  const pidText = content.slice(0, content.indexOf(' ')).trim();
  const fields = content.slice(closeParenIndex + 2).trim().split(/\s+/);
  if (fields.length < 4) return null;
  const pid = positiveInteger(Number.parseInt(pidText, 10));
  const ppid = positiveInteger(Number.parseInt(fields[1] ?? '', 10));
  const pgrp = positiveInteger(Number.parseInt(fields[2] ?? '', 10));
  const sid = positiveInteger(Number.parseInt(fields[3] ?? '', 10));
  if (pid === null || ppid === null || pgrp === null || sid === null) return null;
  return { pid, ppid, pgrp, sid };
}

async function readLinuxProcessStat(pid: number): Promise<LinuxProcessStat | null> {
  try {
    const content = await readFile(`/proc/${pid}/stat`, 'utf8');
    return parseLinuxProcStat(content);
  } catch {
    return null;
  }
}

async function readLinuxProcessTable(diagnostics: string[]): Promise<Map<number, LinuxProcessStat>> {
  let entries: string[];
  try {
    entries = await readdir('/proc');
  } catch (error) {
    diagnostics.push(`proc_readdir_failed:${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }

  const table = new Map<number, LinuxProcessStat>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = positiveInteger(Number.parseInt(entry, 10));
    if (pid === null) continue;
    const stat = await readLinuxProcessStat(pid);
    if (stat) {
      table.set(pid, stat);
    }
  }
  return table;
}

function collectDescendantPids(rootPid: number, table: Map<number, LinuxProcessStat>): number[] {
  if (!table.has(rootPid)) return [];
  const childrenByParent = new Map<number, number[]>();
  for (const stat of table.values()) {
    const existing = childrenByParent.get(stat.ppid) ?? [];
    existing.push(stat.pid);
    childrenByParent.set(stat.ppid, existing);
  }

  const ordered: number[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    ordered.push(pid);
    for (const childPid of childrenByParent.get(pid) ?? []) {
      queue.push(childPid);
    }
  }
  return ordered;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isProcessMissingError(error)) return false;
    return true;
  }
}

async function listRemainingTerminalPids(
  rootPid: number,
  diagnostics: string[],
): Promise<number[]> {
  const table = await readLinuxProcessTable(diagnostics);
  if (table.size > 0) {
    return collectDescendantPids(rootPid, table).filter((pid) => pid !== process.pid);
  }
  return processExists(rootPid) && rootPid !== process.pid ? [rootPid] : [];
}

function waitForTerminalExit(target: TerminalProcessTreeTarget): Promise<void> {
  if (target.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false;
    target.onExit(() => {
      if (resolved) return;
      resolved = true;
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

async function waitForTerminalTreeGone(input: {
  target: TerminalProcessTreeTarget;
  rootPid: number | null;
  timeoutMs: number;
  pollIntervalMs: number;
  diagnostics: string[];
}): Promise<boolean> {
  if (input.target.exitCode !== null && input.rootPid === null) return true;
  const startedAt = Date.now();
  const exitPromise = waitForTerminalExit(input.target).then(() => true);
  while (Date.now() - startedAt <= input.timeoutMs) {
    if (input.target.exitCode !== null) {
      if (input.rootPid === null) return true;
      const remainingAfterExit = await listRemainingTerminalPids(input.rootPid, input.diagnostics);
      if (remainingAfterExit.length === 0) return true;
    }
    if (input.rootPid !== null) {
      const remaining = await listRemainingTerminalPids(input.rootPid, input.diagnostics);
      if (remaining.length === 0) return true;
    }
    const elapsed = Date.now() - startedAt;
    const remainingTimeout = input.timeoutMs - elapsed;
    if (remainingTimeout <= 0) break;
    const sleptForExit = await Promise.race([
      exitPromise,
      delay(Math.min(input.pollIntervalMs, remainingTimeout)).then(() => false),
    ]);
    if (sleptForExit && input.rootPid === null) return true;
  }
  return false;
}

function sendSignalToPid(
  pid: number,
  signal: NodeJS.Signals,
  signalSequence: string[],
  diagnostics: string[],
  signaledPids: Set<number>,
): void {
  if (pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, signal);
    signalSequence.push(`pid:${pid}:${signal}`);
    signaledPids.add(pid);
  } catch (error) {
    if (!isProcessMissingError(error)) {
      diagnostics.push(`pid_signal_failed:${pid}:${signal}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function sendSignalToProcessGroup(
  pgid: number,
  signal: NodeJS.Signals,
  signalSequence: string[],
  diagnostics: string[],
): void {
  if (pgid <= 1 || pgid === process.pid) return;
  try {
    process.kill(-pgid, signal);
    signalSequence.push(`pgid:${pgid}:${signal}`);
  } catch (error) {
    if (!isProcessMissingError(error)) {
      diagnostics.push(`pgid_signal_failed:${pgid}:${signal}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function signalTerminalTree(input: {
  target: TerminalProcessTreeTarget;
  rootPid: number | null;
  canSignalProcessGroup: boolean;
  pgid: number | null;
  signal: NodeJS.Signals;
  signalSequence: string[];
  diagnostics: string[];
  signaledPids: Set<number>;
}): Promise<void> {
  input.target.kill(input.signal);
  input.signalSequence.push(`pty:${input.signal}`);

  if (input.canSignalProcessGroup && input.pgid !== null) {
    sendSignalToProcessGroup(input.pgid, input.signal, input.signalSequence, input.diagnostics);
  }
  if (input.rootPid === null) return;

  const pids = await listRemainingTerminalPids(input.rootPid, input.diagnostics);
  for (const pid of [...pids].reverse()) {
    sendSignalToPid(pid, input.signal, input.signalSequence, input.diagnostics, input.signaledPids);
  }
}

function buildResult(input: {
  outcome: TerminalProcessTreeTerminationResult['outcome'];
  metadata: TerminalPidMetadata;
  remainingPids: number[];
  signalSequence: string[];
  signaledPids: Set<number>;
  startedAt: number;
  diagnosticCode: string | null;
  diagnostics: string[];
}): TerminalProcessTreeTerminationResult {
  const remainingSet = new Set(input.remainingPids);
  return {
    outcome: input.outcome,
    rootPid: input.metadata.rootPid,
    ptyPid: input.metadata.ptyPid,
    pgid: input.metadata.pgid,
    sid: input.metadata.sid,
    terminatedPids: Array.from(input.signaledPids)
      .filter((pid) => !remainingSet.has(pid))
      .sort((a, b) => a - b),
    remainingPids: [...input.remainingPids].sort((a, b) => a - b),
    signalSequence: input.signalSequence.slice(),
    durationMs: Date.now() - input.startedAt,
    diagnosticCode: input.diagnosticCode,
    diagnostics: input.diagnostics.slice(),
  };
}

export async function inspectTerminalPidMetadata(rawPid: unknown): Promise<TerminalPidMetadata> {
  const ptyPid = positiveInteger(rawPid);
  const diagnostics: string[] = [];
  if (ptyPid === null) {
    diagnostics.push('terminal_pty_pid_unavailable');
  }
  const metadata: TerminalPidMetadata = {
    ptyPid,
    rootPid: ptyPid,
    pgid: null,
    sid: null,
    platform: process.platform,
    diagnostics,
  };
  if (ptyPid === null) return metadata;
  if (process.platform !== 'linux') {
    return {
      ...metadata,
      diagnostics: [...diagnostics, `terminal_process_tree_unsupported_platform:${process.platform}`],
    };
  }
  const stat = await readLinuxProcessStat(ptyPid);
  if (!stat) {
    return {
      ...metadata,
      diagnostics: [...diagnostics, 'terminal_proc_stat_unavailable'],
    };
  }
  return {
    ...metadata,
    pgid: stat.pgrp,
    sid: stat.sid,
  };
}

export async function terminateTerminalProcessTree(
  target: TerminalProcessTreeTarget,
  options: TerminalProcessTreeTerminationOptions = {},
): Promise<TerminalProcessTreeTerminationResult> {
  const startedAt = Date.now();
  const metadata = target.pidMetadata;
  const diagnostics = metadata.diagnostics.slice();
  const signalSequence: string[] = [];
  const signaledPids = new Set<number>();
  const rootPid = metadata.rootPid ?? metadata.ptyPid;
  const graceMs = Math.max(0, Math.floor(options.graceMs ?? DEFAULT_GRACE_MS));
  const hardKillGraceMs = Math.max(0, Math.floor(options.hardKillGraceMs ?? DEFAULT_HARD_KILL_GRACE_MS));
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));

  if (target.exitCode !== null) {
    return buildResult({
      outcome: 'terminated',
      metadata,
      remainingPids: [],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: null,
      diagnostics,
    });
  }

  if (process.platform !== 'linux') {
    return buildResult({
      outcome: 'failed',
      metadata,
      remainingPids: rootPid !== null ? [rootPid] : [],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: 'unsupported_platform',
      diagnostics: [...diagnostics, `terminal_process_tree_unsupported_platform:${process.platform}`],
    });
  }

  if (rootPid === null) {
    diagnostics.push('terminal_root_pid_unavailable');
    await signalTerminalTree({
      target,
      rootPid: null,
      canSignalProcessGroup: false,
      pgid: null,
      signal: 'SIGTERM',
      signalSequence,
      diagnostics,
      signaledPids,
    });
    if (!(await waitForTerminalTreeGone({ target, rootPid: null, timeoutMs: graceMs, pollIntervalMs, diagnostics }))) {
      await signalTerminalTree({
        target,
        rootPid: null,
        canSignalProcessGroup: false,
        pgid: null,
        signal: 'SIGKILL',
        signalSequence,
        diagnostics,
        signaledPids,
      });
      await waitForTerminalTreeGone({ target, rootPid: null, timeoutMs: hardKillGraceMs, pollIntervalMs, diagnostics });
    }
    const outcome = target.exitCode === null ? 'failed' : 'terminated';
    return buildResult({
      outcome,
      metadata,
      remainingPids: [],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: outcome === 'terminated' ? 'terminal_root_pid_unavailable' : 'terminal_process_exit_unconfirmed',
      diagnostics,
    });
  }

  const rootStat = await readLinuxProcessStat(rootPid);
  if (!rootStat) {
    return buildResult({
      outcome: 'not_found',
      metadata,
      remainingPids: [],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: 'terminal_root_pid_not_found',
      diagnostics: [...diagnostics, 'terminal_root_pid_not_found'],
    });
  }

  if (rootPid === process.pid) {
    return buildResult({
      outcome: 'failed',
      metadata,
      remainingPids: [rootPid],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: 'terminal_process_boundary_self',
      diagnostics: [...diagnostics, 'terminal_process_boundary_self'],
    });
  }

  if (metadata.pgid !== null && rootStat.pgrp !== metadata.pgid) {
    return buildResult({
      outcome: 'failed',
      metadata,
      remainingPids: [rootPid],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: 'terminal_process_boundary_mismatch',
      diagnostics: [...diagnostics, `terminal_pgid_mismatch:${metadata.pgid}:${rootStat.pgrp}`],
    });
  }

  if (metadata.sid !== null && rootStat.sid !== metadata.sid) {
    return buildResult({
      outcome: 'failed',
      metadata,
      remainingPids: [rootPid],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: 'terminal_process_boundary_mismatch',
      diagnostics: [...diagnostics, `terminal_sid_mismatch:${metadata.sid}:${rootStat.sid}`],
    });
  }

  if (metadata.pgid === null) diagnostics.push('terminal_pgid_unavailable');
  if (metadata.sid === null) diagnostics.push('terminal_sid_unavailable');

  const ownStat = await readLinuxProcessStat(process.pid);
  const canSignalProcessGroup = metadata.pgid !== null
    && metadata.pgid > 1
    && ownStat !== null
    && ownStat.pgrp !== metadata.pgid
    && ownStat.sid !== metadata.sid;
  if (metadata.pgid !== null && !canSignalProcessGroup) {
    diagnostics.push('terminal_process_group_signal_unsafe');
  }

  await signalTerminalTree({
    target,
    rootPid,
    canSignalProcessGroup,
    pgid: metadata.pgid,
    signal: 'SIGTERM',
    signalSequence,
    diagnostics,
    signaledPids,
  });
  if (await waitForTerminalTreeGone({ target, rootPid, timeoutMs: graceMs, pollIntervalMs, diagnostics })) {
    return buildResult({
      outcome: 'terminated',
      metadata,
      remainingPids: [],
      signalSequence,
      signaledPids,
      startedAt,
      diagnosticCode: null,
      diagnostics,
    });
  }

  await signalTerminalTree({
    target,
    rootPid,
    canSignalProcessGroup,
    pgid: metadata.pgid,
    signal: 'SIGKILL',
    signalSequence,
    diagnostics,
    signaledPids,
  });
  await waitForTerminalTreeGone({ target, rootPid, timeoutMs: hardKillGraceMs, pollIntervalMs, diagnostics });
  const remainingPids = await listRemainingTerminalPids(rootPid, diagnostics);
  const outcome = remainingPids.length === 0 ? 'terminated' : 'failed';
  return buildResult({
    outcome,
    metadata,
    remainingPids,
    signalSequence,
    signaledPids,
    startedAt,
    diagnosticCode: outcome === 'terminated' ? null : 'terminal_process_tree_remaining',
    diagnostics,
  });
}
