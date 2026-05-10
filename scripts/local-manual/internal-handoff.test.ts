import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function renderInternalSandboxConfig(): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-config-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const runtimeLinesRoot = path.join(tempRoot, 'artifacts', 'runtime', 'lines');
  const internalDir = path.join(tempRoot, 'internal');
  const configPath = path.join(internalDir, 'sandbox-manager.yaml');
  const envFile = path.join(tempRoot, '.env.local-manual');
  const internalEnvFile = path.join(tempRoot, 'local-manual-internal.env');

  try {
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(envFile, '', 'utf8');
    writeFileSync(internalEnvFile, '', 'utf8');

    execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ENV_FILE="${envFile}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
          export LOCAL_MANUAL_INTERNAL_ENV_FILE="${internalEnvFile}"
          export INTERNAL_REAL_DIR="${internalDir}"
          export INTERNAL_SANDBOX_MANAGER_CONFIG="${configPath}"
          export SANDBOX_MANAGER_URL="http://127.0.0.1:29080"
          export INTERNAL_AGENT_K8S_NAMESPACE="agentsmith-sandbox"
          export LOCAL_MANUAL_INTERNAL_AGENT_IMAGE="runner:test"
          export AFSCP_BASE_URL="http://yaml-afscp.invalid"
          export AFSCP_ORCHESTRATOR_CALLER_SERVICE="yaml-manager"
          export AFSCP_ORCHESTRATOR_SERVICE_TOKEN="yaml-token"
          source "${repoRoot}/scripts/local-manual/internal-common.sh"
          write_internal_sandbox_config
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    return readFileSync(configPath, 'utf8');
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

  it('keeps sandbox-manager AFSCP truth in env instead of generated YAML config', () => {
    const config = renderInternalSandboxConfig();

    expect(config).toContain('httpPort: 29080');
    expect(config).toContain('namespace: agentsmith-sandbox');
    expect(config).not.toMatch(/^afscp:\s*$/mu);
    expect(config).not.toContain('http://yaml-afscp.invalid');
    expect(config).not.toContain('yaml-token');
    expect(config).not.toContain('callerService:');
    expect(config).not.toContain('serviceToken:');
  });

  it('creates the internal sandbox namespace through the AgentSmith-owned namespace helper', () => {
    const script = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');

    expect(script).toContain('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    expect(script).not.toContain('kubectl create namespace "${K8S_NAMESPACE}"');
  });
});
