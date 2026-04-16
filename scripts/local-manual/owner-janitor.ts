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
type RunnerDerivedInvalidMutation =
  | 'authority'
  | 'reason'
  | 'intent'
  | 'lifecycle'
  | 'stop_missing'
  | 'stop_unexpected';

interface RunnerStopContract {
  scope: 'owned_runner_tree';
  root_pid: number;
  owned_pids: number[];
  verification: 'all_owned_pids_exited';
}

export interface LocalManualCanonicalRunnerNormalizationRow {
  readonly action: RunnerNormalizedAction;
  readonly authority: RunnerOwnerJanitorPlanItem['authority'];
  readonly reason: RunnerJanitorReason;
  readonly intent: LocalManualLifecycleIntent;
  readonly lifecycle: 'stop_line' | undefined;
  readonly requiresStopContract: boolean;
}

export interface LocalManualDerivedInvalidRunnerNormalizationCase {
  readonly label: string;
  readonly sourceRow: LocalManualCanonicalRunnerNormalizationRow;
  readonly mutation: RunnerDerivedInvalidMutation;
  readonly intent: LocalManualLifecycleIntent;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly expectedFallback: RunnerOwnerJanitorPlanItem;
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

const LOCAL_MANUAL_LIFECYCLE_INTENTS = ['replace_runner', 'rollback_launch', 'stop_line'] as const;
const RUNNER_JANITOR_AUTHORITIES = ['current_active', 'unverified', 'stale_reclaimable'] as const;
const RUNNER_JANITOR_REASONS = [
  'tracked_runner_supervisor',
  'tracked_pid_reused',
  'tracked_pid_missing',
  'planner_malformed',
  'planner_unavailable',
] as const;

const RUNNER_NORMALIZED_PLAN_MATRIX = {
  stop_runner_tree: {
    authority: 'current_active',
    intents: ['replace_runner', 'rollback_launch', 'stop_line'] as const,
    reasons: ['tracked_runner_supervisor'] as const,
    lifecycle: undefined,
    requiresStopContract: true,
  },
  block: {
    authority: 'unverified',
    intents: ['replace_runner', 'rollback_launch'] as const,
    reasons: ['tracked_pid_reused', 'planner_malformed', 'planner_unavailable'] as const,
    lifecycle: undefined,
    requiresStopContract: false,
  },
  mark_degraded: {
    authority: 'unverified',
    intents: ['stop_line'] as const,
    reasons: ['tracked_pid_reused', 'planner_malformed', 'planner_unavailable'] as const,
    lifecycle: 'stop_line' as const,
    requiresStopContract: false,
  },
  remove_state_only: {
    authority: 'stale_reclaimable',
    intents: ['replace_runner', 'rollback_launch', 'stop_line'] as const,
    reasons: ['tracked_pid_missing'] as const,
    lifecycle: undefined,
    requiresStopContract: false,
  },
} satisfies Record<
  RunnerNormalizedAction,
  {
    authority: RunnerOwnerJanitorPlanItem['authority'];
    intents: readonly LocalManualLifecycleIntent[];
    reasons: readonly RunnerJanitorReason[];
    lifecycle: 'stop_line' | undefined;
    requiresStopContract: boolean;
  }
>;

const DEFAULT_CANONICAL_RUNNER_STOP_CONTRACT = Object.freeze({
  scope: 'owned_runner_tree',
  root_pid: 4100,
  owned_pids: [4100, 4101],
  verification: 'all_owned_pids_exited',
} satisfies RunnerStopContract);

function freezeCanonicalRunnerRows(
  rows: LocalManualCanonicalRunnerNormalizationRow[],
): readonly LocalManualCanonicalRunnerNormalizationRow[] {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function freezeInvalidRunnerCases(
  cases: LocalManualDerivedInvalidRunnerNormalizationCase[],
): readonly LocalManualDerivedInvalidRunnerNormalizationCase[] {
  return Object.freeze(cases.map((invalidCase) => Object.freeze({
    ...invalidCase,
    // Preserve the exported canonical row object identity so every derived case
    // points back to the same structured source of truth.
    sourceRow: invalidCase.sourceRow,
    payload: Object.freeze({ ...invalidCase.payload }),
    expectedFallback: Object.freeze({
      ...invalidCase.expectedFallback,
      stop: invalidCase.expectedFallback.action === 'stop_runner_tree'
        ? {
            ...invalidCase.expectedFallback.stop,
            owned_pids: [...invalidCase.expectedFallback.stop.owned_pids],
          }
        : undefined,
    }),
  })));
}

function buildCanonicalRunnerRows(): readonly LocalManualCanonicalRunnerNormalizationRow[] {
  const rows: LocalManualCanonicalRunnerNormalizationRow[] = [];

  for (const action of Object.keys(RUNNER_NORMALIZED_PLAN_MATRIX) as RunnerNormalizedAction[]) {
    const actionContract = RUNNER_NORMALIZED_PLAN_MATRIX[action];
    for (const reason of actionContract.reasons) {
      for (const intent of actionContract.intents) {
        rows.push({
          action,
          authority: actionContract.authority,
          reason,
          intent,
          lifecycle: actionContract.lifecycle,
          requiresStopContract: actionContract.requiresStopContract,
        });
      }
    }
  }

  return freezeCanonicalRunnerRows(rows);
}

export const LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS = buildCanonicalRunnerRows();

function cloneCanonicalRunnerStopContract(): RunnerStopContract {
  return {
    ...DEFAULT_CANONICAL_RUNNER_STOP_CONTRACT,
    owned_pids: [...DEFAULT_CANONICAL_RUNNER_STOP_CONTRACT.owned_pids],
  };
}

export function buildCanonicalLocalManualRunnerPlan(
  row: LocalManualCanonicalRunnerNormalizationRow,
): RunnerOwnerJanitorPlanItem {
  if (row.action === 'stop_runner_tree') {
    return {
      kind: 'runner',
      authority: row.authority,
      action: row.action,
      reason: row.reason,
      stop: cloneCanonicalRunnerStopContract(),
    };
  }

  if (row.action === 'mark_degraded') {
    return {
      kind: 'runner',
      authority: row.authority,
      action: row.action,
      reason: row.reason,
      lifecycle: 'stop_line',
    };
  }

  return {
    kind: 'runner',
    authority: row.authority,
    action: row.action,
    reason: row.reason,
  };
}

function runnerFallbackForMalformedPlan(intent: LocalManualLifecycleIntent): RunnerOwnerJanitorPlanItem {
  return fallbackRunnerPlan(intent, 'planner_malformed');
}

function runnerCanonicalPayloadWithMutation(
  row: LocalManualCanonicalRunnerNormalizationRow,
  mutation: RunnerDerivedInvalidMutation,
): { intent: LocalManualLifecycleIntent; payload: Readonly<Record<string, unknown>> } {
  const payload = { ...buildCanonicalLocalManualRunnerPlan(row) } as Record<string, unknown>;

  if (mutation === 'authority') {
    const nextAuthority = RUNNER_JANITOR_AUTHORITIES.find((authority) => authority !== row.authority);
    if (!nextAuthority) {
      throw new Error(`missing alternate authority for ${row.action}`);
    }
    payload.authority = nextAuthority;
    return {
      intent: row.intent,
      payload: Object.freeze(payload),
    };
  }

  if (mutation === 'reason') {
    const nextReason = RUNNER_JANITOR_REASONS.find((reason) => (
      reason !== row.reason && !RUNNER_NORMALIZED_PLAN_MATRIX[row.action].reasons.includes(reason)
    ));
    if (!nextReason) {
      throw new Error(`missing alternate reason for ${row.action}`);
    }
    payload.reason = nextReason;
    return {
      intent: row.intent,
      payload: Object.freeze(payload),
    };
  }

  if (mutation === 'intent') {
    const nextIntent = LOCAL_MANUAL_LIFECYCLE_INTENTS.find((intent) => (
      intent !== row.intent && !RUNNER_NORMALIZED_PLAN_MATRIX[row.action].intents.includes(intent)
    ));
    if (!nextIntent) {
      throw new Error(`missing alternate intent for ${row.action}`);
    }
    return {
      intent: nextIntent,
      payload: Object.freeze(payload),
    };
  }

  if (mutation === 'lifecycle') {
    if (row.lifecycle === 'stop_line') {
      delete payload.lifecycle;
    } else {
      payload.lifecycle = 'stop_line';
    }
    return {
      intent: row.intent,
      payload: Object.freeze(payload),
    };
  }

  if (mutation === 'stop_missing') {
    delete payload.stop;
    return {
      intent: row.intent,
      payload: Object.freeze(payload),
    };
  }

  payload.stop = cloneCanonicalRunnerStopContract();
  return {
    intent: row.intent,
    payload: Object.freeze(payload),
  };
}

function expectedDerivedInvalidMutationsForRow(
  row: LocalManualCanonicalRunnerNormalizationRow,
): readonly RunnerDerivedInvalidMutation[] {
  const mutations: RunnerDerivedInvalidMutation[] = ['authority', 'reason', 'lifecycle'];
  if (row.action === 'stop_runner_tree') {
    mutations.push('stop_missing');
  } else {
    mutations.push('stop_unexpected');
  }
  if (row.action === 'block' || row.action === 'mark_degraded') {
    mutations.push('intent');
  }
  return Object.freeze(mutations);
}

export function deriveInvalidLocalManualRunnerNormalizationCases():
readonly LocalManualDerivedInvalidRunnerNormalizationCase[] {
  const invalidCases: LocalManualDerivedInvalidRunnerNormalizationCase[] = [];

  for (const row of LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS) {
    for (const mutation of expectedDerivedInvalidMutationsForRow(row)) {
      const mutated = runnerCanonicalPayloadWithMutation(row, mutation);
      invalidCases.push({
        label: `${row.action}|${row.reason}|${row.intent}|${mutation}`,
        sourceRow: row,
        mutation,
        intent: mutated.intent,
        payload: mutated.payload,
        expectedFallback: runnerFallbackForMalformedPlan(mutated.intent),
      });
    }
  }

  return freezeInvalidRunnerCases(invalidCases);
}

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
  if (!actionContract.intents.includes(intent)) {
    return false;
  }

  if (
    value.authority !== actionContract.authority
    || !actionContract.reasons.includes(value.reason as RunnerJanitorReason)
  ) {
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
  normalizePlanBatchStdin: boolean;
  runnerPidFile: string | null;
}

const CLI_PROCESS_SCAN_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function parseCliArgs(argv: string[]): LocalManualOwnerJanitorCliArgs {
  let kind: string | null = null;
  let intent: LocalManualLifecycleIntent = 'replace_runner';
  let normalizePlanStdin = false;
  let normalizePlanBatchStdin = false;
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

    if (arg === '--normalize-plan-batch-stdin') {
      normalizePlanBatchStdin = true;
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
    normalizePlanBatchStdin,
    runnerPidFile,
  };
}

function isLocalManualLifecycleIntent(value: unknown): value is LocalManualLifecycleIntent {
  return value === 'replace_runner' || value === 'rollback_launch' || value === 'stop_line';
}

function parseJsonLines(value: string): unknown[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function normalizeBatchPlanItem(value: unknown): RunnerOwnerJanitorPlanItem {
  if (!isRecord(value)) {
    return fallbackRunnerPlan('replace_runner', 'planner_malformed');
  }

  const intent = isLocalManualLifecycleIntent(value.intent) ? value.intent : 'replace_runner';
  if (typeof value.rawPlan === 'string') {
    return normalizeLocalManualOwnerJanitorRunnerPlan(intent, value.rawPlan);
  }

  if ('payload' in value) {
    return normalizeLocalManualOwnerJanitorRunnerPlan(intent, JSON.stringify(value.payload));
  }

  return normalizeLocalManualOwnerJanitorRunnerPlan(intent, JSON.stringify(value));
}

function normalizeLocalManualOwnerJanitorRunnerPlanBatch(rawInput: string): RunnerOwnerJanitorPlanItem[] {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => normalizeBatchPlanItem(item));
  } catch {
    try {
      return parseJsonLines(trimmed).map((item) => normalizeBatchPlanItem(item));
    } catch {
      return [fallbackRunnerPlan('replace_runner', 'planner_malformed')];
    }
  }
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

    if (parsedArgs.normalizePlanBatchStdin) {
      const rawPlanBatch = readFileSync(0, 'utf8');
      process.stdout.write(JSON.stringify(normalizeLocalManualOwnerJanitorRunnerPlanBatch(rawPlanBatch)));
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
