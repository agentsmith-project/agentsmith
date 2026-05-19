import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string, rootDir: string, envOverrides: NodeJS.ProcessEnv = {}): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ROOT_DIR: rootDir,
    BACKEND_REAL_STATE_DIR: path.join(rootDir, 'artifacts/backend-real/current'),
    BACKEND_REAL_RUNS_DIR: path.join(rootDir, 'artifacts/backend-real/runs'),
  };
  for (const [key, value] of Object.entries(envOverrides)) {
    env[key] = value;
  }
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env,
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

  it('reports and prunes forbidden live runtime entries from backend-real/current', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-boundary-'));
    const helper = path.join(process.cwd(), 'scripts/lib/backend-real-state.sh');

    const output = runBash(
      `
        source "${helper}"
        ensure_backend_real_state
        mkdir -p "$(backend_real_state_root)/local-manual"
        mkdir -p "$(backend_real_state_root)/release-ready"
        printf '123\\n' > "$(backend_real_state_root)/local-manual/api.pid"
        printf 'ready\\n' > "$(backend_real_state_root)/release-ready/api.log"
        printf '1\\n' > "$(backend_real_state_root)/local-manual-internal-runtime.cleanup"
        printf 'before=%s\\n' "$(backend_real_current_boundary_violations | paste -sd ',' -)"
        backend_real_prune_forbidden_current_entries
        printf 'after=%s\\n' "$(backend_real_current_boundary_violations | paste -sd ',' -)"
      `,
      tempRoot,
    ).split('\n');

    expect(output[0]).toContain('local-manual');
    expect(output[0]).toContain('release-ready');
    expect(output[0]).toContain('local-manual-internal-runtime.cleanup');
    expect(output[1]).toBe('after=');
  });

  it('normalizes relative backend-real state roots and derived runtime paths against ROOT_DIR', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-relative-root-'));
    const helper = path.join(process.cwd(), 'scripts/lib/backend-real-state.sh');

    const output = runBash(
      `
        source "${helper}"
        printf '%s\\n%s\\n%s\\n' \
          "$(backend_real_state_root)" \
          "$(backend_real_tmp_file integration-release-user-story/asbcp.yaml)" \
          "$(backend_real_resolve_runtime_path artifacts/backend-real/current/integration-release-user-story/asbcp.log)"
      `,
      tempRoot,
      {
        BACKEND_REAL_STATE_DIR: 'artifacts/backend-real/current',
      },
    ).split('\n');

    expect(output[0]).toBe(path.join(tempRoot, 'artifacts/backend-real/current'));
    expect(output[1]).toBe(
      path.join(tempRoot, 'artifacts/backend-real/current/integration-release-user-story/asbcp.yaml'),
    );
    expect(output[2]).toBe(
      path.join(tempRoot, 'artifacts/backend-real/current/integration-release-user-story/asbcp.log'),
    );
  });

  it('materializes a missing campaign-owned run root before writing the run status file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-run-status-'));
    const helper = path.join(process.cwd(), 'scripts/lib/backend-real-state.sh');
    const campaignOwnedRunRoot = path.join(
      tempRoot,
      'artifacts/release-runs/20260420T111449Z/gate-release/backend-real-run',
    );

    const statusFile = runBash(
      `
        source "${helper}"
        backend_real_mark_run_status "${campaignOwnedRunRoot}" incomplete
        printf '%s\\n' "$(backend_real_run_status_file "${campaignOwnedRunRoot}")"
      `,
      tempRoot,
    );

    expect(statusFile).toBe(path.join(campaignOwnedRunRoot, '.status'));
    expect(readFileSync(statusFile, 'utf8')).toBe('incomplete\n');
  });
});
