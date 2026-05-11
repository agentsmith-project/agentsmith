import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveInvalidLocalManualRunnerNormalizationCases,
  normalizeLocalManualOwnerJanitorRunnerPlan,
} from './owner-janitor.js';

const repoRoot = process.cwd();
const ownerJanitorCli = path.join(repoRoot, 'scripts/local-manual/owner-janitor.ts');
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');
const tempRoots: string[] = [];

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function deriveRepresentativeCliParityCases() {
  const representativeCases = [];
  const seenParityKeys = new Set<string>();

  for (const invalidCase of deriveInvalidLocalManualRunnerNormalizationCases()) {
    const parityKey = `${invalidCase.sourceRow.action}|${invalidCase.mutation}|${invalidCase.intent}|${invalidCase.expectedFallback.action}`;
    if (seenParityKeys.has(parityKey)) {
      continue;
    }
    seenParityKeys.add(parityKey);
    representativeCases.push(invalidCase);
  }

  return representativeCases;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('local-manual owner janitor cli', () => {
  it('keeps the real CLI path stable even when the process table output is large', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'owner-janitor-cli-'));
    tempRoots.push(tempRoot);

    const fakeBin = path.join(tempRoot, 'bin');
    const pidFile = path.join(tempRoot, 'runner.pid');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(pidFile, '4100\n', 'utf8');

    const largeProcessTable = Array.from({ length: 30_000 }, (_, index) => (
      `${5000 + index} 1 node /tmp/background-process-${index.toString().padStart(5, '0')}-${'x'.repeat(64)}.js`
    )).join('\n');

    const fakePs = path.join(fakeBin, 'ps');
    writeFileSync(
      fakePs,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 2 && "$1" == "-ww" && "$2" == "-eo" ]]; then
  cat <<'EOF_PS'
4100 1 make agent-task-runner-from-state
4101 4100 make agent-task-runner
4102 4101 npm run dev -w @mbos/agent-task-runner
4103 4102 node /repo/node_modules/tsx/dist/cli.mjs /repo/packages/agent-task-runner/src/index.ts
${largeProcessTable}
EOF_PS
  exit 0
fi
if [[ "$#" -ge 5 && "$1" == "-ww" && "$2" == "-o" && "$3" == "cwd=" && "$4" == "-p" ]]; then
  printf '%s\\n' '-'
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
      [ownerJanitorCli, '--kind', 'runner', '--intent', 'replace_runner', '--runner-pid-file', pidFile],
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

    expect(JSON.parse(output)).toMatchObject({
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

  it('normalizes valid JSON with a malformed stop_runner_tree contract through the CLI fallback path', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--intent', 'replace_runner', '--normalize-plan-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify({
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
        }, null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('normalizes semantically inconsistent remove_state_only plans through the CLI fallback path', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--intent', 'replace_runner', '--normalize-plan-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify({
          kind: 'runner',
          authority: 'stale_reclaimable',
          action: 'remove_state_only',
          reason: 'planner_malformed',
        }, null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('parses internal_api_restart as a first-class lifecycle intent through the CLI fallback path', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--intent', 'internal_api_restart', '--normalize-plan-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify({
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
        }, null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toMatchObject({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('fails closed for unknown CLI lifecycle intents instead of normalizing as replace_runner', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--intent', 'restart_typo', '--normalize-plan-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify({
          kind: 'runner',
          authority: 'current_active',
          action: 'stop_runner_tree',
          reason: 'tracked_runner_supervisor',
          stop: {
            scope: 'owned_runner_tree',
            root_pid: 4100,
            owned_pids: [4100, 4101],
            verification: 'all_owned_pids_exited',
          },
        }, null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toEqual({
      kind: 'runner',
      authority: 'unverified',
      action: 'block',
      reason: 'planner_malformed',
    });
  });

  it('normalizes internal_api_restart batch entries without falling back to replace_runner intent parsing', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--normalize-plan-batch-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify([
          {
            intent: 'internal_api_restart',
            payload: {
              kind: 'runner',
              authority: 'unverified',
              action: 'mark_degraded',
              reason: 'planner_malformed',
              lifecycle: 'stop_line',
            },
          },
        ], null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toEqual([
      {
        kind: 'runner',
        authority: 'unverified',
        action: 'block',
        reason: 'planner_malformed',
      },
    ]);
  });

  it('fails closed for batch entries with unknown lifecycle intents', () => {
    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--normalize-plan-batch-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify([
          {
            intent: 'restart_typo',
            payload: {
              kind: 'runner',
              authority: 'current_active',
              action: 'stop_runner_tree',
              reason: 'tracked_runner_supervisor',
              stop: {
                scope: 'owned_runner_tree',
                root_pid: 4100,
                owned_pids: [4100, 4101],
                verification: 'all_owned_pids_exited',
              },
            },
          },
        ], null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    expect(JSON.parse(output)).toEqual([
      {
        kind: 'runner',
        authority: 'unverified',
        action: 'block',
        reason: 'planner_malformed',
      },
    ]);
  });

  it('keeps the CLI parity subset structurally coverage-gated', () => {
    const representativeCases = deriveRepresentativeCliParityCases();

    expect(representativeCases).toHaveLength(50);
    expect(sortedUnique(representativeCases.map((invalidCase) => invalidCase.mutation))).toEqual([
      'authority',
      'intent',
      'lifecycle',
      'reason',
      'stop_missing',
      'stop_unexpected',
    ]);
    expect(sortedUnique(representativeCases.map((invalidCase) => invalidCase.intent))).toEqual([
      'internal_api_restart',
      'replace_runner',
      'rollback_launch',
      'stop_line',
    ]);
    expect(sortedUnique(
      representativeCases.map((invalidCase) => invalidCase.expectedFallback.action),
    )).toEqual([
      'block',
      'mark_degraded',
    ]);
    expect(sortedUnique(
      representativeCases.map((invalidCase) => `${invalidCase.sourceRow.action}|${invalidCase.mutation}|${invalidCase.intent}|${invalidCase.expectedFallback.action}`),
    )).toEqual([
      'block|authority|internal_api_restart|block',
      'block|authority|replace_runner|block',
      'block|authority|rollback_launch|block',
      'block|intent|stop_line|mark_degraded',
      'block|lifecycle|internal_api_restart|block',
      'block|lifecycle|replace_runner|block',
      'block|lifecycle|rollback_launch|block',
      'block|reason|internal_api_restart|block',
      'block|reason|replace_runner|block',
      'block|reason|rollback_launch|block',
      'block|stop_unexpected|internal_api_restart|block',
      'block|stop_unexpected|replace_runner|block',
      'block|stop_unexpected|rollback_launch|block',
      'mark_degraded|authority|stop_line|mark_degraded',
      'mark_degraded|intent|replace_runner|block',
      'mark_degraded|lifecycle|stop_line|mark_degraded',
      'mark_degraded|reason|stop_line|mark_degraded',
      'mark_degraded|stop_unexpected|stop_line|mark_degraded',
      'remove_state_only|authority|internal_api_restart|block',
      'remove_state_only|authority|replace_runner|block',
      'remove_state_only|authority|rollback_launch|block',
      'remove_state_only|authority|stop_line|mark_degraded',
      'remove_state_only|lifecycle|internal_api_restart|block',
      'remove_state_only|lifecycle|replace_runner|block',
      'remove_state_only|lifecycle|rollback_launch|block',
      'remove_state_only|lifecycle|stop_line|mark_degraded',
      'remove_state_only|reason|internal_api_restart|block',
      'remove_state_only|reason|replace_runner|block',
      'remove_state_only|reason|rollback_launch|block',
      'remove_state_only|reason|stop_line|mark_degraded',
      'remove_state_only|stop_unexpected|internal_api_restart|block',
      'remove_state_only|stop_unexpected|replace_runner|block',
      'remove_state_only|stop_unexpected|rollback_launch|block',
      'remove_state_only|stop_unexpected|stop_line|mark_degraded',
      'stop_runner_tree|authority|internal_api_restart|block',
      'stop_runner_tree|authority|replace_runner|block',
      'stop_runner_tree|authority|rollback_launch|block',
      'stop_runner_tree|authority|stop_line|mark_degraded',
      'stop_runner_tree|lifecycle|internal_api_restart|block',
      'stop_runner_tree|lifecycle|replace_runner|block',
      'stop_runner_tree|lifecycle|rollback_launch|block',
      'stop_runner_tree|lifecycle|stop_line|mark_degraded',
      'stop_runner_tree|reason|internal_api_restart|block',
      'stop_runner_tree|reason|replace_runner|block',
      'stop_runner_tree|reason|rollback_launch|block',
      'stop_runner_tree|reason|stop_line|mark_degraded',
      'stop_runner_tree|stop_missing|internal_api_restart|block',
      'stop_runner_tree|stop_missing|replace_runner|block',
      'stop_runner_tree|stop_missing|rollback_launch|block',
      'stop_runner_tree|stop_missing|stop_line|mark_degraded',
    ]);
  });

  it('keeps CLI fallback semantics aligned with in-process normalization for representative derived invalid runner tuples', () => {
    const representativeCases = deriveRepresentativeCliParityCases();
    const batchPayload = representativeCases.map((invalidCase) => ({
      intent: invalidCase.intent,
      payload: invalidCase.payload,
    }));

    const output = execFileSync(
      tsxBin,
      [ownerJanitorCli, '--kind', 'runner', '--normalize-plan-batch-stdin'],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        input: `${JSON.stringify(batchPayload, null, 2)}\n`,
        stdio: 'pipe',
      },
    ).trim();

    const normalizedResults = JSON.parse(output) as unknown[];

    expect(normalizedResults).toHaveLength(50);
    representativeCases.forEach((invalidCase, index) => {
      expect(normalizedResults[index], invalidCase.label).toEqual(
        normalizeLocalManualOwnerJanitorRunnerPlan(invalidCase.intent, JSON.stringify(invalidCase.payload)),
      );
    });
  });
});
