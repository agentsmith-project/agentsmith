import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string, rootDir: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROOT_DIR: rootDir,
    },
    encoding: 'utf8',
  }).trim();
}

describe('lane-run-state', () => {
  it('creates lane-private run roots and current links', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'lane-run-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/lane-run-state.sh');
    const output = runBash(
      `
        source "${helper}"
        run_id="$(lane_generate_run_id mock)"
        run_root="$(lane_prepare_run_root mock-lane "\${run_id}" current)"
        printf '%s\\n%s\\n%s\\n' "\${run_root}" "$(readlink "$(lane_state_root mock-lane)/current")" "$(lane_runs_root mock-lane)"
      `,
      tempRoot,
    ).split('\n');

    expect(output[0]).toContain('/artifacts/mock-lane/runs/mock-');
    expect(output[1]).toContain('/artifacts/mock-lane/runs/mock-');
    expect(output[2]).toContain('/artifacts/mock-lane/runs');
  });

  it('prunes success runs and keeps only the newest failed runs', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'lane-run-prune-'));
    const helper = path.join(process.cwd(), 'scripts/lib/lane-run-state.sh');

    runBash(
      `
        source "${helper}"
        run1="$(lane_prepare_run_root mock-lane "run-1" current)"
        lane_mark_status "\${run1}" success
        sleep 1
        run2="$(lane_prepare_run_root mock-lane "run-2" current)"
        lane_mark_status "\${run2}" failed
        sleep 1
        run3="$(lane_prepare_run_root mock-lane "run-3" current)"
        lane_mark_status "\${run3}" failed
        sleep 1
        run4="$(lane_prepare_run_root mock-lane "run-4" current)"
        lane_mark_status "\${run4}" failed
        lane_prune_runs mock-lane 2 24
      `,
      tempRoot,
    );

    const runsRoot = path.join(tempRoot, 'artifacts/mock-lane/runs');
    const dirs = statSync(runsRoot).isDirectory()
      ? readdirSync(runsRoot).sort()
      : [];

    expect(dirs).toEqual(['run-3', 'run-4']);
  });

  it('migrates a legacy alias directory before creating a symlink', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'lane-run-alias-'));
    const helper = path.join(process.cwd(), 'scripts/lib/lane-run-state.sh');

    runBash(
      `
        source "${helper}"
        mkdir -p "${tempRoot}/artifacts/backend-real/current/integration"
        printf 'legacy\\n' > "${tempRoot}/artifacts/backend-real/current/integration/marker.txt"
        lane_prepare_alias_link "${tempRoot}/artifacts/backend-real/runs/demo/integration" "${tempRoot}/artifacts/backend-real/current/integration"
      `,
      tempRoot,
    );

    const currentPath = path.join(tempRoot, 'artifacts/backend-real/current/integration');
    expect(lstatSync(currentPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(currentPath)).toContain('/artifacts/backend-real/runs/demo/integration');

    const currentRootEntries = readdirSync(path.join(tempRoot, 'artifacts/backend-real/current')).sort();
    expect(currentRootEntries.some((entry) => entry.startsWith('integration-legacy-'))).toBe(true);
  });

  it('prunes stale legacy alias directories while keeping the newest one', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'lane-run-legacy-prune-'));
    const helper = path.join(process.cwd(), 'scripts/lib/lane-run-state.sh');

    runBash(
      `
        source "${helper}"
        mkdir -p "${tempRoot}/artifacts/mock-lane/current-legacy-old"
        printf 'old\\n' > "${tempRoot}/artifacts/mock-lane/current-legacy-old/marker.txt"
        touch -t 200001010000 "${tempRoot}/artifacts/mock-lane/current-legacy-old"
        mkdir -p "${tempRoot}/artifacts/mock-lane/current-legacy-new"
        printf 'new\\n' > "${tempRoot}/artifacts/mock-lane/current-legacy-new/marker.txt"
        lane_prune_runs mock-lane 5 24
      `,
      tempRoot,
    );

    const rootEntries = readdirSync(path.join(tempRoot, 'artifacts/mock-lane')).sort();
    expect(rootEntries).toContain('current-legacy-new');
    expect(rootEntries).not.toContain('current-legacy-old');
  });
});
