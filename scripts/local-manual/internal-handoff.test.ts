import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function functionBody(source: string, functionName: string): string {
  const match = source.match(new RegExp(`${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`, 'u'));
  return match?.[1] ?? '';
}

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

function runInternalCommonSnippet(script: string): { stdout: string; stderr: string; status: number | null } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-jvs-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const envFile = path.join(tempRoot, '.env.local-manual');
  const internalEnvFile = path.join(tempRoot, 'local-manual-internal.env');

  try {
    mkdirSync(path.dirname(envFile), { recursive: true });
    writeFileSync(envFile, '', 'utf8');
    writeFileSync(internalEnvFile, '', 'utf8');

    return spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ENV_FILE="${envFile}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
          export LOCAL_MANUAL_INTERNAL_ENV_FILE="${internalEnvFile}"
          export SNIPPET_TEMP_ROOT="${tempRoot}"
          source "${repoRoot}/scripts/local-manual/internal-common.sh"
          ${script}
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
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

function runInternalUpWithStubbedCommon(): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-up-'));
  const scriptsDir = path.join(tempRoot, 'scripts', 'local-manual');
  const operationLog = path.join(tempRoot, 'operation.log');

  try {
    mkdirSync(scriptsDir, { recursive: true });
    copyFileSync(path.join(repoRoot, 'scripts/local-manual/internal-up.sh'), path.join(scriptsDir, 'internal-up.sh'));
    writeFileSync(
      path.join(scriptsDir, 'internal-common.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=${shellSingleQuote(tempRoot)}
INTERNAL_SANDBOX_MANAGER_URL_VALUE="http://127.0.0.1:28080"
K8S_NAMESPACE="agentsmith-sandbox"
record() { printf '%s\\n' "$*" >> ${shellSingleQuote(operationLog)}; }
ensure_local_manual_ready() { record ensure_local_manual_ready; }
ensure_internal_runner_state_before_api_restart() { record ensure_internal_runner_state_before_api_restart; }
ensure_kind_cluster() { record ensure_kind_cluster; }
ensure_internal_runner_image() { record ensure_internal_runner_image; }
ensure_afscp_storage_csi() { record ensure_afscp_storage_csi; }
ensure_internal_external_dependency_services() { record ensure_internal_external_dependency_services; }
resolve_afscp_jvs_binary() { record resolve_afscp_jvs_binary; }
ensure_afscp_local_runtime() { record ensure_afscp_local_runtime; }
start_internal_runtime() { record start_internal_runtime; }
restart_api_with_mode() { record "restart_api_with_mode:$1"; }
ensure_internal_runner_state() { record ensure_internal_runner_state; }
ensure_agent_task_diagnostics_ready() { record ensure_agent_task_diagnostics_ready; }
internal_info() { :; }
`,
      'utf8',
    );
    writeFileSync(path.join(scriptsDir, 'internal-down.sh'), '#!/usr/bin/env bash\nexit 0\n', {
      encoding: 'utf8',
      mode: 0o755,
    });

    execFileSync('bash', [path.join(scriptsDir, 'internal-up.sh')], {
      cwd: tempRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return readFileSync(operationLog, 'utf8');
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

  it('starts AFSCP as a local-real dependency before the internal sandbox and AgentSmith API restart', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const up = readFileSync('scripts/local-manual/internal-up.sh', 'utf8');

    expect(common).toContain('AFSCP/JVS is a local development/test dependency, not the business deployment path');
    expect(common).toContain('go run ./cmd/afscp-api --serve');
    expect(common).toContain('go run ./cmd/afscp-worker --run-once');
    expect(common).toContain('go run ./cmd/afscp-export-gateway --serve');
    expect(common).toContain('AFSCP_API_MODE="${AFSCP_API_MODE:-internal}"');
    expect(common).toContain('AFSCP_API_SERVICE_TOKENS=');
    expect(common).toContain('AFSCP_WORKER_OPERATION_RECOVERY_ENABLED="${AFSCP_WORKER_OPERATION_RECOVERY_ENABLED:-true}"');
    expect(common).toContain(
      'AFSCP_EXPORT_SESSION_RECONCILE_ENABLED="${AFSCP_EXPORT_SESSION_RECONCILE_ENABLED:-true}"',
    );
    expect(common).toContain(
      'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN:-${AFSCP_POSTGRES_DSN}}"',
    );
    expect(common).toContain('ensure_afscp_local_runtime_workload_mount_secret_refs');
    expect(common).toContain('ensure_afscp_default_volume');

    const resolverIndex = up.indexOf('resolve_afscp_jvs_binary');
    const afscpIndex = up.indexOf('ensure_afscp_local_runtime');
    expect(resolverIndex).toBeGreaterThanOrEqual(0);
    expect(resolverIndex).toBeLessThan(afscpIndex);
    expect(afscpIndex).toBeGreaterThanOrEqual(0);
    expect(afscpIndex).toBeLessThan(up.indexOf('start_internal_runtime'));
    expect(afscpIndex).toBeLessThan(up.indexOf('restart_api_with_mode 1'));
  });

  it('keeps local-real internal runner launch after the API switches to internal mode', () => {
    const log = runInternalUpWithStubbedCommon();
    const lines = log.trim().split('\n');
    const restartIndex = lines.indexOf('restart_api_with_mode:1');

    expect(lines).toEqual([
      'ensure_local_manual_ready',
      'ensure_internal_runner_state_before_api_restart',
      'ensure_kind_cluster',
      'ensure_internal_runner_image',
      'ensure_afscp_storage_csi',
      'ensure_internal_external_dependency_services',
      'resolve_afscp_jvs_binary',
      'ensure_afscp_local_runtime',
      'start_internal_runtime',
      'restart_api_with_mode:1',
      'ensure_internal_runner_state',
    ]);
    expect(restartIndex).toBeGreaterThanOrEqual(0);
    expect(lines.slice(0, restartIndex)).not.toContain('ensure_internal_runner_state');
    expect(lines.slice(0, restartIndex)).not.toContain('ensure_agent_task_diagnostics_ready');
    expect(lines[restartIndex + 1]).toBe('ensure_internal_runner_state');
  });

  it('splits managed runner state preparation from local runner process launch', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const seedDiagnostics = readFileSync('scripts/local-manual/seed-agent-task-diagnostics.sh', 'utf8');
    const readyBody = functionBody(common, 'ensure_agent_task_diagnostics_ready');
    const beforeRestartBody = functionBody(common, 'ensure_internal_runner_state_before_api_restart');
    const stateReadyBody = functionBody(common, 'ensure_agent_task_diagnostics_state_ready');
    const seedStateBody = functionBody(common, 'seed_managed_agent_task_diagnostics_state');
    const internalRunnerBody = functionBody(common, 'ensure_internal_runner_state');

    expect(readyBody).toContain('ensure_agent_task_diagnostics_state_ready');
    expect(readyBody).toContain('ensure_local_manual_runner_connected');
    expect(beforeRestartBody).toContain('stop_local_manual_runner_for_internal_api_restart');
    expect(beforeRestartBody).toContain('ensure_agent_task_diagnostics_state_ready');
    expect(beforeRestartBody).not.toContain('ensure_local_manual_runner_connected');
    expect(stateReadyBody).toContain('managed_agent_task_runner_state_is_present');
    expect(stateReadyBody).toContain('seed_managed_agent_task_diagnostics_state');
    expect(stateReadyBody).not.toContain('ensure_local_manual_runner_connected');
    expect(seedStateBody).toContain('LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0');
    expect(internalRunnerBody).toContain('managed_agent_task_runner_state_is_present');
    expect(internalRunnerBody).toContain('seed_managed_agent_task_diagnostics_state');
    expect(internalRunnerBody).toContain('ensure_local_manual_runner_connected');
    expect(seedDiagnostics).toContain(
      'LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER="${LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER:-1}"',
    );
    expect(seedDiagnostics).toContain('if [[ "${LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER}" == "1" ]]');
  });

  it('keeps internal-up sandbox restarts from stopping the already-started AFSCP runtime', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const startBody = functionBody(common, 'start_internal_runtime');
    const sandboxStopBody = functionBody(common, 'stop_internal_sandbox_runtime');
    const fullStopBody = functionBody(common, 'stop_internal_runtime');

    expect(startBody).toContain('stop_internal_sandbox_runtime');
    expect(startBody).not.toContain('stop_internal_runtime');
    expect(startBody).not.toContain('stop_afscp_local_runtime');
    expect(startBody).not.toContain('start-cleaner');
    expect(sandboxStopBody).not.toContain('stop-cleaner');
    expect(sandboxStopBody).toContain('stop-manager');
    expect(sandboxStopBody).toContain('app=managed-workload');
    expect(sandboxStopBody).toContain('app=sandbox');
    expect(fullStopBody).toContain('stop_internal_sandbox_runtime');
    expect(fullStopBody).toContain('stop_afscp_local_runtime');
  });

  it('resolves AFSCP JVS from verified release artifacts without defaulting to a sibling mutable build', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');

    expect(common).toContain('resolve_afscp_jvs_binary()');
    expect(common).toContain('prepare_afscp_jvs_release_artifact()');
    expect(common).toContain('AFSCP_JVS_RELEASE_CACHE_DIR="${AFSCP_JVS_RELEASE_CACHE_DIR:-${INTERNAL_REAL_DIR}/jvs-release}"');
    expect(common).toContain('AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH="${AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH:-${AFSCP_JVS_RELEASE_CACHE_DIR}/SHA256SUMS}"');
    expect(common).toContain('AFSCP_JVS_RELEASE_BASE_URL');
    expect(common).toContain('AFSCP_JVS_RELEASE_URL="${AFSCP_JVS_RELEASE_URL:-${AFSCP_JVS_RELEASE_BASE_URL}/${AFSCP_JVS_RELEASE_BINARY_NAME}}"');
    expect(common).toContain('AFSCP_JVS_SHA256SUMS_URL="${AFSCP_JVS_SHA256SUMS_URL:-${AFSCP_JVS_RELEASE_BASE_URL}/SHA256SUMS}"');
    expect(common).toContain('afscp_jvs_sha256_from_sums "${tmp_sums}" "${AFSCP_JVS_RELEASE_BINARY_NAME}"');
    expect(common).toContain('sibling mutable builds are not used by default');
    expect(common).not.toContain('../jvs/bin/jvs-linux-amd64');
    expect(common).not.toContain('AFSCP_JVS_BINARY_PATH="${AFSCP_JVS_BINARY_PATH:-$(realpath');
  });

  it('exposes default JVS release URLs through the local-real internal env', () => {
    const envSource = readFileSync('infra/flows/local-manual-internal.env', 'utf8');

    expect(envSource).toContain('local development/test dependency config');
    expect(envSource).toContain('AFSCP_JVS_RELEASE_URL=https://github.com/agentsmith-project/jvs/releases/download/v0.4.8/jvs-linux-amd64');
    expect(envSource).toContain('AFSCP_JVS_SHA256SUMS_URL=https://github.com/agentsmith-project/jvs/releases/download/v0.4.8/SHA256SUMS');
  });

  it('keeps the AFSCP WebDAV public base URL separate from the gateway route prefix', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const envSource = readFileSync('infra/flows/local-manual-internal.env', 'utf8');

    expect(envSource).toContain('AFSCP_EXPORT_GATEWAY_BASE_URL=http://127.0.0.1:28091\n');
    expect(envSource).not.toContain('AFSCP_EXPORT_GATEWAY_BASE_URL=http://127.0.0.1:28091/e');
    expect(common).toContain('AFSCP_EXPORT_GATEWAY_PREFIX="${AFSCP_EXPORT_GATEWAY_PREFIX:-/e/}"');
    expect(common).toContain('afscp_resolve_webdav_export_public_base_url');

    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      AFSCP_EXPORT_GATEWAY_BASE_URL="http://127.0.0.1:28091/e"
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      printf 'public_base=%s\\n' "$AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL"
      printf 'gateway_prefix=%s\\n' "$AFSCP_EXPORT_GATEWAY_PREFIX"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('public_base=http://127.0.0.1:28091\n');
    expect(result.stdout).toContain('gateway_prefix=/e/\n');
  });

  it('defaults JVS release URLs in internal-common when the env file is not carrying them', () => {
    const result = runInternalCommonSnippet(`
      printf 'release=%s\\n' "$AFSCP_JVS_RELEASE_URL"
      printf 'sums=%s\\n' "$AFSCP_JVS_SHA256SUMS_URL"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('release=https://github.com/agentsmith-project/jvs/releases/download/v0.4.8/jvs-linux-amd64');
    expect(result.stdout).toContain('sums=https://github.com/agentsmith-project/jvs/releases/download/v0.4.8/SHA256SUMS');
  });

  it('writes local-real AFSCP host-side Postgres DSNs with explicit non-SSL defaults', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      ensure_internal_common_runtime_env
      DATABASE_URL="postgresql://\${SUBSTRATE_DB_USER}:\${SUBSTRATE_DB_PASSWORD}@localhost:\${SUBSTRATE_POSTGRES_PORT}/\${SUBSTRATE_DB_NAME}"
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      printf 'expected=%s\\n' "$(afscp_default_local_runtime_postgres_dsn)"
      printf 'AFSCP_DATABASE_URL=%s\\n' "$AFSCP_DATABASE_URL"
      printf 'AFSCP_POSTGRES_DSN=%s\\n' "$AFSCP_POSTGRES_DSN"
      printf 'AFSCP_API_POSTGRES_DSN=%s\\n' "$AFSCP_API_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN=%s\\n' "$AFSCP_EXPORT_GATEWAY_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_ENABLED=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_ENABLED"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_OWNER=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_OWNER"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_LIMIT=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_LIMIT"
    `);
    const values = Object.fromEntries(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split(/=(.*)/su).slice(0, 2) as [string, string]),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(values.expected).toContain('localhost:');
    expect(values.expected).toContain('?sslmode=disable');
    expect(values.AFSCP_DATABASE_URL).toBe(values.expected);
    expect(values.AFSCP_POSTGRES_DSN).toBe(values.expected);
    expect(values.AFSCP_API_POSTGRES_DSN).toBe(values.expected);
    expect(values.AFSCP_EXPORT_GATEWAY_POSTGRES_DSN).toBe(values.expected);
    expect(values.AFSCP_EXPORT_SESSION_RECONCILE_ENABLED).toBe('true');
    expect(values.AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN).toBe(values.expected);
    expect(values.AFSCP_EXPORT_SESSION_RECONCILE_OWNER).toBe('agentsmith-local-real-afscp-worker');
    expect(values.AFSCP_EXPORT_SESSION_RECONCILE_LIMIT).toBe('10');
  });

  it('preserves explicit local-real AFSCP Postgres DSN overrides', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      ensure_internal_common_runtime_env
      DATABASE_URL="postgresql://custom-user:custom-pass@custom-postgres:6432/custom-db?sslmode=require"
      AFSCP_POSTGRES_DSN="postgresql://worker-user:worker-pass@worker-postgres:6432/worker-db?sslmode=require"
      AFSCP_API_POSTGRES_DSN="postgresql://api-user:api-pass@api-postgres:6432/api-db?sslmode=require"
      AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="postgresql://export-user:export-pass@export-postgres:6432/export-db?sslmode=require"
      AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="postgresql://reconcile-user:reconcile-pass@reconcile-postgres:6432/reconcile-db?sslmode=require"
      AFSCP_EXPORT_SESSION_RECONCILE_OWNER="custom-reconcile-worker"
      AFSCP_EXPORT_SESSION_RECONCILE_LIMIT="25"
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      printf 'AFSCP_DATABASE_URL=%s\\n' "$AFSCP_DATABASE_URL"
      printf 'AFSCP_POSTGRES_DSN=%s\\n' "$AFSCP_POSTGRES_DSN"
      printf 'AFSCP_API_POSTGRES_DSN=%s\\n' "$AFSCP_API_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN=%s\\n' "$AFSCP_EXPORT_GATEWAY_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_ENABLED=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_ENABLED"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_OWNER=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_OWNER"
      printf 'AFSCP_EXPORT_SESSION_RECONCILE_LIMIT=%s\\n' "$AFSCP_EXPORT_SESSION_RECONCILE_LIMIT"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'AFSCP_DATABASE_URL=postgresql://custom-user:custom-pass@custom-postgres:6432/custom-db?sslmode=require',
    );
    expect(result.stdout).toContain(
      'AFSCP_POSTGRES_DSN=postgresql://worker-user:worker-pass@worker-postgres:6432/worker-db?sslmode=require',
    );
    expect(result.stdout).toContain(
      'AFSCP_API_POSTGRES_DSN=postgresql://api-user:api-pass@api-postgres:6432/api-db?sslmode=require',
    );
    expect(result.stdout).toContain(
      'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN=postgresql://export-user:export-pass@export-postgres:6432/export-db?sslmode=require',
    );
    expect(result.stdout).toContain('AFSCP_EXPORT_SESSION_RECONCILE_ENABLED=true');
    expect(result.stdout).toContain(
      'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN=postgresql://reconcile-user:reconcile-pass@reconcile-postgres:6432/reconcile-db?sslmode=require',
    );
    expect(result.stdout).toContain('AFSCP_EXPORT_SESSION_RECONCILE_OWNER=custom-reconcile-worker');
    expect(result.stdout).toContain('AFSCP_EXPORT_SESSION_RECONCILE_LIMIT=25');
  });

  it('does not carry an AgentSmith-side accepted JVS release hash pin', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const envSource = readFileSync('infra/flows/local-manual-internal.env', 'utf8');
    const testSource = readFileSync('scripts/local-manual/internal-handoff.test.ts', 'utf8');
    const oldPinVariable = ['AFSCP', 'JVS', 'ACCEPTED', 'RELEASE', 'SHA256'].join('_');
    const oldTestConstant = ['ACCEPTED', 'JVS', 'SHA256'].join('_');
    const oldPinMessage = ['accepted release', 'pin'].join(' ');
    const oldAcceptedHash = [
      'f0',
      '11',
      '699fa92abae59e70153d32f3b9a10de1159fc23a390b22208db23f965521',
    ].join('');

    expect(common).not.toContain(oldPinVariable);
    expect(common).not.toContain(oldPinMessage);
    expect(common).not.toContain(oldAcceptedHash);
    expect(envSource).not.toContain(oldAcceptedHash);
    expect(testSource).not.toContain(oldTestConstant);
  });

  it('parses the JVS hash from SHA256SUMS by release asset name', () => {
    const releaseSha = sha256('release asset');
    const result = runInternalCommonSnippet(`
      sums="\${SNIPPET_TEMP_ROOT}/SHA256SUMS"
      printf '%s  ./nested/jvs-linux-arm64\\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" > "$sums"
      printf '%s  ./jvs-linux-amd64\\n' "${releaseSha}" >> "$sums"
      afscp_jvs_sha256_from_sums "$sums" "jvs-linux-amd64"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(releaseSha);
  });

  it('lets the resolver derive an explicit binary hash from SHA256SUMS before verification', () => {
    const releaseSha = sha256('release asset');
    const result = runInternalCommonSnippet(`
      binary="\${SNIPPET_TEMP_ROOT}/jvs-linux-amd64"
      sums="\${SNIPPET_TEMP_ROOT}/SHA256SUMS"
      printf 'mutable local build\\n' > "$binary"
      printf '%s  jvs-linux-amd64\\n' "${releaseSha}" > "$sums"
      AFSCP_JVS_BINARY_PATH="$binary"
      AFSCP_JVS_SHA256SUMS_PATH="$sums"
      resolve_afscp_jvs_binary
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`expected ${releaseSha}`);
    expect(result.stderr).toContain('JVS binary SHA-256 mismatch');
  });

  it('downloads the configured release artifact and verifies it from SHA256SUMS before caching', () => {
    const releaseContent = 'official release asset';
    const releaseSha = sha256(releaseContent);
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/curl" <<'SH'
#!/usr/bin/env bash
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    --retry|--connect-timeout)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
printf '%s\\n' "$url" >> "$SNIPPET_TEMP_ROOT/curl.log"
case "$url" in
  https://example.test/jvs-linux-amd64)
    printf '%s' ${shellSingleQuote(releaseContent)} > "$out"
    ;;
  https://example.test/SHA256SUMS)
    printf '%s  jvs-linux-amd64\\n' ${shellSingleQuote(releaseSha)} > "$out"
    ;;
  *)
    exit 7
    ;;
esac
SH
      chmod +x "$bin/curl"
      export PATH="$bin:$PATH"
      AFSCP_JVS_RELEASE_CACHE_DIR="\${SNIPPET_TEMP_ROOT}/cache"
      AFSCP_JVS_RELEASE_BINARY_CACHE_PATH="\${AFSCP_JVS_RELEASE_CACHE_DIR}/jvs-linux-amd64"
      AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH="\${AFSCP_JVS_RELEASE_CACHE_DIR}/SHA256SUMS"
      AFSCP_JVS_RELEASE_BINARY_NAME="jvs-linux-amd64"
      AFSCP_JVS_RELEASE_URL="https://example.test/jvs-linux-amd64"
      AFSCP_JVS_SHA256SUMS_URL="https://example.test/SHA256SUMS"
      resolve_afscp_jvs_binary
      printf 'path=%s\\n' "$AFSCP_JVS_BINARY_PATH"
      printf 'sha=%s\\n' "$AFSCP_JVS_BINARY_SHA256"
      cat "\${SNIPPET_TEMP_ROOT}/curl.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`sha=${releaseSha}`);
    expect(result.stdout).toContain('/cache/jvs-linux-amd64');
    expect(result.stdout).toContain('https://example.test/jvs-linux-amd64');
    expect(result.stdout).toContain('https://example.test/SHA256SUMS');
  });

  it('fails closed when an explicit JVS hash does not match the binary content', () => {
    const releaseSha = sha256('release asset');
    const result = runInternalCommonSnippet(`
      binary="\${SNIPPET_TEMP_ROOT}/mutable-jvs"
      printf 'mutable local build\\n' > "$binary"
      AFSCP_JVS_BINARY_PATH="$binary"
      AFSCP_JVS_BINARY_SHA256="${releaseSha}"
      resolve_afscp_jvs_binary
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`expected ${releaseSha}`);
    expect(result.stderr).toContain('JVS binary SHA-256 mismatch');
  });

  it('writes sandbox state with the orchestrator AFSCP caller and canonical token env', () => {
    const result = runInternalCommonSnippet(`
      INTERNAL_SANDBOX_STATE_FILE="\${SNIPPET_TEMP_ROOT}/sandbox-control.env"
      AFSCP_BASE_URL="http://state-afscp.internal"
      AFSCP_CALLER_SERVICE="agentsmith-api"
      AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-manager"
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
      write_internal_state_env
      cat "$INTERNAL_SANDBOX_STATE_FILE"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AFSCP_INTERNAL_BASE_URL="http://state-afscp.internal"');
    expect(result.stdout).toContain('AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"');
    expect(result.stdout).toContain('AFSCP_CALLER_SERVICE="agentsmith-sandbox-manager"');
    expect(result.stdout).not.toContain('AFSCP_CALLER_SERVICE="agentsmith-api"');
  });

  it('creates and validates the default local-real workload mount SecretRef before AFSCP start', () => {
    const requiredKeys = ['name', 'metaurl', 'storage', 'bucket', 'access-key', 'secret-key'];
    const secretData = Object.fromEntries(requiredKeys.map((key) => [key, Buffer.from(`value-${key}`).toString('base64')]));
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/kubectl" <<'SH'
#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/kubectl.log"
case "$1" in
  create)
    printf 'apiVersion: v1\\nkind: Secret\\n'
    ;;
  apply)
    cat >/dev/null
    ;;
  label)
    ;;
  get)
    printf '%s\\n' ${shellSingleQuote(JSON.stringify({ data: secretData }))}
    ;;
  *)
    exit 9
    ;;
esac
SH
      chmod +x "$bin/kubectl"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS="vol_local_manual=agentsmith-sandbox/afscp-local-runtime"
      ensure_afscp_local_runtime_workload_mount_secret_refs
      cat "\${SNIPPET_TEMP_ROOT}/kubectl.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('create secret generic afscp-local-runtime -n agentsmith-sandbox');
    expect(result.stdout).toContain('--from-literal=name=vol-local-manual');
    expect(result.stdout).toContain('--from-literal=metaurl=postgres://');
    expect(result.stdout).toContain('postgres-external.agentsmith-sandbox.svc.cluster.local:5432');
    expect(result.stdout).toContain('postgres-external.agentsmith-sandbox.svc.cluster.local:5432/mbos?sslmode=disable');
    expect(result.stdout).toContain('--from-literal=storage=minio');
    expect(result.stdout).toContain('--from-literal=bucket=http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/mbos-dev');
    expect(result.stdout).toContain('--from-literal=access-key=');
    expect(result.stdout).toContain('--from-literal=secret-key=');
    expect(result.stdout).toContain('apply -f -');
    expect(result.stdout).toContain('get secret afscp-local-runtime -n agentsmith-sandbox -o json');
  });

  it('fails closed when a configured non-default workload mount SecretRef is missing', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/kubectl" <<'SH'
#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/kubectl.log"
case "$1" in
  get)
    exit 1
    ;;
  *)
    exit 9
    ;;
esac
SH
      chmod +x "$bin/kubectl"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS="vol_local_manual=custom-runtime/custom-secret"
      ensure_afscp_local_runtime_workload_mount_secret_refs
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP workload mount SecretRef is not present');
    expect(result.stderr).toContain('local-real fails closed');
  });

  it('reports AFSCP API readiness from local-manual internal status and local-real status', () => {
    const status = readFileSync('scripts/local-manual/internal-status.sh', 'utf8');
    const makefile = readFileSync('Makefile', 'utf8');

    expect(status).toContain('echo "AFSCP API: $(afscp_api_status)"');
    expect(status).not.toContain('cleaner_pid');
    expect(status).not.toContain('cleaner_alive');
    expect(makefile).toMatch(/local-real-status:[\s\S]*\$\(MAKE\) local-manual-status[\s\S]*\$\(MAKE\) local-manual-internal-status/);
  });

  it('keeps local-real internal sandbox handoff manager-only', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');

    expect(common).toContain('bash "${CONTROL_SCRIPT}" start-manager');
    expect(common).toContain('bash "${CONTROL_SCRIPT}" stop-manager');
    expect(common).not.toContain('start-cleaner');
    expect(common).not.toContain('stop-cleaner');
    expect(common).not.toContain('INTERNAL_SANDBOX_CLEANER');
    expect(common).not.toContain('CLEANER_LOG=');
    expect(common).not.toContain('CLEANER_INTERVAL_SECONDS=');
  });
});
