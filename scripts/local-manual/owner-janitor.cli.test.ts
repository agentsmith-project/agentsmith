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
    const parityKey = `${invalidCase.sourceRow.action}|${invalidCase.mutation}|${invalidCase.expectedFallback.action}`;
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
4100 1 make notebook-agent-runner
4101 4100 make notebook-runner
4102 4101 npm run dev -w @mbos/notebook-codex-runner
4103 4102 node /repo/node_modules/tsx/dist/cli.mjs /repo/packages/notebook-codex-runner/src/index.ts
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

  it('keeps the CLI parity subset structurally coverage-gated', () => {
    const representativeCases = deriveRepresentativeCliParityCases();

    expect(representativeCases).toHaveLength(26);
    expect(sortedUnique(representativeCases.map((invalidCase) => invalidCase.mutation))).toEqual([
      'authority',
      'intent',
      'lifecycle',
      'reason',
      'stop_missing',
      'stop_unexpected',
    ]);
    expect(sortedUnique(representativeCases.map((invalidCase) => invalidCase.intent))).toEqual([
      'replace_runner',
      'stop_line',
    ]);
    expect(sortedUnique(
      representativeCases.map((invalidCase) => invalidCase.expectedFallback.action),
    )).toEqual([
      'block',
      'mark_degraded',
    ]);
    expect(sortedUnique(
      representativeCases.map((invalidCase) => `${invalidCase.sourceRow.action}|${invalidCase.mutation}|${invalidCase.expectedFallback.action}`),
    )).toEqual([
      'block|authority|block',
      'block|intent|mark_degraded',
      'block|lifecycle|block',
      'block|reason|block',
      'block|stop_unexpected|block',
      'mark_degraded|authority|mark_degraded',
      'mark_degraded|intent|block',
      'mark_degraded|lifecycle|mark_degraded',
      'mark_degraded|reason|mark_degraded',
      'mark_degraded|stop_unexpected|mark_degraded',
      'remove_state_only|authority|block',
      'remove_state_only|authority|mark_degraded',
      'remove_state_only|lifecycle|block',
      'remove_state_only|lifecycle|mark_degraded',
      'remove_state_only|reason|block',
      'remove_state_only|reason|mark_degraded',
      'remove_state_only|stop_unexpected|block',
      'remove_state_only|stop_unexpected|mark_degraded',
      'stop_runner_tree|authority|block',
      'stop_runner_tree|authority|mark_degraded',
      'stop_runner_tree|lifecycle|block',
      'stop_runner_tree|lifecycle|mark_degraded',
      'stop_runner_tree|reason|block',
      'stop_runner_tree|reason|mark_degraded',
      'stop_runner_tree|stop_missing|block',
      'stop_runner_tree|stop_missing|mark_degraded',
    ]);
  });

  it('keeps CLI fallback semantics aligned with in-process normalization for representative derived invalid runner tuples', () => {
    for (const invalidCase of deriveRepresentativeCliParityCases()) {
      const output = execFileSync(
        tsxBin,
        [ownerJanitorCli, '--kind', 'runner', '--intent', invalidCase.intent, '--normalize-plan-stdin'],
        {
          cwd: repoRoot,
          env: process.env,
          encoding: 'utf8',
          input: `${JSON.stringify(invalidCase.payload, null, 2)}\n`,
          stdio: 'pipe',
        },
      ).trim();

      expect(JSON.parse(output), invalidCase.label).toEqual(
        normalizeLocalManualOwnerJanitorRunnerPlan(invalidCase.intent, JSON.stringify(invalidCase.payload)),
      );
    }
  });
});
