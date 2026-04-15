import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNotebookRunnerProcessSnapshot } from '../../packages/notebook-codex-runner/src/task-workspace-ownership.js';

type JanitorAuthority =
  | 'current_active'
  | 'unverified'
  | 'stale_reclaimable'
  | 'ownerless_adoptable';

type LocalManualLifecycleIntent = 'replace_runner' | 'rollback_launch' | 'stop_line';

type JanitorAction =
  | 'stop_runner_tree'
  | 'block'
  | 'mark_degraded'
  | 'remove_state_only'
  | 'reclaim_mount';

type RunnerJanitorReason =
  | 'tracked_runner_supervisor'
  | 'tracked_pid_reused'
  | 'tracked_pid_missing'
  | 'planner_malformed'
  | 'planner_unavailable';
type RunnerPlannerFallbackReason = Extract<RunnerJanitorReason, 'planner_malformed' | 'planner_unavailable'>;
type RunnerUnverifiedReason = Extract<RunnerJanitorReason, 'tracked_pid_reused' | RunnerPlannerFallbackReason>;
type RunnerNormalizedAction = Extract<JanitorAction, 'stop_runner_tree' | 'block' | 'mark_degraded' | 'remove_state_only'>;

interface RunnerStopContract {
  scope: 'owned_runner_tree';
  root_pid: number;
  owned_pids: number[];
  verification: 'all_owned_pids_exited';
}

interface ManagedProcessInfoLike {
  pid: number;
  ppid: number;
  cwd: string | null;
  command: string;
}

interface BuildLocalManualOwnerJanitorPlanArgs {
  intent: LocalManualLifecycleIntent;
  rootDir: string;
  trackedRunnerPid: number | null;
  trackedApiPid: number | null;
  trackedWebPid: number | null;
  portApi: number;
  portWeb: number;
  allowUntrackedPortCleanup: boolean;
  processes: ManagedProcessInfoLike[];
  portListenersByPort: Map<number, number[]>;
  gatewayStates: unknown[];
  taskMountOwners: Map<string, string | null>;
  mountedTaskPaths?: string[];
}

type RunnerStopRunnerTreePlanItem = {
  kind: 'runner';
  authority: 'current_active';
  action: 'stop_runner_tree';
  stop: RunnerStopContract;
  reason: 'tracked_runner_supervisor';
  lifecycle?: never;
};

type RunnerBlockPlanItem = {
  kind: 'runner';
  authority: 'unverified';
  action: 'block';
  reason: RunnerUnverifiedReason;
  stop?: never;
  lifecycle?: never;
};

type RunnerMarkDegradedPlanItem = {
  kind: 'runner';
  authority: 'unverified';
  action: 'mark_degraded';
  reason: RunnerUnverifiedReason;
  stop?: never;
  lifecycle: 'stop_line';
};

type RunnerRemoveStateOnlyPlanItem = {
  kind: 'runner';
  authority: 'stale_reclaimable';
  action: 'remove_state_only';
  reason: 'tracked_pid_missing';
  stop?: never;
  lifecycle?: never;
};

type RunnerOwnerJanitorPlanItem =
  | RunnerStopRunnerTreePlanItem
  | RunnerBlockPlanItem
  | RunnerMarkDegradedPlanItem
  | RunnerRemoveStateOnlyPlanItem;

