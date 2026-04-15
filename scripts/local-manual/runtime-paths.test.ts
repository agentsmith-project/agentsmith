import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function inspectLocalManualRuntime() {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-runtime-paths-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const runtimeLinesRoot = path.join(tempRoot, 'artifacts', 'runtime', 'lines');
  const legacyLocalManualRoot = path.join(backendRealRoot, 'local-manual');

  try {
    mkdirSync(legacyLocalManualRoot, { recursive: true });
    writeFileSync(path.join(legacyLocalManualRoot, 'api.pid'), '123\n', 'utf8');
    writeFileSync(path.join(backendRealRoot, 'local-manual-internal-runtime.cleanup'), '1\n', 'utf8');

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          printf 'local_manual_root=%s\\n' "\${LOCAL_MANUAL_ROOT}"
          printf 'evidence_dir=%s\\n' "\${LOCAL_MANUAL_EVIDENCE_DIR}"
          printf 'api_pid=%s\\n' "\${API_PID_FILE}"
          printf 'next_dist=%s\\n' "\${LOCAL_MANUAL_NEXT_DIST_DIR}"
          printf 'root_contract_dir=%s\\n' "\${LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR}"
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    const values = Object.fromEntries(
      output
        .trim()
        .split('\n')
        .map((line) => line.split(/=(.+)/, 2) as [string, string]),
    );

    return {
      values,
      tempRoot,
      backendRealRoot,
      runtimeLinesRoot,
      legacyEntries: readdirSync(backendRealRoot).sort(),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('local-manual runtime paths', () => {
  it('resolves local-manual runtime files under artifacts/runtime/lines/local-manual/current', () => {
    const inspection = inspectLocalManualRuntime();

    expect(inspection.values.local_manual_root).toBe(
      path.join(inspection.runtimeLinesRoot, 'local-manual', 'current'),
    );
    expect(inspection.values.evidence_dir).toBe(
      path.join(inspection.runtimeLinesRoot, 'local-manual', 'current', 'evidence'),
    );
    expect(inspection.values.api_pid).toBe(
      path.join(inspection.runtimeLinesRoot, 'local-manual', 'current', 'api.pid'),
    );
    expect(inspection.values.next_dist).toBe(
      path.join(inspection.runtimeLinesRoot, 'local-manual', 'current', 'next-dist'),
    );
    expect(inspection.values.root_contract_dir).toBe(
      path.join(inspection.runtimeLinesRoot, 'local-manual', 'current', 'next-generated-root'),
    );
  });

  it('cleans legacy local-manual runtime leftovers out of backend-real/current when initializing runtime paths', () => {
    const inspection = inspectLocalManualRuntime();

    expect(inspection.legacyEntries).not.toContain('local-manual');
    expect(inspection.legacyEntries).not.toContain('local-manual-internal-runtime.cleanup');
  });
});
