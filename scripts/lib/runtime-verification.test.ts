import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('backend-real API base resolver', () => {
  it('reads summary.env API_BASE and normalizes the /api/v1 suffix for smoke scripts', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-verification-api-base-summary-'));
    const summaryDir = path.join(tempRoot, 'backend-real', 'current');

    try {
      mkdirSync(summaryDir, { recursive: true });
      writeFileSync(path.join(summaryDir, 'summary.env'), 'API_BASE="http://127.0.0.1:21000/api/v1"\n', 'utf8');

      const result = runRuntimeVerificationProbe(
        tempRoot,
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runtime-verification.sh"
          unset API_BASE RUNTIME_HOST_API_BASE_URL API_PORT INTEGRATION_API_PORT
          export BACKEND_REAL_STATE_DIR="${summaryDir}"
          resolve_backend_real_api_base_for_smoke
          printf 'API_BASE=%s\\n' "$API_BASE"
          printf 'RUNTIME_HOST_API_BASE_URL=%s\\n' "$RUNTIME_HOST_API_BASE_URL"
        `,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('API_BASE=http://127.0.0.1:21000\n');
      expect(result.stdout).toContain('RUNTIME_HOST_API_BASE_URL=http://127.0.0.1:21000\n');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to the local-manual api.port file before the old 20000 default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-verification-api-base-local-manual-'));
    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const apiPortDir = path.join(runtimeLinesRoot, 'local-manual', 'current');

    try {
      mkdirSync(apiPortDir, { recursive: true });
      writeFileSync(path.join(apiPortDir, 'api.port'), '23045\n', 'utf8');

      const result = runRuntimeVerificationProbe(
        tempRoot,
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runtime-verification.sh"
          unset API_BASE RUNTIME_HOST_API_BASE_URL API_PORT INTEGRATION_API_PORT BACKEND_REAL_SUMMARY_FILE
          export BACKEND_REAL_STATE_DIR="${path.join(tempRoot, 'missing-backend-real', 'current')}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          resolve_backend_real_api_base_for_smoke
          printf 'API_BASE=%s\\n' "$API_BASE"
          printf 'API_PORT=%s\\n' "$API_PORT"
        `,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('API_BASE=http://127.0.0.1:23045\n');
      expect(result.stdout).toContain('API_PORT=23045\n');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps an explicit API_BASE ahead of summary and local-manual fallbacks', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-verification-api-base-explicit-'));
    const summaryDir = path.join(tempRoot, 'backend-real', 'current');
    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const apiPortDir = path.join(runtimeLinesRoot, 'local-manual', 'current');

    try {
      mkdirSync(summaryDir, { recursive: true });
      mkdirSync(apiPortDir, { recursive: true });
      writeFileSync(path.join(summaryDir, 'summary.env'), 'API_BASE=http://127.0.0.1:21000/api/v1\n', 'utf8');
      writeFileSync(path.join(apiPortDir, 'api.port'), '23045\n', 'utf8');

      const result = runRuntimeVerificationProbe(
        tempRoot,
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runtime-verification.sh"
          export BACKEND_REAL_STATE_DIR="${summaryDir}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          export API_BASE="http://explicit.example.test:3999/api/v1"
          resolve_backend_real_api_base_for_smoke
          printf 'API_BASE=%s\\n' "$API_BASE"
        `,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('API_BASE=http://explicit.example.test:3999\n');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

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