type OwnerJanitorPlanItem =
  | RunnerOwnerJanitorPlanItem
  | {
      kind: 'api';
      authority: JanitorAuthority;
      action: Extract<JanitorAction, 'remove_state_only'>;
      reason: 'tracked_pid_missing';
    }
  | {
      kind: 'web';
      authority: JanitorAuthority;
      action: Extract<JanitorAction, 'block'>;
      port: number;
      reason: 'untracked_port_listener';
    }
  | {
      kind: 'mount';
      authority: JanitorAuthority;
      action: Extract<JanitorAction, 'reclaim_mount'>;
      mountPath: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRunnerStopContract(value: unknown): value is RunnerStopContract {
  if (!isRecord(value)) {
    return false;
  }

  if (value.scope !== 'owned_runner_tree' || value.verification !== 'all_owned_pids_exited') {
    return false;
  }

  if (!isPositiveInteger(value.root_pid) || !Array.isArray(value.owned_pids) || value.owned_pids.length === 0) {
    return false;
  }

  if (!value.owned_pids.every((pid) => isPositiveInteger(pid))) {
    return false;
  }

  const ownedPids = value.owned_pids as number[];
  if (new Set(ownedPids).size !== ownedPids.length) {
    return false;
  }

  return value.scope === 'owned_runner_tree'
    && ownedPids.includes(value.root_pid)
    && value.verification === 'all_owned_pids_exited';
}

const RUNNER_NORMALIZED_PLAN_MATRIX = {
  stop_runner_tree: {
    authority: 'current_active',
    intents: new Set<LocalManualLifecycleIntent>(['replace_runner', 'rollback_launch', 'stop_line']),
    reasons: new Set<RunnerJanitorReason>(['tracked_runner_supervisor']),
    lifecycle: undefined,
    requiresStopContract: true,
  },
  block: {
    authority: 'unverified',
    intents: new Set<LocalManualLifecycleIntent>(['replace_runner', 'rollback_launch']),
    reasons: new Set<RunnerJanitorReason>(['tracked_pid_reused', 'planner_malformed', 'planner_unavailable']),
    lifecycle: undefined,
    requiresStopContract: false,
  },
  mark_degraded: {
    authority: 'unverified',
    intents: new Set<LocalManualLifecycleIntent>(['stop_line']),
    reasons: new Set<RunnerJanitorReason>(['tracked_pid_reused', 'planner_malformed', 'planner_unavailable']),
    lifecycle: 'stop_line' as const,
    requiresStopContract: false,
  },
  remove_state_only: {
    authority: 'stale_reclaimable',
    intents: new Set<LocalManualLifecycleIntent>(['replace_runner', 'rollback_launch', 'stop_line']),
    reasons: new Set<RunnerJanitorReason>(['tracked_pid_missing']),
    lifecycle: undefined,
    requiresStopContract: false,
  },
} satisfies Record<
  RunnerNormalizedAction,
  {
    authority: RunnerOwnerJanitorPlanItem['authority'];
    intents: Set<LocalManualLifecycleIntent>;
    reasons: Set<RunnerJanitorReason>;
    lifecycle: 'stop_line' | undefined;
    requiresStopContract: boolean;
  }
>;

function isRunnerNormalizedAction(value: unknown): value is RunnerNormalizedAction {
  return typeof value === 'string' && value in RUNNER_NORMALIZED_PLAN_MATRIX;
}

function fallbackRunnerPlan(
  intent: LocalManualLifecycleIntent,
  reason: 'planner_malformed' | 'planner_unavailable',
): RunnerOwnerJanitorPlanItem {
  if (intent === 'stop_line') {
    return {
      kind: 'runner',
      authority: 'unverified',
      action: 'mark_degraded',
      reason,
      lifecycle: 'stop_line',
    };
  }

  return {
    kind: 'runner',
    authority: 'unverified',
    action: 'block',
    reason,
  };
}

function isNormalizedRunnerOwnerJanitorPlanItem(
  value: unknown,
  intent: LocalManualLifecycleIntent,
): value is RunnerOwnerJanitorPlanItem {
  if (!isRecord(value) || value.kind !== 'runner') {
    return false;
  }

  if (!isRunnerNormalizedAction(value.action)) {
    return false;
  }

  const actionContract = RUNNER_NORMALIZED_PLAN_MATRIX[value.action];
  if (!actionContract.intents.has(intent)) {
    return false;
  }

  if (value.authority !== actionContract.authority || !actionContract.reasons.has(value.reason as RunnerJanitorReason)) {
    return false;
  }

  if (actionContract.requiresStopContract) {
    return isRunnerStopContract(value.stop) && value.lifecycle === undefined;
  }

  return value.stop === undefined && value.lifecycle === actionContract.lifecycle;
}

export function normalizeLocalManualOwnerJanitorRunnerPlan(
  intent: LocalManualLifecycleIntent,
  rawPlan: string,
): RunnerOwnerJanitorPlanItem {
  const trimmed = rawPlan.trim();
  if (trimmed.length === 0) {
    return fallbackRunnerPlan(intent, 'planner_unavailable');
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isNormalizedRunnerOwnerJanitorPlanItem(parsed, intent)) {
      return parsed;
    }
  } catch {
    return fallbackRunnerPlan(intent, 'planner_malformed');
  }

  return fallbackRunnerPlan(intent, 'planner_malformed');
}

