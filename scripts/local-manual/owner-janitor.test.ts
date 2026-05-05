import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedProcessInfo } from '../juicefs-orphan-preflight.js';
import {
  buildCanonicalLocalManualRunnerPlan,
  buildLocalManualOwnerJanitorPlan,
  deriveInvalidLocalManualRunnerNormalizationCases,
  LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS,
  type LocalManualCanonicalRunnerNormalizationRow,
  normalizeLocalManualOwnerJanitorRunnerPlan,
} from './owner-janitor.js';

const repoRoot = process.cwd();
const ownerJanitorCli = path.join(repoRoot, 'scripts/local-manual/owner-janitor.ts');
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');
const tempRoots: string[] = [];

function buildProcess(overrides: Partial<ManagedProcessInfo> = {}): ManagedProcessInfo {
  return {
    pid: 7100,
    ppid: 1,
    ageSeconds: 1200,
    cwd: null,
    command: 'node /tmp/unrelated.js',
    ...overrides,
  };
}

function runOwnerJanitorCliWithProcessTable(args: {
  trackedRunnerPid: number;
  processTable: string[];
  intent: 'replace_runner' | 'stop_line';
}): Record<string, unknown> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-owner-janitor-cli-'));
  tempRoots.push(tempRoot);

  const fakeBin = path.join(tempRoot, 'bin');
  const pidFile = path.join(tempRoot, 'runner.pid');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(pidFile, `${args.trackedRunnerPid}\n`, 'utf8');

  const fakePs = path.join(fakeBin, 'ps');
  writeFileSync(
    fakePs,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 2 && "$1" == "-ww" && "$2" == "-eo" ]]; then
  cat <<'EOF_PS'
${args.processTable.join('\n')}
EOF_PS
  exit 0
fi
if [[ "$#" -ge 5 && "$1" == "-ww" && "$2" == "-o" && "$3" == "cwd=" && "$4" == "-p" ]]; then
  printf '%s\\n' '${path.join(repoRoot, 'packages/agent-task-runner')}'
  exit 0
