import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function runRuntimeVerificationProbe(tempRoot: string, probeScript: string) {
  const result = spawnSync('bash', ['-lc', probeScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: tempRoot,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('runtime verification universal proxy admin gate', () => {
  it('fails closed without probing admin state when the admin token is empty', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-verification-proxy-admin-empty-'));
    const dockerLog = path.join(tempRoot, 'docker-compose.log');
    const evidenceDir = path.join(tempRoot, 'evidence');

    try {
      const result = runRuntimeVerificationProbe(
        tempRoot,
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runtime-verification.sh"
          docker_compose() {
            printf '%s\\n' "$*" >> "${dockerLog}"
            printf '200'
            return 0
          }
          if gate_wait_for_universal_proxy_admin_state "${evidenceDir}" "http://universal-proxy:8080" "" 0 infra_dependency_unready infra_preflight_proxy; then
            printf 'unexpected success\\n' >&2
            exit 1
          fi
        `,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(existsSync(dockerLog)).toBe(false);

      const failure = JSON.parse(readFileSync(path.join(evidenceDir, 'failure-classification.json'), 'utf8'));
      expect(failure.classification).toBe('infra_dependency_unready');
      expect(failure.stage).toBe('infra_preflight_proxy');
      expect(failure.message).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
      expect(failure.message).toContain('/admin/state bearer probe');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('probes admin state with the bearer admin token when present', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-verification-proxy-admin-bearer-'));
    const dockerLog = path.join(tempRoot, 'docker-compose.log');
    const evidenceDir = path.join(tempRoot, 'evidence');

    try {
      const result = runRuntimeVerificationProbe(
        tempRoot,
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runtime-verification.sh"
          docker_compose() {
            printf '%s\\n' "$*" >> "${dockerLog}"
            case "\${1:-}" in
              ps)
                printf 'universal-proxy\\n'
                ;;
              exec)
                printf '200'
                ;;
            esac
            return 0
          }
          gate_wait_for_universal_proxy_admin_state "${evidenceDir}" "http://universal-proxy:8080" "fixture-admin-token" 0 infra_dependency_unready infra_preflight_proxy
        `,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const dockerCalls = readFileSync(dockerLog, 'utf8');
      expect(dockerCalls).toContain('ps --status running universal-proxy');
      expect(dockerCalls).toContain('exec -T');
      expect(dockerCalls).toContain('GATE_PROXY_ADMIN_TOKEN=fixture-admin-token');
      expect(dockerCalls).toContain('Authorization: Bearer $GATE_PROXY_ADMIN_TOKEN');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