export function buildLocalManualOwnerJanitorPlan(
  args: BuildLocalManualOwnerJanitorPlanArgs,
): { items: OwnerJanitorPlanItem[] } {
  const items: OwnerJanitorPlanItem[] = [];
  const processByPid = new Map<number, ManagedProcessInfoLike>();
  const childrenByPid = new Map<number, ManagedProcessInfoLike[]>();

  for (const process of args.processes) {
    processByPid.set(process.pid, process);
    const existingChildren = childrenByPid.get(process.ppid) ?? [];
    existingChildren.push(process);
    childrenByPid.set(process.ppid, existingChildren);
  }

  const trackedProcessOwnsCanonicalRunner = (trackedRunnerPid: number): boolean => {
    const processQueue = [...(childrenByPid.get(trackedRunnerPid) ?? [])];
    while (processQueue.length > 0) {
      const currentProcess = processQueue.shift();
      if (!currentProcess) {
        continue;
      }
      if (isNotebookRunnerProcessSnapshot(currentProcess)) {
        return true;
      }
      processQueue.push(...(childrenByPid.get(currentProcess.pid) ?? []));
    }
    return false;
  };

  const trackedProcessIsCurrentRunner = (trackedRunnerPid: number): boolean => {
    const trackedProcess = processByPid.get(trackedRunnerPid);
    return trackedProcess ? isNotebookRunnerProcessSnapshot(trackedProcess) : false;
  };

  const isTrackedRunnerSupervisorCommand = (command: string | undefined): boolean => {
    return typeof command === 'string' && command.includes('make notebook-agent-runner');
  };

  const collectOwnedProcessTreePids = (rootPid: number): number[] => {
    const ownedPids = new Set<number>();
    const pendingPids = [rootPid];

    while (pendingPids.length > 0) {
      const currentPid = pendingPids.shift();
      if (currentPid === undefined || ownedPids.has(currentPid)) {
        continue;
      }
      ownedPids.add(currentPid);
      for (const childProcess of childrenByPid.get(currentPid) ?? []) {
        pendingPids.push(childProcess.pid);
      }
    }

    return [...ownedPids].sort((left, right) => left - right);
  };

  const buildRunnerStopContract = (trackedRunnerPid: number): RunnerStopContract => ({
    scope: 'owned_runner_tree',
    root_pid: trackedRunnerPid,
    owned_pids: collectOwnedProcessTreePids(trackedRunnerPid),
    verification: 'all_owned_pids_exited',
  });

  if (args.trackedRunnerPid !== null) {
    const runnerProcess = processByPid.get(args.trackedRunnerPid);

    if (runnerProcess === undefined) {
      items.push({
        kind: 'runner',
        authority: 'stale_reclaimable',
        action: 'remove_state_only',
        reason: 'tracked_pid_missing',
      });
    } else if (
      isTrackedRunnerSupervisorCommand(runnerProcess.command)
      && trackedProcessOwnsCanonicalRunner(args.trackedRunnerPid)
    ) {
      items.push({
        kind: 'runner',
        authority: 'current_active',
        action: 'stop_runner_tree',
        stop: buildRunnerStopContract(args.trackedRunnerPid),
        reason: 'tracked_runner_supervisor',
      });
    } else if (trackedProcessIsCurrentRunner(args.trackedRunnerPid)) {
      items.push({
        kind: 'runner',
        authority: 'current_active',
        action: 'stop_runner_tree',
        stop: buildRunnerStopContract(args.trackedRunnerPid),
        reason: 'tracked_runner_supervisor',
      });
    } else {
      if (args.intent === 'stop_line') {
        items.push({
          kind: 'runner',
          authority: 'unverified',
          action: 'mark_degraded',
          reason: 'tracked_pid_reused',
          lifecycle: 'stop_line',
        });
      } else {
        items.push({
          kind: 'runner',
          authority: 'unverified',
          action: 'block',
          reason: 'tracked_pid_reused',
        });
      }
    }
  }

  if (args.trackedApiPid !== null && !processByPid.has(args.trackedApiPid)) {
    items.push({
      kind: 'api',
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'tracked_pid_missing',
    });
  }

  if (args.trackedWebPid === null && !args.allowUntrackedPortCleanup) {
    const listeners = args.portListenersByPort.get(args.portWeb);

    if (listeners !== undefined && listeners.length > 0) {
      items.push({
        kind: 'web',
        authority: 'unverified',
        action: 'block',
        port: args.portWeb,
        reason: 'untracked_port_listener',
      });
    }
  }

  for (const mountPath of args.mountedTaskPaths ?? []) {
    if ((args.taskMountOwners.get(mountPath) ?? null) === null) {
      items.push({
        kind: 'mount',
        authority: 'ownerless_adoptable',
        action: 'reclaim_mount',
        mountPath,
      });
    }
  }

  return { items };
}

