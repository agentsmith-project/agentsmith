import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const ownerJanitorCli = path.join(repoRoot, 'scripts/local-manual/owner-janitor.ts');
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');
const tempRoots: string[] = [];

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
});
