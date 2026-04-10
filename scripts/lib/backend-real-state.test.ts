import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string, rootDir: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROOT_DIR: rootDir,
      BACKEND_REAL_STATE_DIR: path.join(rootDir, 'artifacts/backend-real/current'),
      BACKEND_REAL_RUNS_DIR: path.join(rootDir, 'artifacts/backend-real/runs'),
    },
    encoding: 'utf8',
  }).trim();
}

describe('backend-real-state', () => {
  it('creates backend-real run roots outside the persistent current state directory', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/backend-real-state.sh');
    const output = runBash(
      `
        source "${helper}"
        ensure_backend_real_state
        run_dir="$(backend_real_new_run_dir integration)"
        printf '%s\\n%s\\n%s\\n' "$(backend_real_state_root)" "$(backend_real_runs_root)" "\${run_dir}"
      `,
      tempRoot,
    ).split('\n');

    expect(output[0]).toContain('/artifacts/backend-real/current');
    expect(output[1]).toContain('/artifacts/backend-real/runs');
    expect(output[2]).toContain('/artifacts/backend-real/runs/integration-');
  });

  it('prunes older failed backend-real runs while keeping the newest ones', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-prune-'));
    const helper = path.join(process.cwd(), 'scripts/lib/backend-real-state.sh');

    runBash(
      `
        source "${helper}"
        ensure_backend_real_state
        mkdir -p "$(backend_real_runs_root)/run-1" "$(backend_real_runs_root)/run-2" "$(backend_real_runs_root)/run-3"
        backend_real_mark_run_status "$(backend_real_runs_root)/run-1" failed
        sleep 1
        backend_real_mark_run_status "$(backend_real_runs_root)/run-2" failed
        sleep 1
        backend_real_mark_run_status "$(backend_real_runs_root)/run-3" failed
        backend_real_prune_run_dirs 2 24
      `,
      tempRoot,
    );

    const runs = readdirSync(path.join(tempRoot, 'artifacts/backend-real/runs')).sort();
    expect(runs).toEqual(['run-2', 'run-3']);
  });
});