interface LocalManualOwnerJanitorCliArgs {
  kind: string | null;
  intent: LocalManualLifecycleIntent;
  normalizePlanStdin: boolean;
  runnerPidFile: string | null;
}

const CLI_PROCESS_SCAN_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function parseCliArgs(argv: string[]): LocalManualOwnerJanitorCliArgs {
  let kind: string | null = null;
  let intent: LocalManualLifecycleIntent = 'replace_runner';
  let normalizePlanStdin = false;
  let runnerPidFile: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--kind') {
      kind = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--runner-pid-file') {
      runnerPidFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--normalize-plan-stdin') {
      normalizePlanStdin = true;
      continue;
    }

    if (arg === '--intent') {
      const nextIntent = argv[index + 1] ?? null;
      if (nextIntent === 'replace_runner' || nextIntent === 'rollback_launch' || nextIntent === 'stop_line') {
        intent = nextIntent;
      }
      index += 1;
    }
  }

  return {
    kind,
    intent,
    normalizePlanStdin,
    runnerPidFile,
  };
}

function readTrackedRunnerPid(runnerPidFile: string): number | null {
  try {
    const rawPid = readFileSync(runnerPidFile, 'utf8').trim();
    if (!/^\d+$/.test(rawPid)) {
      return null;
    }

    const pid = Number.parseInt(rawPid, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function loadProcessCwdForCli(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  try {
    const cwd = readlinkSync(`/proc/${pid}/cwd`).trim();
    return cwd || null;
  } catch {
    // Fall back to platform tools below.
  }

  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      maxBuffer: CLI_PROCESS_SCAN_MAX_BUFFER_BYTES,
    });
    const cwd = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('n'));
    return cwd?.slice(1).trim() || null;
  } catch {
    // Fall through.
  }

  try {
    const output = execFileSync('pwdx', [String(pid)], {
      encoding: 'utf8',
      maxBuffer: CLI_PROCESS_SCAN_MAX_BUFFER_BYTES,
    });
    const cwd = output.split(':', 2)[1]?.trim();
    if (cwd && cwd !== 'No such process') {
      return cwd;
    }
  } catch {
    // Ignore pwdx failures.
  }

  return null;
}

function loadProcessesForCli(): ManagedProcessInfoLike[] {
  const output = execFileSync(
    'ps',
    ['-ww', '-eo', 'pid=,ppid=,command='],
    {
      encoding: 'utf8',
      maxBuffer: CLI_PROCESS_SCAN_MAX_BUFFER_BYTES,
    },
  );
  const processes: ManagedProcessInfoLike[] = [];

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }

    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue;
    }

    processes.push({
      pid,
      ppid,
      command: match[3].trim(),
      // Keep the process-table scan cheap; runner identity resolves cwd lazily only when needed.
      cwd: null,
    });
  }

  return processes;
}

function writeEmptyJson(): void {
  process.stdout.write('{}');
}

function runLocalManualOwnerJanitorCli(argv: string[] = process.argv.slice(2)): void {
  try {
    const parsedArgs = parseCliArgs(argv);
    if (parsedArgs.kind !== 'runner') {
      writeEmptyJson();
      return;
    }

    if (parsedArgs.normalizePlanStdin) {
      const rawPlan = readFileSync(0, 'utf8');
      process.stdout.write(JSON.stringify(normalizeLocalManualOwnerJanitorRunnerPlan(parsedArgs.intent, rawPlan)));
      return;
    }

    const trackedRunnerPid = parsedArgs.runnerPidFile
      ? readTrackedRunnerPid(parsedArgs.runnerPidFile.trim())
      : null;
    if (trackedRunnerPid === null) {
      writeEmptyJson();
      return;
    }

    const plan = buildLocalManualOwnerJanitorPlan({
      intent: parsedArgs.intent,
      rootDir: process.cwd(),
      trackedRunnerPid,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 0,
      portWeb: 0,
      allowUntrackedPortCleanup: false,
      processes: loadProcessesForCli(),
      portListenersByPort: new Map<number, number[]>(),
      gatewayStates: [],
      taskMountOwners: new Map<string, string | null>(),
      mountedTaskPaths: [],
    });

    const runnerItem = plan.items.find((item) => item.kind === 'runner');
    if (runnerItem === undefined) {
      writeEmptyJson();
      return;
    }

    process.stdout.write(JSON.stringify(runnerItem));
  } catch {
    writeEmptyJson();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runLocalManualOwnerJanitorCli();
}