fi
printf 'unsupported ps invocation: %s\\n' "$*" >&2
exit 1
`,
    'utf8',
  );
  chmodSync(fakePs, 0o755);

  const output = execFileSync(
    tsxBin,
    [ownerJanitorCli, '--kind', 'runner', '--intent', args.intent, '--runner-pid-file', pidFile],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  ).trim();

  return JSON.parse(output) as Record<string, unknown>;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

function canonicalRunnerRowKey(row: LocalManualCanonicalRunnerNormalizationRow): string {
  return `${row.action}|${row.authority}|${row.reason}|${row.intent}|${row.lifecycle ?? '-'}`;
}

function expectedMutationKindsForRow(
  row: LocalManualCanonicalRunnerNormalizationRow,
): string[] {
  const mutations = ['authority', 'reason', 'lifecycle'];
  if (row.action === 'stop_runner_tree') {
    mutations.push('stop_missing');
  } else {
    mutations.push('stop_unexpected');
  }
  if (row.action === 'block' || row.action === 'mark_degraded') {
    mutations.push('intent');
  }
  return mutations.sort();
}

describe('local-manual owner janitor', () => {
  it('exposes the canonical runner normalization rows as a single structured truth', () => {
    const canonicalRows = LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS;
    const canonicalRowRefs = new Set(canonicalRows);
    const invalidCases = deriveInvalidLocalManualRunnerNormalizationCases();

    expect(Object.isFrozen(canonicalRows)).toBe(true);
    expect(canonicalRows.every((row) => Object.isFrozen(row))).toBe(true);
    expect(new Set(canonicalRows.map(canonicalRunnerRowKey)).size).toBe(canonicalRows.length);
    expect(new Set(invalidCases.map((invalidCase) => invalidCase.sourceRow)).size).toBe(canonicalRows.length);
    expect(invalidCases.every((invalidCase) => canonicalRowRefs.has(invalidCase.sourceRow))).toBe(true);
  });

  it('keeps the canonical runner normalization rows approval-gated', () => {
    expect(LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS).toEqual([
      { action: 'stop_runner_tree', authority: 'current_active', reason: 'tracked_runner_supervisor', intent: 'replace_runner', lifecycle: undefined, requiresStopContract: true },
      { action: 'stop_runner_tree', authority: 'current_active', reason: 'tracked_runner_supervisor', intent: 'rollback_launch', lifecycle: undefined, requiresStopContract: true },
      { action: 'stop_runner_tree', authority: 'current_active', reason: 'tracked_runner_supervisor', intent: 'stop_line', lifecycle: undefined, requiresStopContract: true },
      { action: 'block', authority: 'unverified', reason: 'tracked_pid_reused', intent: 'replace_runner', lifecycle: undefined, requiresStopContract: false },
      { action: 'block', authority: 'unverified', reason: 'tracked_pid_reused', intent: 'rollback_launch', lifecycle: undefined, requiresStopContract: false },
      { action: 'block', authority: 'unverified', reason: 'planner_malformed', intent: 'replace_runner', lifecycle: undefined, requiresStopContract: false },
      { action: 'block', authority: 'unverified', reason: 'planner_malformed', intent: 'rollback_launch', lifecycle: undefined, requiresStopContract: false },
      { action: 'block', authority: 'unverified', reason: 'planner_unavailable', intent: 'replace_runner', lifecycle: undefined, requiresStopContract: false },
      { action: 'block', authority: 'unverified', reason: 'planner_unavailable', intent: 'rollback_launch', lifecycle: undefined, requiresStopContract: false },
      { action: 'mark_degraded', authority: 'unverified', reason: 'tracked_pid_reused', intent: 'stop_line', lifecycle: 'stop_line', requiresStopContract: false },
      { action: 'mark_degraded', authority: 'unverified', reason: 'planner_malformed', intent: 'stop_line', lifecycle: 'stop_line', requiresStopContract: false },
      { action: 'mark_degraded', authority: 'unverified', reason: 'planner_unavailable', intent: 'stop_line', lifecycle: 'stop_line', requiresStopContract: false },
      { action: 'remove_state_only', authority: 'stale_reclaimable', reason: 'tracked_pid_missing', intent: 'replace_runner', lifecycle: undefined, requiresStopContract: false },
      { action: 'remove_state_only', authority: 'stale_reclaimable', reason: 'tracked_pid_missing', intent: 'rollback_launch', lifecycle: undefined, requiresStopContract: false },
      { action: 'remove_state_only', authority: 'stale_reclaimable', reason: 'tracked_pid_missing', intent: 'stop_line', lifecycle: undefined, requiresStopContract: false },
    ]);
  });

  it('accepts every canonical runner row for every allowed intent and reason pairing', () => {
    for (const row of LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS) {
      const canonicalPlan = buildCanonicalLocalManualRunnerPlan(row);

      expect(
        normalizeLocalManualOwnerJanitorRunnerPlan(row.intent, JSON.stringify(canonicalPlan)),
        canonicalRunnerRowKey(row),
      ).toEqual(canonicalPlan);
    }
  });

  it('rejects every non-canonical runner tuple by falling back per intent', () => {
    const invalidCases = deriveInvalidLocalManualRunnerNormalizationCases();
    const mutationsByRow = new Map<string, string[]>();

    for (const invalidCase of invalidCases) {
      const rowKey = canonicalRunnerRowKey(invalidCase.sourceRow);
      const existing = mutationsByRow.get(rowKey) ?? [];
      existing.push(invalidCase.mutation);
      mutationsByRow.set(rowKey, existing);

      expect(
        normalizeLocalManualOwnerJanitorRunnerPlan(invalidCase.intent, JSON.stringify(invalidCase.payload)),
        invalidCase.label,
      ).toEqual(invalidCase.expectedFallback);
    }

    expect(new Set(invalidCases.map((invalidCase) => invalidCase.label)).size).toBe(invalidCases.length);

    for (const row of LOCAL_MANUAL_CANONICAL_RUNNER_NORMALIZATION_ROWS) {
      expect(
        (mutationsByRow.get(canonicalRunnerRowKey(row)) ?? []).sort(),
        canonicalRunnerRowKey(row),
      ).toEqual(expectedMutationKindsForRow(row));
    }
  });

  it('blocks runner cleanup when the tracked pid was reused by an unrelated process', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: 4100,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [
        buildProcess({
          pid: 4100,
          command: 'node /tmp/unrelated.js',
        }),
      ],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'runner')).toMatchObject({
      authority: 'unverified',
      action: 'block',
      reason: 'tracked_pid_reused',
    });
  });

  it('allows stopping the tracked runner supervisor when a canonical runner exists anywhere in its descendant chain', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: 4100,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [
        buildProcess({
          pid: 4100,
          command: 'make agent-task-runner-from-state',
        }),
        buildProcess({
          pid: 4101,
          ppid: 4100,
          command: 'make agent-task-runner',
        }),
        buildProcess({
          pid: 4102,
          ppid: 4101,
          command: 'npm run dev -w @mbos/agent-task-runner',
        }),
        buildProcess({
          pid: 4103,
          ppid: 4102,
          cwd: '/repo/packages/agent-task-runner',
          command: 'node /repo/node_modules/tsx/dist/cli.mjs src/index.ts',
        }),
      ],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'runner')).toMatchObject({
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: [4100, 4101, 4102, 4103],
        verification: 'all_owned_pids_exited',
      },
    });
  });

  it('recognizes a real CLI-style runner supervisor tree and includes the whole owned tree in stop_runner_tree', () => {
    const plan = runOwnerJanitorCliWithProcessTable({
      trackedRunnerPid: 4100,
      intent: 'replace_runner',
      processTable: [
        '4100 1 /tmp/fake-bin/make agent-task-runner-from-state',
        '4101 4100 /bin/bash /tmp/runner-supervisor-child.sh',
        '4102 4101 make agent-task-runner',
        '4103 4102 npm run dev -w @mbos/agent-task-runner',
        `4104 4103 node ${path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs')} src/index.ts`,
      ],
    });

    expect(plan).toMatchObject({
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: [4100, 4101, 4102, 4103, 4104],
        verification: 'all_owned_pids_exited',
      },
    });
  });

  it('blocks replace_runner when the tracked runner supervisor tree has no canonical runner leaf in real CLI process output', () => {
    const plan = runOwnerJanitorCliWithProcessTable({
      trackedRunnerPid: 4100,
      intent: 'replace_runner',
      processTable: [
        '4100 1 /tmp/fake-bin/make agent-task-runner-from-state',
        '4101 4100 make agent-task-runner',
        '4102 4101 npm run dev -w @mbos/agent-task-runner',
        `4103 4102 node ${path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs')} src/not-runner.ts`,
      ],
    });

    expect(plan).toMatchObject({
      authority: 'unverified',
      action: 'block',
      reason: 'tracked_pid_reused',
    });
  });

  it('marks stop_line degraded when the tracked runner supervisor tree has no canonical runner leaf in real CLI process output', () => {
    const plan = runOwnerJanitorCliWithProcessTable({
      trackedRunnerPid: 4100,
      intent: 'stop_line',
      processTable: [
        '4100 1 /tmp/fake-bin/make agent-task-runner-from-state',
        '4101 4100 make agent-task-runner',
        '4102 4101 npm run dev -w @mbos/agent-task-runner',
      ],
    });

    expect(plan).toMatchObject({
      authority: 'unverified',
      action: 'mark_degraded',
      reason: 'tracked_pid_reused',
      lifecycle: 'stop_line',
    });
  });

  it('treats a missing tracked runner pid as stale state-only cleanup instead of a block', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: 4100,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'runner')).toMatchObject({
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'tracked_pid_missing',
    });
  });

  it('accepts canonical remove_state_only only for stale_reclaimable + tracked_pid_missing', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'tracked_pid_missing',
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'tracked_pid_missing',
    });
  });

  it('blocks untracked web listeners by default instead of killing them', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: null,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [
        buildProcess({
          pid: 5100,
          command: 'node /tmp/other-web.js',
        }),
      ],
      portListenersByPort: new Map([[3001, [5100]]]),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'web')).toMatchObject({
      authority: 'unverified',
      action: 'block',
      reason: 'untracked_port_listener',
      port: 3001,
    });
  });

  it('treats stale tracked pid files as stale_reclaimable state-only cleanup', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: null,
      trackedApiPid: 4200,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'api')).toMatchObject({
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'tracked_pid_missing',
    });
  });

  it('includes mount cleanup items using the shared janitor authority semantics', () => {
    const mountPath = path.join('/repo', 'ags-workspace', 'task_demo');
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'replace_runner',
      rootDir: '/repo',
      trackedRunnerPid: null,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map([[mountPath, null]]),
      mountedTaskPaths: [mountPath],
    });

    expect(plan.items.find((item) => item.kind === 'mount')).toMatchObject({
      authority: 'ownerless_adoptable',
      action: 'reclaim_mount',
      mountPath,
    });
  });

  it('marks the runner degraded for stop-line cleanup when ownership is unverified', () => {
    const plan = buildLocalManualOwnerJanitorPlan({
      intent: 'stop_line',
      rootDir: '/repo',
      trackedRunnerPid: 4100,
      trackedApiPid: null,
      trackedWebPid: null,
      portApi: 20000,
      portWeb: 3001,
      allowUntrackedPortCleanup: false,
      processes: [
        buildProcess({
          pid: 4100,
          command: 'node /tmp/unrelated.js',
        }),
      ],
      portListenersByPort: new Map(),
      gatewayStates: [],
      taskMountOwners: new Map(),
    });

    expect(plan.items.find((item) => item.kind === 'runner')).toMatchObject({
      authority: 'unverified',
      action: 'mark_degraded',
      reason: 'tracked_pid_reused',
      lifecycle: 'stop_line',
    });
  });

  it('treats valid JSON with a malformed stop_runner_tree contract as planner_malformed for stop_line', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('stop_line', JSON.stringify({
      kind: 'runner',
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: '4100 4101',
        verification: 'all_owned_pids_exited',
      },
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'mark_degraded',
      reason: 'planner_malformed',
      lifecycle: 'stop_line',
    });
  });

  it('treats empty owned_pids as planner_malformed for replace_runner', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: [],
        verification: 'all_owned_pids_exited',
      },
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats stop contracts with type mismatches as planner_malformed', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: '4100',
        owned_pids: [4100, 4101],
        verification: 'all_owned_pids_exited',
      },
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats semantically incomplete stop contracts as planner_malformed', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'tracked_runner_supervisor',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: [4101, 4102],
        verification: 'all_owned_pids_exited',
      },
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats remove_state_only + planner_malformed as planner_malformed fallback', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'stale_reclaimable',
      action: 'remove_state_only',
      reason: 'planner_malformed',
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats stop_runner_tree + planner_unavailable as planner_malformed fallback', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'current_active',
      action: 'stop_runner_tree',
      reason: 'planner_unavailable',
      stop: {
        scope: 'owned_runner_tree',
        root_pid: 4100,
        owned_pids: [4100, 4101],
        verification: 'all_owned_pids_exited',
      },
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats block + tracked_pid_missing as planner_malformed fallback', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('replace_runner', JSON.stringify({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'tracked_pid_missing',
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('treats mark_degraded + tracked_pid_missing as planner_malformed fallback', () => {
    const normalized = normalizeLocalManualOwnerJanitorRunnerPlan('stop_line', JSON.stringify({
      kind: 'runner',
      authority: 'unverified',
      action: 'mark_degraded',
      reason: 'tracked_pid_missing',
      lifecycle: 'stop_line',
    }));

    expect(normalized).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'mark_degraded',
      reason: 'planner_malformed',
      lifecycle: 'stop_line',
    });
  });
});
