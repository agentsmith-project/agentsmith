import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runExternalModeRestore(): { log: string; stateExists: string } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-handoff-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const internalStateFile = path.join(tempRoot, 'internal', 'sandbox-control.env');
  const operationLog = path.join(tempRoot, 'operation.log');
  const envFile = path.join(tempRoot, '.env.local-manual');

  try {
    mkdirSync(path.dirname(internalStateFile), { recursive: true });
    writeFileSync(internalStateFile, 'sandbox=configured\n', 'utf8');
    writeFileSync(envFile, '', 'utf8');

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ENV_FILE="${envFile}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          source "${repoRoot}/scripts/local-manual/internal-common.sh"
          INTERNAL_SANDBOX_STATE_FILE="${internalStateFile}"
          stop_internal_runtime() {
            printf 'stop_internal_runtime\\n' >> "${operationLog}"
          }
          restart_api_with_mode() {
            printf 'restart_api_with_mode:%s\\n' "$1" >> "${operationLog}"
          }
          restore_local_manual_external_mode
          if [[ -f "${internalStateFile}" ]]; then
            printf 'state_exists=yes\\n'
          else
            printf 'state_exists=no\\n'
          fi
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    return {
      log: execFileSync('cat', [operationLog], { encoding: 'utf8' }),
      stateExists: output.match(/^state_exists=(.+)$/m)?.[1]?.trim() ?? '',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('local-manual internal handoff', () => {
  it('restores external mode even when the previous API ready marker is gone', () => {
    const result = runExternalModeRestore();

    expect(result.log).toBe('stop_internal_runtime\nrestart_api_with_mode:0\n');
    expect(result.stateExists).toBe('no');
  });
});
