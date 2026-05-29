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

function b64SecretData(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value).toString('base64')]));
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

function runInternalCommonSnippet(
  script: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
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
        env: { ...process.env, ...extraEnv },
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
  const configPath = path.join(internalDir, 'asbcp.yaml');
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
          export INTERNAL_ASBCP_CONFIG="${configPath}"
          export ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:29080"
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
ASBCP_INTERNAL_BASE_URL_VALUE="http://127.0.0.1:28080"
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

type InternalSmokeTaskCreateCall = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
};

function extractInternalSmokeTaskCreateSource(): string {
  const source = readFileSync('scripts/local-manual/internal-smoke.sh', 'utf8');
  const match = source.match(
    /TASK_ID="\$\(\s*\n\s*node - <<'NODE' "\$\{TOKEN\}" "\$\{WORKSPACE_ID\}" "\$\{PROJECT_ID\}" "\$\{PORT_API\}" "\$\{ROOT_DIR\}"\s*\n([\s\S]*?)\nNODE\n\)"/u,
  );
  if (!match?.[1]) {
    throw new Error('internal_smoke_task_create_source_not_found');
  }
  return match[1];
}

function runInternalSmokeTaskCreateSource(fileLibraries: Record<string, unknown>): InternalSmokeTaskCreateCall[] {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-smoke-create-'));
  const callsPath = path.join(tempRoot, 'calls.json');
  const source = extractInternalSmokeTaskCreateSource();
  const harness = [
    "import { writeFileSync } from 'node:fs';",
    'const calls = [];',
    `const fileLibraries = ${JSON.stringify(fileLibraries)};`,
    'function response(status, body) {',
    '  return {',
    '    ok: status >= 200 && status < 300,',
    '    status,',
    '    text: async () => JSON.stringify(body),',
    '  };',
    '}',
    'globalThis.fetch = async (url, init = {}) => {',
    '  const href = String(url);',
    '  const method = typeof init.method === "string" ? init.method : "GET";',
    '  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;',
    '  calls.push({ url: href, method, body });',
    '  if (href.endsWith("/file-libraries")) return response(200, fileLibraries);',
    '  if (href.endsWith("/tasks")) return response(201, { id: "task_internal_smoke" });',
    '  if (href.endsWith("/tasks/task_internal_smoke/runs")) return response(200, { id: "run_internal_smoke" });',
    '  return response(404, { error: `unexpected:${method}:${href}` });',
    '};',
    `process.on('beforeExit', () => writeFileSync(${JSON.stringify(callsPath)}, JSON.stringify(calls, null, 2)));`,
    source,
  ].join('\n');

  try {
    const result = spawnSync(
      process.execPath,
      ['-', 'mock_token', 'ws_default', 'proj_1', '20000', process.cwd()],
      {
        cwd: process.cwd(),
        input: harness,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    if (result.status !== 0) {
      throw new Error(`internal_smoke_task_create_failed:${result.status}:${result.stderr}`);
    }
    return JSON.parse(readFileSync(callsPath, 'utf8')) as InternalSmokeTaskCreateCall[];
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function taskCreatePayloadFromInternalSmoke(fileLibraries: Record<string, unknown>): Record<string, unknown> {
  const calls = runInternalSmokeTaskCreateSource(fileLibraries);
  const taskCreateCall = calls.find((call) => call.method === 'POST' && call.url.endsWith('/tasks'));
  if (!taskCreateCall?.body) {
    throw new Error(`internal_smoke_task_create_call_missing:${JSON.stringify(calls)}`);
  }
  return taskCreateCall.body;
}

describe('local-manual internal handoff', () => {
  it('restores external mode even when the previous API ready marker is gone', () => {
    const result = runExternalModeRestore();

    expect(result.log).toBe('stop_internal_runtime\nrestart_api_with_mode:0\n');
    expect(result.stateExists).toBe('no');
  });

  it('keeps ASBCP AFSCP truth in env instead of generated YAML config', () => {
    const config = renderInternalSandboxConfig();

    expect(config).toContain('httpPort: 29080');
    expect(config).toContain('namespace: agentsmith-sandbox');
    expect(config).toContain('containerName: main');
    expect(config).not.toContain('containerName: runner');
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

  it('imports local-manual kind image tarballs through stdin redirection instead of a pipe', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const body = functionBody(common, 'ensure_kind_image');
    const ensureLocalIndex = body.indexOf('ensure_local_image "${image}"');
    const dockerSaveIndex = body.indexOf('docker save "${image}" -o "${tarball}"');

    expect(ensureLocalIndex).toBeGreaterThanOrEqual(0);
    expect(dockerSaveIndex).toBeGreaterThanOrEqual(0);
    expect(ensureLocalIndex).toBeLessThan(dockerSaveIndex);
    expect(body).not.toMatch(/cat\s+"\$\{tarball\}"\s*\|\s*docker exec -i/u);
    expect(body).toMatch(/docker exec -i "\$\{node_name\}"[\s\S]*< "\$\{tarball\}"/u);
    expect(body).toContain('trap \'rm -f "${tarball}"\' EXIT');
  });

  it('starts AFSCP from the pinned image by default before the internal sandbox and AgentSmith API restart', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const up = readFileSync('scripts/local-manual/internal-up.sh', 'utf8');

    expect(common).toContain('AFSCP/JVS is a local development/test dependency, not the business deployment path');
    expect(common).toContain('AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-image}"');
    expect(common).toContain('AFSCP_LOCAL_RUNTIME_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.7@sha256:876af31e5b8d02d4d795d28bd330c52c4b7580a4e177fa18f446b1ed51b148f2}}"');
    expect(common).toContain('afscp_docker_run --rm /usr/local/bin/afscp-worker --run-once');
    expect(common).toContain('afscp_docker_start "${AFSCP_EXPORT_GATEWAY_CONTAINER_ID_FILE}" "${AFSCP_EXPORT_GATEWAY_CONTAINER_NAME}" /usr/local/bin/afscp-export-gateway --serve');
    expect(common).toContain('afscp_docker_start "${AFSCP_API_CONTAINER_ID_FILE}" "${AFSCP_API_CONTAINER_NAME}" /usr/local/bin/afscp-api --serve');
    expect(common).toContain('afscp_docker_start "${AFSCP_WORKER_CONTAINER_ID_FILE}" "${AFSCP_WORKER_CONTAINER_NAME}" /usr/local/bin/afscp-worker --loop');
    expect(common).toContain('AFSCP_API_MODE="${AFSCP_API_MODE:-internal}"');
    expect(common).toContain('AFSCP_API_SERVICE_TOKENS=');
    expect(common).toContain('AFSCP_WORKER_OPERATION_RECOVERY_ENABLED="${AFSCP_WORKER_OPERATION_RECOVERY_ENABLED:-true}"');
    expect(common).toContain(
      'AFSCP_EXPORT_SESSION_RECONCILE_ENABLED="${AFSCP_EXPORT_SESSION_RECONCILE_ENABLED:-true}"',
    );
    expect(common).toContain(
      'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN:-${AFSCP_POSTGRES_DSN}}"',
    );
    expect(common).toContain('ensure_afscp_local_runtime_volume_root');
    expect(common).toContain('ensure_afscp_local_runtime_workload_mount_secret_refs');
    expect(common).toContain('ensure_afscp_default_volume');

    const ensureRuntimeBody = functionBody(common, 'ensure_afscp_local_runtime');
    expect(ensureRuntimeBody).toContain('ensure_afscp_local_runtime_mounts_and_write_env');
    expect(ensureRuntimeBody.indexOf('start_afscp_api')).toBeLessThan(
      ensureRuntimeBody.indexOf('ensure_afscp_default_volume'),
    );
    expect(ensureRuntimeBody.indexOf('ensure_afscp_default_volume')).toBeLessThan(
      ensureRuntimeBody.indexOf('wait_afscp_api_ready'),
    );

    const resolverIndex = up.indexOf('resolve_afscp_jvs_binary');
    const afscpIndex = up.indexOf('ensure_afscp_local_runtime');
    expect(resolverIndex).toBeGreaterThanOrEqual(0);
    expect(resolverIndex).toBeLessThan(afscpIndex);
    expect(afscpIndex).toBeGreaterThanOrEqual(0);
    expect(afscpIndex).toBeLessThan(up.indexOf('start_internal_runtime'));
    expect(afscpIndex).toBeLessThan(up.indexOf('restart_api_with_mode 1'));
  });

  it('keeps sibling AFSCP source starts behind the explicit owner diagnostic mode', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const sourceRunOnceBody = functionBody(common, 'afscp_run_worker_once_source');
    const sourceApiBody = functionBody(common, 'start_afscp_api_source');
    const sourceGatewayBody = functionBody(common, 'start_afscp_export_gateway_source');
    const sourceWorkerBody = functionBody(common, 'start_afscp_worker_loop_source');

    expect(common).toContain('AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-image}"');
    expect(functionBody(common, 'afscp_local_runtime_uses_source')).toContain('[[ "${AFSCP_LOCAL_RUNTIME_MODE}" == "source" ]]');
    expect(sourceRunOnceBody).toContain('go run ./cmd/afscp-worker --run-once');
    expect(sourceApiBody).toContain('go run ./cmd/afscp-api --serve');
    expect(sourceGatewayBody).toContain('go run ./cmd/afscp-export-gateway --serve');
    expect(sourceWorkerBody).toContain('go run ./cmd/afscp-worker --run-once');
  });

  it('guards every local-real AFSCP process start behind the host JuiceFS mount and workload SecretRef', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const guardBody = functionBody(common, 'ensure_afscp_local_runtime_mounts_and_write_env');
    const exportGatewayBodies = [
      functionBody(common, 'start_afscp_export_gateway_source'),
      functionBody(common, 'start_afscp_export_gateway_image'),
    ];
    const apiBodies = [
      functionBody(common, 'start_afscp_api_source'),
      functionBody(common, 'start_afscp_api_image'),
    ];
    const workerBodies = [
      functionBody(common, 'start_afscp_worker_loop_source'),
      functionBody(common, 'start_afscp_worker_loop_image'),
    ];

    expect(guardBody).toContain('ensure_afscp_local_runtime_volume_root');
    expect(guardBody).toContain('ensure_afscp_local_runtime_workload_mount_secret_refs');
    expect(guardBody).toContain('write_afscp_local_runtime_env');
    expect(guardBody.indexOf('ensure_afscp_local_runtime_volume_root')).toBeLessThan(
      guardBody.indexOf('ensure_afscp_local_runtime_workload_mount_secret_refs'),
    );
    expect(guardBody.indexOf('ensure_afscp_local_runtime_workload_mount_secret_refs')).toBeLessThan(
      guardBody.indexOf('write_afscp_local_runtime_env'),
    );

    for (const body of [...exportGatewayBodies, ...apiBodies, ...workerBodies]) {
      expect(body).toContain('ensure_afscp_local_runtime_mounts_and_write_env');
      expect(body).not.toContain('write_afscp_local_runtime_env');
    }
    for (const body of apiBodies) {
      expect(body).toContain('afscp_wait_for_api_listener');
      expect(body).not.toContain('wait_http "${AFSCP_BASE_URL%/}/readyz"');
    }
  });

  it('keeps local-real internal runner launch after the API switches to internal mode', () => {
    const log = runInternalUpWithStubbedCommon();
    const lines = log.trim().split('\n');
    const restartIndex = lines.indexOf('restart_api_with_mode:1');

    expect(lines).toEqual([
      'ensure_local_manual_ready',
      'ensure_kind_cluster',
      'ensure_internal_runner_image',
      'ensure_internal_runner_state_before_api_restart',
      'ensure_afscp_storage_csi',
      'ensure_internal_external_dependency_services',
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

  it('hands off the local-manual managed runner image as a digest ref to seed and API env', () => {
    const runnerDigest = `sha256:${'a'.repeat(64)}`;
    const result = runInternalCommonSnippet(
      `
      calls_file="$SNIPPET_TEMP_ROOT/calls.log"
      build_runner_image() {
        printf 'build %s %s\\n' "$2" "$3" >> "$calls_file"
      }
      managed_runner_image_handoff_publish_local_runner_image_ref() {
        printf 'publish %s %s %s\\n' "$1" "$2" "$3" >> "$calls_file"
        printf 'kind-registry:5000/mbos/agentsmith-managed-runner@%s\\n' "$RUNNER_DIGEST"
      }
      managed_runner_image_handoff_preflight_kind_registry_runner_image() {
        printf 'preflight %s %s\\n' "$1" "$2" >> "$calls_file"
      }
      ensure_kind_image() {
        printf 'load %s\\n' "$1" >> "$calls_file"
      }
      bash() {
        printf 'bash-env INTERNAL=%s INTEGRATION=%s MANAGED=%s\\n' "\${INTERNAL_AGENT_IMAGE:-}" "\${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" "\${MANAGED_RUNNER_IMAGE:-}" >> "$calls_file"
      }

      RUNNER_IMAGE=agentsmith-managed-runner:local
      RUNNER_BASE_IMAGE=agentsmith-managed-runner-base:local
      ensure_internal_runner_image
      seed_managed_agent_task_diagnostics_state
      printf 'runner=%s\\n' "$RUNNER_IMAGE"
      printf 'env_internal=%s\\n' "\${INTERNAL_AGENT_IMAGE:-}"
      printf 'env_integration=%s\\n' "\${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"
      printf 'env_managed=%s\\n' "\${MANAGED_RUNNER_IMAGE:-}"
      cat "$calls_file"
      `,
      {
        RUNNER_DIGEST: runnerDigest,
      },
    );
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const startApi = readFileSync('scripts/local-manual/start-api.sh', 'utf8');
    const seedStateBody = functionBody(common, 'seed_managed_agent_task_diagnostics_state');
    const restartApiBody = functionBody(common, 'restart_api_with_mode');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('publish agentsmith-managed-runner:local mbos/agentsmith-managed-runner');
    expect(result.stdout).toContain(`preflight kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest} agentsmith-control-plane`);
    expect(result.stdout).toContain(`runner=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(result.stdout).toContain(`env_internal=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(result.stdout).toContain(`env_integration=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(result.stdout).toContain(`env_managed=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(result.stdout).toContain(
      `bash-env INTERNAL=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest} `
      + `INTEGRATION=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest} `
      + `MANAGED=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`,
    );
    expect(result.stdout).not.toContain('agentsmith-agent-task-runner:local');
    expect(seedStateBody).toContain('INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}"');
    expect(seedStateBody).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}"');
    expect(seedStateBody).toContain('MANAGED_RUNNER_IMAGE="${RUNNER_IMAGE}"');
    expect(restartApiBody).toContain('INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}"');
    expect(restartApiBody).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}"');
    expect(restartApiBody).toContain('MANAGED_RUNNER_IMAGE="${RUNNER_IMAGE}"');
    expect(startApi).toContain("INTERNAL_AGENT_IMAGE='${INTERNAL_AGENT_IMAGE:-}'");
    expect(startApi).toContain("INTEGRATION_INTERNAL_AGENT_IMAGE='${INTEGRATION_INTERNAL_AGENT_IMAGE:-}'");
    expect(startApi).toContain("MANAGED_RUNNER_IMAGE='${MANAGED_RUNNER_IMAGE:-}'");
  });

  it('rejects legacy agent-task-runner image refs before local-manual seed or API handoff', () => {
    const legacyRefs = [
      'agentsmith-agent-task-runner:local',
      `kind-registry:5000/mbos/agentsmith-agent-task-runner@sha256:${'b'.repeat(64)}`,
    ];

    for (const legacyRef of legacyRefs) {
      const result = runInternalCommonSnippet(
        `
        calls_file="$SNIPPET_TEMP_ROOT/calls.log"
        build_runner_image() {
          printf 'build %s\\n' "$3" >> "$calls_file"
        }
        managed_runner_image_handoff_publish_local_runner_image_ref() {
          printf 'publish %s\\n' "$1" >> "$calls_file"
          printf 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:%s\\n' "${'c'.repeat(64)}"
        }
        managed_runner_image_handoff_preflight_kind_registry_runner_image() {
          printf 'preflight %s\\n' "$1" >> "$calls_file"
        }
        bash() {
          printf 'seed-or-api %s\\n' "$*" >> "$calls_file"
        }

        RUNNER_IMAGE="$LEGACY_REF"
        ensure_internal_runner_image
        seed_managed_agent_task_diagnostics_state
        restart_api_with_mode 1
        cat "$calls_file"
        `,
        {
          LEGACY_REF: legacyRef,
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('build ');
      expect(result.stdout).not.toContain('publish ');
      expect(result.stdout).not.toContain('preflight ');
      expect(result.stdout).not.toContain('seed-or-api ');
      expect(result.stderr).toContain('must not reference old agent-task-runner image/path');
      expect(result.stderr).toContain(legacyRef);
    }
  });

  it('reseeds managed runner state for the current digest even when stale state is present', () => {
    const result = runInternalCommonSnippet(`
      calls_file="$SNIPPET_TEMP_ROOT/calls.log"
      record() { printf '%s\\n' "$*" >> "$calls_file"; }
      ensure_internal_common_runtime_env() { record ensure_internal_common_runtime_env; }
      stop_local_manual_runner_for_internal_api_restart() { record stop_local_manual_runner_for_internal_api_restart; }
      stop_pid_file_if_running() { record "stop_pid_file_if_running:$2"; }
      resolve_kind_gateway_ip() { record resolve_kind_gateway_ip; printf '172.18.0.1\\n'; }
      bash() { record "bash:$*"; }
      managed_agent_task_runner_state_is_present() { record managed_agent_task_runner_state_is_present; return 0; }
      seed_managed_agent_task_diagnostics_state() {
        record seed_managed_agent_task_diagnostics_state
        LOCAL_MANUAL_INTERNAL_MANAGED_RUNNER_STATE_SEEDED_FOR_IMAGE="$RUNNER_IMAGE"
        export LOCAL_MANUAL_INTERNAL_MANAGED_RUNNER_STATE_SEEDED_FOR_IMAGE
      }

      RUNNER_IMAGE="kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'d'.repeat(64)}"
      LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0
      ensure_internal_runner_state_before_api_restart
      restart_api_with_mode 1
      ensure_internal_runner_state
      cat "$calls_file"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('managed_agent_task_runner_state_is_present');
    expect(result.stdout.match(/seed_managed_agent_task_diagnostics_state/g) ?? []).toHaveLength(1);
    expect(result.stdout).toContain('scripts/local-manual/start-api.sh');
    expect(result.stdout.indexOf('seed_managed_agent_task_diagnostics_state')).toBeLessThan(
      result.stdout.indexOf('stop_local_manual_runner_for_internal_api_restart', result.stdout.indexOf('seed_managed_agent_task_diagnostics_state')),
    );
  });

  it('seeds the current digest before an internal API restart when no pre-restart seed marker exists', () => {
    const result = runInternalCommonSnippet(`
      calls_file="$SNIPPET_TEMP_ROOT/calls.log"
      record() { printf '%s\\n' "$*" >> "$calls_file"; }
      ensure_internal_common_runtime_env() { record ensure_internal_common_runtime_env; }
      stop_pid_file_if_running() { record "stop_pid_file_if_running:$2"; }
      resolve_kind_gateway_ip() { record resolve_kind_gateway_ip; printf '172.18.0.1\\n'; }
      bash() { record "bash:$*"; }
      seed_managed_agent_task_diagnostics_state() {
        record seed_managed_agent_task_diagnostics_state
        LOCAL_MANUAL_INTERNAL_MANAGED_RUNNER_STATE_SEEDED_FOR_IMAGE="$RUNNER_IMAGE"
        export LOCAL_MANUAL_INTERNAL_MANAGED_RUNNER_STATE_SEEDED_FOR_IMAGE
      }

      RUNNER_IMAGE="kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'e'.repeat(64)}"
      restart_api_with_mode 1
      cat "$calls_file"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('seed_managed_agent_task_diagnostics_state');
    expect(result.stdout.indexOf('seed_managed_agent_task_diagnostics_state')).toBeLessThan(
      result.stdout.indexOf('stop_pid_file_if_running:api'),
    );
    expect(result.stdout).toContain('scripts/local-manual/start-api.sh');
  });

  it('runs internal smoke through internal-up before diagnostic state readiness', () => {
    const smoke = readFileSync('scripts/local-manual/internal-smoke.sh', 'utf8');
    const internalUpIndex = smoke.indexOf('bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"');
    const tokenReadIndex = smoke.indexOf('TOKEN="$(cat "$(backend_real_token_file)")"');
    const diagnosticsReadyIndex = smoke.indexOf('ensure_agent_task_diagnostics_ready');

    expect(internalUpIndex).toBeGreaterThanOrEqual(0);
    expect(tokenReadIndex).toBeGreaterThan(internalUpIndex);
    if (diagnosticsReadyIndex >= 0) {
      expect(diagnosticsReadyIndex).toBeGreaterThan(internalUpIndex);
    }
    expect(smoke).not.toContain(
      'ensure_agent_task_diagnostics_ready\nbash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"',
    );
  });

  it('does not reuse ready file libraries that are still bound to active tasks', () => {
    const payload = taskCreatePayloadFromInternalSmoke({
      items: [
        {
          id: 'fl_active',
          status: 'ready',
          task_home_binding_status: 'bound',
          bound_task_visible: true,
          bound_task_status: 'active',
        },
      ],
    });

    expect(payload).toMatchObject({
      workspace_mode: 'create_new',
    });
    expect(payload).not.toHaveProperty('workspace_file_library_id');
  });

  it('reuses only backend-projected unbound file libraries with same-actor reusable affordance', () => {
    const payload = taskCreatePayloadFromInternalSmoke({
      items: [
        { id: 'fl_pending', status: 'pending', task_home_binding_status: 'unbound', bound_task_visible: false },
        { id: 'fl_bound', status: 'ready', task_home_binding_status: 'bound', bound_task_visible: false },
        { id: 'fl_unproven', status: 'ready', task_home_binding_status: 'unbound', bound_task_visible: false },
        {
          id: 'fl_reusable',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
          task_workspace_reuse_affordance: {
            allowed: true,
            same_actor: true,
            runtime_writable_affordance: 'task_internal_home',
          },
        },
      ],
    });

    expect(payload).toMatchObject({
      workspace_mode: 'use_existing',
      workspace_file_library_id: 'fl_reusable',
    });
  });

  it('creates a new internal smoke workspace when file-library list fields are unclear', () => {
    const missingListPayload = taskCreatePayloadFromInternalSmoke({});
    const unclearFieldsPayload = taskCreatePayloadFromInternalSmoke({
      items: [
        { id: 'fl_ready_legacy_shape', status: 'ready' },
        { id: 'fl_ready_missing_visibility', status: 'ready', task_home_binding_status: 'unbound' },
        { id: 'fl_ready_unproven_actor', status: 'ready', task_home_binding_status: 'unbound', bound_task_visible: false },
      ],
    });

    expect(missingListPayload).toMatchObject({
      workspace_mode: 'create_new',
    });
    expect(missingListPayload).not.toHaveProperty('workspace_file_library_id');
    expect(unclearFieldsPayload).toMatchObject({
      workspace_mode: 'create_new',
    });
    expect(unclearFieldsPayload).not.toHaveProperty('workspace_file_library_id');
  });

  it('keeps owner diagnostic task-create payloads fail-closed on reusable file-library selection', () => {
    const internalSmoke = readFileSync('scripts/local-manual/internal-smoke.sh', 'utf8');
    const agentTaskSmoke = readFileSync('scripts/agent-task-smoke-task.sh', 'utf8');

    expect(internalSmoke).toContain('selectReusableTaskWorkspaceFileLibraryId(libraries)');
    expect(internalSmoke).toContain(
      "? { workspace_mode: 'use_existing', workspace_file_library_id: workspaceLibraryId }",
    );
    expect(agentTaskSmoke).toContain('file-library-reuse-selector.mjs');
    expect(agentTaskSmoke).toContain('body.workspace_mode = "use_existing";');
    expect(agentTaskSmoke).toContain('body.workspace_file_library_id = workspaceLibraryId;');
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
    expect(beforeRestartBody).toContain('seed_managed_agent_task_diagnostics_state');
    expect(beforeRestartBody).not.toContain('managed_agent_task_runner_state_is_present');
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
    expect(sandboxStopBody).toContain('stop-asbcp');
    expect(sandboxStopBody).toContain('app=managed-workload');
    expect(sandboxStopBody).toContain('app=sandbox');
    expect(fullStopBody).toContain('stop_internal_sandbox_runtime');
    expect(fullStopBody).toContain('stop_afscp_local_runtime');
  });

  it('resolves AFSCP JVS from the published release artifact by default', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');

    expect(common).toContain('resolve_afscp_jvs_binary()');
    expect(common).toContain('prepare_afscp_jvs_release_artifact()');
    expect(common).toContain('AFSCP_JVS_RELEASE_VERSION="${AFSCP_JVS_RELEASE_VERSION:-v0.4.10}"');
    expect(common).toContain('AFSCP_LOCAL_RUNTIME_IMAGE_JVS_SOURCE_REF="${AFSCP_LOCAL_RUNTIME_IMAGE_JVS_SOURCE_REF:-jvs@v0.4.10:6a0f762bc436f0d3dc7c7c1d60847992c3a82718}"');
    expect(common).toContain('https://github.com/agentsmith-project/jvs/releases/download/${AFSCP_JVS_RELEASE_VERSION}');
    expect(common).toContain('afscp_verify_jvs_direct_contract "${AFSCP_JVS_BINARY_PATH}"');
    expect(common).not.toContain('AFSCP_JVS_RELEASE_VERSION="${AFSCP_JVS_RELEASE_VERSION:-v0.4.9}"');
    expect(common).not.toContain('releases/download/v0.4.9');
    expect(common).not.toContain('jvs@v0.4.10:6a0f7628764ce2430b2b754a7375ca67f637ad08');
  });

  it('keeps the local-real internal env on the published JVS release default', () => {
    const envSource = readFileSync('infra/flows/local-manual-internal.env', 'utf8');

    expect(envSource).toContain('JVS defaults to the verified GitHub release artifact');
    expect(envSource).toContain('AFSCP_JVS_RELEASE_VERSION=${AFSCP_JVS_RELEASE_VERSION:-v0.4.10}');
    expect(envSource).not.toContain('releases/download/v0.4.9');
  });

  it('exposes a focused smoke for the pinned AFSCP image embedded JVS binary', () => {
    const script = readFileSync('scripts/afscp-jvs-image-smoke.sh', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(packageJson.scripts['test:afscp-jvs-image:smoke']).toBe('bash scripts/afscp-jvs-image-smoke.sh');
    expect(script).toContain('ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.7@sha256:876af31e5b8d02d4d795d28bd330c52c4b7580a4e177fa18f446b1ed51b148f2');
    expect(script).toContain('EXPECTED_JVS_SHA256="${EXPECTED_JVS_SHA256:-fa4ada8e3353f85679d13870ea53307caafbd8217b04ba576b185105d9178cef}"');
    expect(script).toContain('EXPECTED_JVS_SOURCE_REF="${EXPECTED_JVS_SOURCE_REF:-jvs@v0.4.10:6a0f762bc436f0d3dc7c7c1d60847992c3a82718}"');
    expect(script).toContain('docker run --rm --network=none --entrypoint /usr/local/bin/jvs');
    expect(script).toContain('afscp --help');
    expect(script).toContain('docker run --rm --network=none --entrypoint /usr/local/bin/juicefs');
    expect(script).toContain('clone --help');
    expect(script).toContain('docker create --network none --entrypoint /usr/local/bin/jvs');
    expect(script).toContain('docker cp "${container_id}:/usr/local/bin/jvs"');
    expect(script).toContain('AFSCP_JUICEFS_OUTPUT_PATH="${AFSCP_JUICEFS_OUTPUT_PATH:-}"');
    expect(script).toContain('docker cp "${container_id}:/usr/local/bin/juicefs" "${AFSCP_JUICEFS_OUTPUT_PATH}"');
    expect(script).toContain('docker cp "${container_id}:/usr/local/juicefs-lib" "${juicefs_lib_output_dir}"');
    expect(script).toContain('LD_LIBRARY_PATH="${juicefs_lib_output_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"');
    expect(script).toContain('chmod 0755 "${AFSCP_JUICEFS_OUTPUT_PATH}"');
    expect(script).toContain('sha256sum "${tmp_dir}/jvs"');
    expect(script).not.toContain('go run');
    expect(script).not.toContain('../jvs');
  });

  it('does not default local-real internal env to a hard-coded JVS binary', () => {
    const envSource = readFileSync('infra/flows/local-manual-internal.env', 'utf8');
    const localManualSample = readFileSync('.env.local-manual.example', 'utf8');

    expect(envSource).toContain('AFSCP_RESTORE_RECOVERY_ENABLED=${AFSCP_RESTORE_RECOVERY_ENABLED:-true}');
    expect(envSource).toContain('Usually do not set AFSCP_JVS_BINARY_PATH/SHA');
    expect(envSource).toContain('must pass `jvs afscp --help`');
    expect(envSource).toContain('historical sibling build output ../jvs/bin/jvs-linux-amd64');
    expect(localManualSample).toContain('usually do not set AFSCP_JVS_BINARY_PATH/SHA');
    expect(localManualSample).toContain('Explicit binary overrides are diagnostics only and must pass `jvs afscp --help`');
    expect(localManualSample).toContain('Do not pin the historical sibling build output ../jvs/bin/jvs-linux-amd64');
    expect(envSource).not.toContain('AFSCP_JVS_BINARY_PATH=${AFSCP_JVS_BINARY_PATH:-');
    expect(envSource).not.toContain('AFSCP_JVS_BINARY_SHA256=${AFSCP_JVS_BINARY_SHA256:-');
    expect(envSource).not.toContain('AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256=${AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256:-');
    expect(envSource).not.toContain('AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF=${AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF:-');
    expect(localManualSample).not.toMatch(/^AFSCP_JVS_BINARY_PATH=/mu);
    expect(localManualSample).not.toMatch(/^AFSCP_JVS_BINARY_SHA256=/mu);
  });

  it('rebuilds an old cached sibling JVS binary when the afscp direct command is missing', () => {
    const result = runInternalCommonSnippet(`
      jvs_root="\${SNIPPET_TEMP_ROOT}/jvs"
      cache_dir="\${SNIPPET_TEMP_ROOT}/cache"
      bin_dir="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$jvs_root/cmd/jvs" "$cache_dir" "$bin_dir"
      printf 'module example.test/jvs\\n\\ngo 1.24\\n' > "$jvs_root/go.mod"
      printf 'package main\\nfunc main() {}\\n' > "$jvs_root/cmd/jvs/main.go"
      git -C "$jvs_root" init -q
      git -C "$jvs_root" add .
      git -C "$jvs_root" -c user.name=AgentSmith -c user.email=agentsmith@example.test commit -qm init
      source_ref="jvs@$(git -C "$jvs_root" rev-parse --short=12 HEAD)"

      cached_binary="$cache_dir/jvs-linux-amd64"
      cat > "$cached_binary" <<'OLDJVS'
#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" ]]; then
  echo 'unknown command "afscp" for "jvs"' >&2
  exit 1
fi
exit 0
OLDJVS
      chmod +x "$cached_binary"
      printf '%s\\n' "$source_ref" > "$cache_dir/jvs-linux-amd64.source-ref"

      cat > "$bin_dir/go" <<'FAKEGO'
#!/usr/bin/env bash
printf 'cwd=%s args=%s\\n' "$PWD" "$*" >> "$SNIPPET_TEMP_ROOT/go.log"
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -z "$out" ]]; then
  exit 2
fi
cat > "$out" <<'NEWJVS'
#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" && "\${2:-}" == "--help" ]]; then
  echo "Internal AFSCP direct contract"
  exit 0
fi
echo "rebuilt jvs $*"
NEWJVS
chmod +x "$out"
FAKEGO
      chmod +x "$bin_dir/go"
      export PATH="$bin_dir:$PATH"

      AFSCP_JVS_ROOT="$jvs_root"
      AFSCP_LOCAL_RUNTIME_MODE=source
      AFSCP_JVS_SIBLING_CACHE_DIR="$cache_dir"
      AFSCP_JVS_SIBLING_BINARY_CACHE_PATH="$cached_binary"
      AFSCP_JVS_SIBLING_SOURCE_REF_PATH="$cache_dir/jvs-linux-amd64.source-ref"
      AFSCP_JVS_RELEASE_URL=
      AFSCP_JVS_SHA256SUMS_URL=
      AFSCP_JVS_SHA256SUMS_PATH=
      resolve_afscp_jvs_binary
      "$AFSCP_JVS_BINARY_PATH" afscp --help
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      printf 'path=%s\\n' "$AFSCP_JVS_BINARY_PATH"
      printf 'sha=%s\\n' "$AFSCP_JVS_BINARY_SHA256"
      printf 'direct_sha=%s\\n' "$AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256"
      printf 'source_ref=%s\\n' "$AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF"
      cat "$SNIPPET_TEMP_ROOT/go.log"
    `);
    const values = Object.fromEntries(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => line.split(/=(.*)/su).slice(0, 2) as [string, string]),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('cached sibling JVS binary is not direct-capable; rebuilding');
    expect(result.stdout).toContain('Internal AFSCP direct contract');
    expect(values.path).toContain('/cache/jvs-linux-amd64');
    expect(values.sha).toMatch(/^[0-9a-f]{64}$/u);
    expect(values.direct_sha).toBe(values.sha);
    expect(values.source_ref).toMatch(/^jvs@[0-9a-f]{12}$/u);
    expect(result.stdout).toContain('/jvs args=build -o ');
    expect(result.stdout).toContain('./cmd/jvs');
  });

  it('fails closed when a sibling JVS rebuild still lacks afscp direct help', () => {
    const result = runInternalCommonSnippet(`
      jvs_root="\${SNIPPET_TEMP_ROOT}/jvs"
      cache_dir="\${SNIPPET_TEMP_ROOT}/cache"
      bin_dir="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$jvs_root/cmd/jvs" "$cache_dir" "$bin_dir"
      printf 'module example.test/jvs\\n\\ngo 1.24\\n' > "$jvs_root/go.mod"
      printf 'package main\\nfunc main() {}\\n' > "$jvs_root/cmd/jvs/main.go"

      cat > "$bin_dir/go" <<'FAKEGO'
#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
cat > "$out" <<'NODIRECT'
#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" ]]; then
  echo 'unknown command "afscp" for "jvs"' >&2
  exit 1
fi
exit 0
NODIRECT
chmod +x "$out"
FAKEGO
      chmod +x "$bin_dir/go"
      export PATH="$bin_dir:$PATH"

      AFSCP_JVS_ROOT="$jvs_root"
      AFSCP_JVS_SIBLING_CACHE_DIR="$cache_dir"
      AFSCP_JVS_SIBLING_BINARY_CACHE_PATH="$cache_dir/jvs-linux-amd64"
      AFSCP_JVS_SIBLING_SOURCE_REF_PATH="$cache_dir/jvs-linux-amd64.source-ref"
      AFSCP_JVS_RELEASE_URL=
      AFSCP_JVS_SHA256SUMS_URL=
      AFSCP_JVS_SHA256SUMS_PATH=
      resolve_afscp_jvs_binary
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not satisfy AFSCP direct contract');
    expect(result.stderr).toContain('jvs afscp --help');
    expect(result.stderr).toContain('local-real fails closed');
  });

  it('explains how to clear a stale explicit sibling JVS binary pin', () => {
    const result = runInternalCommonSnippet(`
      jvs_root="\${SNIPPET_TEMP_ROOT}/jvs"
      mkdir -p "$jvs_root/bin"
      old_binary="$jvs_root/bin/jvs-linux-amd64"
      cat > "$old_binary" <<'OLDJVS'
#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" ]]; then
  echo 'unknown command "afscp" for "jvs"' >&2
  exit 1
fi
exit 0
OLDJVS
      chmod +x "$old_binary"

      AFSCP_JVS_ROOT="$jvs_root"
      AFSCP_JVS_BINARY_PATH="$old_binary"
      AFSCP_JVS_BINARY_SHA256="$(afscp_file_sha256 "$old_binary")"
      resolve_afscp_jvs_binary
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('historical sibling build output');
    expect(result.stderr).toContain(
      'remove AFSCP_JVS_BINARY_PATH/AFSCP_JVS_BINARY_SHA256 from .env.local-manual',
    );
    expect(result.stderr).toContain('artifacts/cache/jvs-sibling');
    expect(result.stderr).toContain("'jvs afscp --help' failed");
  });

  it('writes opt-in direct restore readiness evidence into the AFSCP runtime env', () => {
    const result = runInternalCommonSnippet(`
      direct_binary="\${SNIPPET_TEMP_ROOT}/jvs-direct-restore"
      cat > "$direct_binary" <<'JVS'
#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" && "\${2:-}" == "--help" ]]; then
  echo "Internal AFSCP direct contract"
  exit 0
fi
exit 0
JVS
      chmod +x "$direct_binary"
      AFSCP_LOCAL_RUNTIME_MODE=source
      AFSCP_JVS_BINARY_PATH="$direct_binary"
      AFSCP_JVS_BINARY_SHA256="$(afscp_file_sha256 "$direct_binary")"
      AFSCP_RESTORE_RECOVERY_ENABLED=true
      AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF="jvs@test-direct-restore"
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      for key in \
        AFSCP_RESTORE_RECOVERY_ENABLED \
        AFSCP_JVS_BINARY_PATH \
        AFSCP_JVS_BINARY_SHA256 \
        AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256 \
        AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF; do
        printf '%s=%s\\n' "$key" "\${!key}"
      done
    `);
    const values = Object.fromEntries(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split(/=(.*)/su).slice(0, 2) as [string, string]),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(values.AFSCP_RESTORE_RECOVERY_ENABLED).toBe('true');
    expect(values.AFSCP_JVS_BINARY_PATH).toContain('/jvs-direct-restore');
    expect(values.AFSCP_JVS_BINARY_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(values.AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256).toBe(values.AFSCP_JVS_BINARY_SHA256);
    expect(values.AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF).toBe('jvs@test-direct-restore');
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

  it('defaults JVS to published release cache paths and URLs', () => {
    const result = runInternalCommonSnippet(`
      printf 'internal_real_dir=%s\\n' "$INTERNAL_REAL_DIR"
      printf 'release_version=%s\\n' "$AFSCP_JVS_RELEASE_VERSION"
      printf 'release_cache=%s\\n' "$AFSCP_JVS_RELEASE_CACHE_DIR"
      printf 'release_binary_cache=%s\\n' "$AFSCP_JVS_RELEASE_BINARY_CACHE_PATH"
      printf 'release_sums_cache=%s\\n' "$AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH"
      printf 'release=%s\\n' "$AFSCP_JVS_RELEASE_URL"
      printf 'sums=%s\\n' "$AFSCP_JVS_SHA256SUMS_URL"
    `);

    expect(result.status).toBe(0);
    const releaseCacheDir = `${process.cwd()}/artifacts/cache/jvs-release/v0.4.10`;
    expect(result.stdout).toContain('release_version=v0.4.10\n');
    expect(result.stdout).toContain(`release_cache=${releaseCacheDir}\n`);
    expect(result.stdout).toContain(`release_binary_cache=${releaseCacheDir}/jvs-linux-amd64\n`);
    expect(result.stdout).toContain(`release_sums_cache=${releaseCacheDir}/SHA256SUMS\n`);
    const internalRealDir = result.stdout.match(/^internal_real_dir=(.+)$/m)?.[1] ?? '';
    expect(internalRealDir).toBeTruthy();
    expect(releaseCacheDir.startsWith(internalRealDir)).toBe(false);
    expect(result.stdout).toContain('release=https://github.com/agentsmith-project/jvs/releases/download/v0.4.10/jvs-linux-amd64\n');
    expect(result.stdout).toContain('sums=https://github.com/agentsmith-project/jvs/releases/download/v0.4.10/SHA256SUMS\n');
  });

  it('preserves explicit JVS release cache dir overrides while deriving child cache paths from them', () => {
    const customCacheDir = '/tmp/agentsmith-explicit-jvs-cache';
    const result = runInternalCommonSnippet(
      `
        printf 'cache=%s\\n' "$AFSCP_JVS_RELEASE_CACHE_DIR"
        printf 'binary_cache=%s\\n' "$AFSCP_JVS_RELEASE_BINARY_CACHE_PATH"
        printf 'sums_cache=%s\\n' "$AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH"
      `,
      { AFSCP_JVS_RELEASE_CACHE_DIR: customCacheDir },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`cache=${customCacheDir}\n`);
    expect(result.stdout).toContain(`binary_cache=${customCacheDir}/jvs-linux-amd64\n`);
    expect(result.stdout).toContain(`sums_cache=${customCacheDir}/SHA256SUMS\n`);
    expect(result.stdout).not.toContain(`${customCacheDir}/v0.4.9`);
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

  it('enables the active file-library save point, direct restore, and template product profile in local-real AFSCP by default', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      for key in \
        AFSCP_REPO_TEMPLATE_ENABLED \
        AFSCP_REPO_TEMPLATE_READY \
        AFSCP_SAVE_POINT_RECOVERY_ENABLED \
        AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED \
        AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED \
        AFSCP_RESTORE_RECOVERY_ENABLED; do
        printf '%s=%s\\n' "$key" "\${!key}"
      done
      if grep -Eq 'AFSCP_RESTORE_(PREVIEW|RUN)' "$AFSCP_LOCAL_RUNTIME_ENV_FILE"; then
        printf 'legacy_restore_env_present=yes\\n'
      else
        printf 'legacy_restore_env_present=no\\n'
      fi
    `);
    const values = Object.fromEntries(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split(/=(.*)/su).slice(0, 2) as [string, string]),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(values).toEqual({
      AFSCP_REPO_TEMPLATE_ENABLED: 'true',
      AFSCP_REPO_TEMPLATE_READY: 'true',
      AFSCP_SAVE_POINT_RECOVERY_ENABLED: 'true',
      AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED: 'true',
      AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED: 'true',
      AFSCP_RESTORE_RECOVERY_ENABLED: 'true',
      legacy_restore_env_present: 'no',
    });
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

  it('resets owned local-real AFSCP and JuiceFS metadata truth through a guarded localhost DSN', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/psql" <<'SH'
#!/usr/bin/env bash
printf 'psql_args=%s\\n' "$*" > "$SNIPPET_TEMP_ROOT/psql.log"
cat > "$SNIPPET_TEMP_ROOT/psql.sql"
SH
      cat > "$bin/mongosh" <<'SH'
#!/usr/bin/env bash
printf 'mongosh_args=%s\\n' "$*" > "$SNIPPET_TEMP_ROOT/mongosh.log"
printf 'mongo_db=%s\\n' "$AFSCP_RESET_MONGO_DB_NAME" >> "$SNIPPET_TEMP_ROOT/mongosh.log"
cat > "$SNIPPET_TEMP_ROOT/mongosh.js"
SH
      cat > "$bin/mc" <<'SH'
#!/usr/bin/env bash
printf 'mc_args=%s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/mc.log"
SH
      chmod +x "$bin/psql"
      chmod +x "$bin/mongosh"
      chmod +x "$bin/mc"
      export PATH="$bin:$PATH"
      AFSCP_ENVIRONMENT=local-real
      AFSCP_DEFAULT_VOLUME_ID=vol_internal_20040
      AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://localhost:\${SUBSTRATE_MINIO_API_PORT}/\${MINIO_BUCKET:-mbos-dev}"
      DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:\${SUBSTRATE_POSTGRES_PORT}/mbos?sslmode=disable"
      AFSCP_POSTGRES_DSN="$DATABASE_URL"
      MONGO_URL="mongodb://mbos:mbos_dev_password@localhost:\${SUBSTRATE_MONGO_PORT}/admin"
      MONGO_DB_NAME="\${SUBSTRATE_MONGO_DB}"
      reset_owned_afscp_local_runtime_data
      cat "$SNIPPET_TEMP_ROOT/psql.log"
      cat "$SNIPPET_TEMP_ROOT/psql.sql"
      cat "$SNIPPET_TEMP_ROOT/mongosh.log"
      cat "$SNIPPET_TEMP_ROOT/mongosh.js"
      cat "$SNIPPET_TEMP_ROOT/mc.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('resetting owned AFSCP local-real runtime/test records');
    expect(result.stdout).toContain('psql_args=postgresql://mbos:mbos_dev_password@localhost:15432/mbos?sslmode=disable -v ON_ERROR_STOP=1');
    expect(result.stdout).toContain('TRUNCATE TABLE');
    expect(result.stdout).toContain('DROP TABLE');
    expect(result.stdout).toContain("table_name LIKE 'jfs\\_%'");
    const clearedRuntimeTables = [
      'operations',
      'repo_fences',
      'audit_outbox',
      'repos',
      'export_sessions',
      'export_runtime_requests',
      'workload_mount_bindings',
      'restore_reconciliation_runs',
      'restore_reconciliation_targets',
      'restore_reconciliation_observations',
      'volumes',
      'namespaces',
      'namespace_volume_bindings',
    ];
    const removedLegacyRestoreTable = `restore_${'plans'}`;
    for (const tableName of clearedRuntimeTables) {
      expect(result.stdout).toContain(`'${tableName}'`);
    }
    expect(clearedRuntimeTables).toContain('operations');
    expect(result.stdout).not.toContain(`'${removedLegacyRestoreTable}'`);
    expect(result.stdout).toContain('operator_intervention_required');
    expect(result.stdout).not.toContain('operation_state');
    expect(result.stdout).toContain('resetting AgentSmith-owned AFSCP metadata in Mongo');
    expect(result.stdout).toContain('mongosh_args=mongodb://mbos:mbos_dev_password@localhost:17017/admin --quiet --eval ');
    expect(result.stdout).toContain('mongo_db=mbos');
    expect(result.stdout).toContain('project_afscp_namespace_mappings');
    expect(result.stdout).toContain('project_file_library_afscp_mappings');
    expect(result.stdout).toContain('resetting AFSCP local-real JuiceFS object prefix mbos-dev/vol-internal-20040/');
    expect(result.stdout).not.toContain('resetting AFSCP local-real JuiceFS object prefix mbos-dev/mbos-dev/vol-internal-20040/');
    expect(result.stdout).toContain('mc_args=alias set agentsmith-afscp-local-reset-');
    expect(result.stdout).toContain(' http://localhost:19000 mbos mbos_dev_password');
    expect(result.stdout).toContain('mc_args=rm --recursive --force agentsmith-afscp-local-reset-');
    expect(result.stdout).toContain('/mbos-dev/vol-internal-20040/');
    expect(result.stdout).not.toContain('/mbos-dev/mbos-dev/vol-internal-20040/');
    expect(result.stdout).not.toContain('mc_args=rm --recursive --force agentsmith-afscp-local-reset-/mbos-dev\n');
  });

  it('appends the current JuiceFS volume under an explicit MinIO object root prefix', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/mc" <<'SH'
#!/usr/bin/env bash
printf 'mc_args=%s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/mc.log"
SH
      chmod +x "$bin/mc"
      export PATH="$bin:$PATH"
      AFSCP_ENVIRONMENT=local-real
      AFSCP_DEFAULT_VOLUME_ID=vol_internal_20040
      AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://localhost:\${SUBSTRATE_MINIO_API_PORT}/\${MINIO_BUCKET:-mbos-dev}/custom-root"
      reset_owned_afscp_local_runtime_object_prefix
      cat "$SNIPPET_TEMP_ROOT/mc.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('resetting AFSCP local-real JuiceFS object prefix mbos-dev/custom-root/vol-internal-20040/');
    expect(result.stdout).toContain('/mbos-dev/custom-root/vol-internal-20040/');
    expect(result.stdout).not.toContain('/mbos-dev/mbos-dev/vol-internal-20040/');
  });

  it('fails closed before resetting a JuiceFS object prefix outside local-real localhost MinIO volume truth', () => {
    const scenarios = [
      {
        setup: `
          AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://localhost:\${SUBSTRATE_MINIO_API_PORT}/\${MINIO_BUCKET:-mbos-dev}/\${MINIO_BUCKET:-mbos-dev}/vol-local-manual/"
        `,
        message: 'AFSCP_ENVIRONMENT=local-real',
      },
      {
        setup: `
          AFSCP_ENVIRONMENT=local-real
          AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://minio.example.test:\${SUBSTRATE_MINIO_API_PORT}/\${MINIO_BUCKET:-mbos-dev}/\${MINIO_BUCKET:-mbos-dev}/vol-local-manual/"
        `,
        message: 'host minio.example.test must point at localhost or 127.0.0.1',
      },
      {
        setup: `
          AFSCP_ENVIRONMENT=local-real
          AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://localhost:\${SUBSTRATE_MINIO_API_PORT}/foreign-bucket/\${MINIO_BUCKET:-mbos-dev}/vol-local-manual/"
        `,
        message: 'bucket foreign-bucket must match local MinIO bucket mbos-dev',
      },
      {
        setup: `
          AFSCP_ENVIRONMENT=local-real
          AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET="http://localhost:\${SUBSTRATE_MINIO_API_PORT}/\${MINIO_BUCKET:-mbos-dev}/\${MINIO_BUCKET:-mbos-dev}/vol-other/"
        `,
        message: 'object prefix mbos-dev/vol-other/ must end with current volume vol_local_manual',
      },
    ];

    for (const scenario of scenarios) {
      const result = runInternalCommonSnippet(`
        bin="\${SNIPPET_TEMP_ROOT}/bin"
        mkdir -p "$bin"
        cat > "$bin/mc" <<'SH'
#!/usr/bin/env bash
printf 'MC_SHOULD_NOT_RUN\\n'
SH
        chmod +x "$bin/mc"
        export PATH="$bin:$PATH"
        AFSCP_DEFAULT_VOLUME_ID=vol_local_manual
        ${scenario.setup}
        reset_owned_afscp_local_runtime_object_prefix
      `);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('refusing to reset AFSCP local-real JuiceFS object prefix');
      expect(result.stderr).toContain(scenario.message);
      expect(result.stdout).not.toContain('MC_SHOULD_NOT_RUN');
    }
  });

  it('clears AgentSmith-owned AFSCP metadata when resetting local-real AFSCP runtime', () => {
    const result = runInternalCommonSnippet(`
      bin_dir="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin_dir"
      cat > "$bin_dir/mongosh" <<'FAKEMONGO'
#!/usr/bin/env bash
printf 'args=%s\\n' "$*" > "$SNIPPET_TEMP_ROOT/mongosh.args"
printf 'target_db=%s\\n' "$AFSCP_RESET_MONGO_DB_NAME" > "$SNIPPET_TEMP_ROOT/mongosh.env"
cat > "$SNIPPET_TEMP_ROOT/mongosh.js"
FAKEMONGO
      chmod +x "$bin_dir/mongosh"
      export PATH="$bin_dir:$PATH"

      AFSCP_ENVIRONMENT=local-real
      MONGO_URL="mongodb://mbos:mbos_dev_password@localhost:\${SUBSTRATE_MONGO_PORT}/admin"
      MONGO_DB_NAME="\${SUBSTRATE_MONGO_DB}"
      reset_owned_agentsmith_afscp_metadata

      cat "$SNIPPET_TEMP_ROOT/mongosh.args"
      cat "$SNIPPET_TEMP_ROOT/mongosh.env"
      cat "$SNIPPET_TEMP_ROOT/mongosh.js"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('resetting AgentSmith-owned AFSCP metadata in Mongo');
    expect(result.stdout).toContain('args=mongodb://mbos:mbos_dev_password@localhost:17017/admin --quiet --eval ');
    expect(result.stdout).toContain('target_db=mbos');
    for (const collection of [
      'project_afscp_namespace_mappings',
      'project_afscp_resource_ownership_mappings',
      'project_file_library_afscp_mappings',
      'agent_task_file_library_bindings',
      'agent_task_workspace_holders',
      'project_file_library_save_point_mappings',
      'project_file_library_restore_operations',
      'project_file_library_restore_operation_active_locks',
      'project_task_file_templates',
    ]) {
      expect(result.stdout).toContain(collection);
    }
    expect(result.stdout).toContain('internal_agent_file_library_workspaces');
    for (const preservedCollection of [
      'project_file_libraries',
      'provider_connections',
      'project_model_entries',
      'model_catalog_versions',
      'workspaces',
      'user_external_connections',
    ]) {
      expect(result.stdout).not.toContain(`'${preservedCollection}'`);
      expect(result.stdout).not.toContain(`"${preservedCollection}"`);
    }

    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const reset = readFileSync('scripts/local-manual/internal-reset.sh', 'utf8');
    const agentTaskGate = readFileSync('scripts/run-internal-agent-task-real-gate.sh', 'utf8');
    expect(common).toContain('reset_owned_agentsmith_afscp_metadata');
    expect(common).toContain('reset_owned_afscp_local_runtime_k8s_state');
    expect(common).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(reset).toContain('AFSCP_ENVIRONMENT=local-real reset_owned_afscp_local_runtime_for_gate');
    expect(agentTaskGate).toContain('reset_owned_afscp_local_runtime_for_gate');
  });

  it('clears owned Kubernetes workload state before gate-owned AFSCP metadata reset', () => {
    const common = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const reset = readFileSync('scripts/local-manual/internal-reset.sh', 'utf8');
    const agentTaskGate = readFileSync('scripts/run-internal-agent-task-real-gate.sh', 'utf8');
    const fileLibraryGate = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const wrapperBody = functionBody(common, 'reset_owned_afscp_local_runtime_for_gate');

    expect(common).toContain('kubectl delete namespace "${K8S_NAMESPACE}" --ignore-not-found --wait=true --timeout=120s');
    expect(wrapperBody.indexOf('reset_owned_afscp_local_runtime_k8s_state')).toBeGreaterThanOrEqual(0);
    expect(wrapperBody.indexOf('reset_owned_afscp_local_runtime_data')).toBeGreaterThan(
      wrapperBody.indexOf('reset_owned_afscp_local_runtime_k8s_state'),
    );
    expect(reset).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(agentTaskGate).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(fileLibraryGate).toContain('reset_owned_afscp_local_runtime_for_gate');
  });

  it('fails closed before clearing AgentSmith AFSCP metadata on a non-local Mongo URL', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_ENVIRONMENT=local-real
      MONGO_URL="mongodb://mongo.example.test:27017/admin"
      MONGO_DB_NAME="\${SUBSTRATE_MONGO_DB}"
      reset_owned_agentsmith_afscp_metadata
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to reset AgentSmith-owned AFSCP metadata');
    expect(result.stderr).toContain('Mongo URL host mongo.example.test must point at localhost or 127.0.0.1');

    const fullResetResult = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/psql" <<'SH'
#!/usr/bin/env bash
cat > "$SNIPPET_TEMP_ROOT/psql.sql"
SH
      cat > "$bin/mongosh" <<'SH'
#!/usr/bin/env bash
printf 'MONGOSH_SHOULD_NOT_RUN\\n'
SH
      chmod +x "$bin/psql" "$bin/mongosh"
      export PATH="$bin:$PATH"
      AFSCP_ENVIRONMENT=local-real
      AFSCP_POSTGRES_DSN="postgresql://mbos:mbos_dev_password@localhost:\${SUBSTRATE_POSTGRES_PORT}/mbos?sslmode=disable"
      MONGO_URL="mongodb://mongo.example.test:27017/admin"
      MONGO_DB_NAME="\${SUBSTRATE_MONGO_DB}"
      reset_owned_afscp_local_runtime_data
    `);

    expect(fullResetResult.status).not.toBe(0);
    expect(fullResetResult.stderr).toContain('refusing to reset AgentSmith-owned AFSCP metadata');
    expect(fullResetResult.stderr).toContain('Mongo URL host mongo.example.test must point at localhost or 127.0.0.1');
    expect(fullResetResult.stdout).not.toContain('MONGOSH_SHOULD_NOT_RUN');
  });

  it('fails closed before AFSCP data reset for unsafe DSNs or missing local-real marker', () => {
    const scenarios = [
      {
        dsn: 'postgresql://mbos:mbos_dev_password@postgres.internal:15432/mbos?sslmode=disable',
        localRealMarker: true,
        message: 'must point at localhost or 127.0.0.1',
      },
      {
        dsn: 'postgresql://prod_user:prod_password@localhost:15432/prod_db?sslmode=disable',
        localRealMarker: true,
        message: 'must use local test database user/database',
      },
      {
        dsn: 'postgresql://mbos:mbos_dev_password@localhost:15432/mbos?sslmode=disable',
        localRealMarker: false,
        message: 'AFSCP_ENVIRONMENT=local-real',
      },
    ];

    for (const scenario of scenarios) {
      const result = runInternalCommonSnippet(`
        bin="\${SNIPPET_TEMP_ROOT}/bin"
        mkdir -p "$bin"
        cat > "$bin/psql" <<'SH'
#!/usr/bin/env bash
printf 'PSQL_SHOULD_NOT_RUN\\n'
SH
        chmod +x "$bin/psql"
        export PATH="$bin:$PATH"
        ${scenario.localRealMarker ? 'AFSCP_ENVIRONMENT=local-real' : ''}
        AFSCP_POSTGRES_DSN=${shellSingleQuote(scenario.dsn)}
        reset_owned_afscp_local_runtime_data
      `);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('refusing to reset AFSCP local-real runtime/test records');
      expect(result.stderr).toContain(scenario.message);
      expect(result.stdout).not.toContain('PSQL_SHOULD_NOT_RUN');
    }
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
    const releaseContent = `#!/usr/bin/env bash
if [[ "\${1:-}" == "afscp" && "\${2:-}" == "--help" ]]; then
  echo "Internal AFSCP direct contract"
  exit 0
fi
echo "release jvs $*"
`;
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

  it('writes sandbox state with the orchestrator AFSCP caller and token fingerprints only', () => {
    const result = runInternalCommonSnippet(`
      INTERNAL_SANDBOX_STATE_FILE="\${SNIPPET_TEMP_ROOT}/sandbox-control.env"
      AFSCP_BASE_URL="http://state-afscp.internal"
      AFSCP_CALLER_SERVICE="agentsmith-api"
      AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-control-plane"
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
      ASBCP_SERVICE_KEY_VALUE="state-asbcp-service-key"
      unset KUBECONFIG
      HOME="\${SNIPPET_TEMP_ROOT}/home"
      write_internal_state_env
      cat "$INTERNAL_SANDBOX_STATE_FILE"
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AFSCP_INTERNAL_BASE_URL="http://state-afscp.internal"');
    expect(result.stdout).toContain('AFSCP_CALLER_SERVICE="agentsmith-sandbox-control-plane"');
    expect(result.stdout).toMatch(/KUBECONFIG=".*\/home\/agentsmith\/local-kind\/kind-agentsmith\.kubeconfig"/u);
    expect(result.stdout).toContain('ASBCP_SERVICE_KEY_FINGERPRINT="sha256:');
    expect(result.stdout).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="sha256:');
    expect(result.stdout).not.toContain('ASBCP_SERVICE_KEY_VALUE=');
    expect(result.stdout).not.toContain('state-asbcp-service-key');
    expect(result.stdout).not.toContain('AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"');
    expect(result.stdout).not.toContain('AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"');
    expect(result.stdout).not.toContain('state-orchestrator-token');
    expect(result.stdout).not.toContain('AFSCP_CALLER_SERVICE="agentsmith-api"');
  });

  it('creates and validates the default local-real workload mount SecretRef before AFSCP start', () => {
    const secretData = b64SecretData({
      name: 'vol-local-manual',
      metaurl: 'postgres://mbos:mbos_dev_password@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/mbos?sslmode=disable',
      storage: 'minio',
      bucket: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/mbos-dev',
      'access-key': 'mbos',
      'secret-key': 'mbos_dev_password',
    });
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
    expect(result.stdout).toContain('apply --validate=false -f -');
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

  it('binds the AFSCP image runtime parent dir instead of the JuiceFS mountpoint itself', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      runtime_root="\${SNIPPET_TEMP_ROOT}/runtime"
      mkdir -p "$bin" "$runtime_root/afscp-volume-root" "$runtime_root/afscp-jvs-cwd"
      cat > "$bin/docker" <<'SH'
#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/docker.log"
exit 0
SH
      chmod +x "$bin/docker"
      export PATH="$bin:$PATH"
      INTERNAL_REAL_DIR="$runtime_root"
      AFSCP_VOLUME_ROOT="$runtime_root/afscp-volume-root"
      AFSCP_JVS_CWD="$runtime_root/afscp-jvs-cwd"
      AFSCP_LOCAL_RUNTIME_DOCKER_ENV_FILE="$runtime_root/afscp.env"
      AFSCP_LOCAL_RUNTIME_IMAGE="example/afscp:test"
      printf 'AFSCP_ENVIRONMENT=local-real\\n' > "$AFSCP_LOCAL_RUNTIME_DOCKER_ENV_FILE"
      afscp_docker_run --rm /usr/local/bin/afscp-migrate --apply
      cat "\${SNIPPET_TEMP_ROOT}/docker.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('--volume ');
    expect(result.stdout).toContain('/runtime:/');
    expect(result.stdout).not.toContain('/afscp-volume-root:/');
    expect(result.stdout).not.toContain('/afscp-jvs-cwd:/');
  });

  it('fails closed when workload mount SecretRefs point at a non-default local-real volume', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      AFSCP_DEFAULT_VOLUME_ID=vol_local_manual
      AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS="vol_internal_20040=agentsmith-sandbox/afscp-local-runtime"
      write_afscp_local_runtime_env
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS must use default volume vol_local_manual only');
    expect(result.stderr).toContain('local-real fails closed');
  });

  it('fails closed when a workload mount SecretRef points at a different JuiceFS volume identity', () => {
    const secretData = b64SecretData({
      name: 'different-volume',
      metaurl: 'postgres://mbos:mbos_dev_password@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/different?sslmode=disable',
      storage: 'minio',
      bucket: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/different-bucket',
      'access-key': 'mbos',
      'secret-key': 'mbos_dev_password',
    });
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mkdir -p "$bin"
      cat > "$bin/kubectl" <<'SH'
#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/kubectl.log"
case "$1" in
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
      AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS="vol_local_manual=custom-runtime/custom-secret"
      ensure_afscp_local_runtime_workload_mount_secret_refs
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP workload mount SecretRef does not match AFSCP local-real JuiceFS identity');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stderr).not.toContain('mbos_dev_password');
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

  it('mounts the AFSCP local-real volume root with the same JuiceFS volume before starting AFSCP', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    exit 0
    ;;
  mount)
    mountpoint="\${@: -1}"
    mkdir -p "$mountpoint"
    printf 'mounted\\n' > "$mountpoint/.juicefs-mounted"
    ;;
esac
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
      cat > "$bin/findmnt" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-no" && "$2" == "FSTYPE" ]]; then
  printf 'fuse.juicefs\\n'
  exit 0
fi
exit 0
SH
      chmod +x "$bin/juicefs" "$bin/mountpoint" "$bin/findmnt"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      ensure_afscp_local_runtime_volume_root
      write_afscp_local_runtime_env
      set -a
      source "$AFSCP_LOCAL_RUNTIME_ENV_FILE"
      set +a
      printf 'AFSCP_VOLUME_ROOTS=%s\\n' "$AFSCP_VOLUME_ROOTS"
      cat "\${SNIPPET_TEMP_ROOT}/juicefs.log"
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('AFSCP_VOLUME_ROOTS=vol_local_manual=');
    expect(result.stdout).toContain('/afscp-volume-root');
    expect(result.stdout).toContain('juicefs format --no-update --storage minio --bucket http://localhost:19000/mbos-dev');
    expect(result.stdout).toContain('postgres://mbos:mbos_dev_password@localhost:15432/mbos?sslmode=disable vol-local-manual');
    expect(result.stdout).toContain('juicefs mount -d');
    expect(result.stdout).toContain(
      'juicefs mount -d --attr-cache 0s --entry-cache 0s --dir-entry-cache 0s --negative-entry-cache 0s --no-usage-report',
    );
    expect(result.stdout).toContain('--storage minio --bucket http://localhost:19000/mbos-dev');
    expect(result.stdout).toContain('postgres://mbos:mbos_dev_password@localhost:15432/mbos?sslmode=disable');
  });

  it('fails closed before mounting when existing JuiceFS metadata has a stale name or object endpoint', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  format)
    exit 0
    ;;
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    ;;
  mount)
    printf 'SHOULD_NOT_MOUNT\\n' >> "$SNIPPET_TEMP_ROOT/juicefs.log"
    exit 0
    ;;
esac
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
exit 1
SH
      chmod +x "$bin/juicefs" "$bin/mountpoint"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_DEFAULT_VOLUME_ID=vol_internal_20040
      AFSCP_VOLUME_ROOT="$mount_root"
      SUBSTRATE_MINIO_API_PORT=29000
      ensure_afscp_local_runtime_volume_root
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP local-real JuiceFS metadata does not match expected identity');
    expect(result.stderr).toContain('name,bucket');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stderr).not.toContain('mbos_dev_password');
    expect(result.stdout).not.toContain('SHOULD_NOT_MOUNT');
  });

  it.each(['AFSCP_VOLUME_ROOTS', 'AFSCP_API_VOLUME_ROOTS', 'AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS'])(
    'fails closed when %s points the default volume at a non-mounted host path',
    (volumeRootMapEnv) => {
      const result = runInternalCommonSnippet(`
        bin="\${SNIPPET_TEMP_ROOT}/bin"
        mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
        stale_root="\${SNIPPET_TEMP_ROOT}/stale-afscp-volume-root"
        mkdir -p "$bin" "$mount_root" "$stale_root"
        cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
if [[ "$1" == "mount" ]]; then
  mountpoint="\${@: -1}"
  mkdir -p "$mountpoint"
  printf 'mounted\\n' > "$mountpoint/.juicefs-mounted"
fi
exit 0
SH
        cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
        cat > "$bin/findmnt" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-no" && "$2" == "FSTYPE" ]]; then
  printf 'fuse.juicefs\\n'
  exit 0
fi
exit 0
SH
        chmod +x "$bin/juicefs" "$bin/mountpoint" "$bin/findmnt"
        export PATH="$bin:$PATH"
        AFSCP_JVS_ENABLED=false
        AFSCP_VOLUME_ROOT="$mount_root"
        export ${volumeRootMapEnv}="vol_local_manual=$stale_root"
        ensure_afscp_local_runtime_volume_root
      `);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${volumeRootMapEnv} default volume vol_local_manual resolves to`);
      expect(result.stderr).toContain('expected AFSCP_VOLUME_ROOT');
      expect(result.stderr).toContain('local-real fails closed');
    },
  );

  it('fails closed when the AFSCP local-real JuiceFS mount helper is missing', () => {
    const result = runInternalCommonSnippet(`
      AFSCP_JVS_ENABLED=false
      PATH="/usr/bin:/bin"
      ensure_afscp_local_runtime_volume_root
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('juicefs is required to mount AFSCP_VOLUME_ROOT');
    expect(result.stderr).toContain('local-real fails closed');
  });

  it('fails closed when mounting the AFSCP local-real JuiceFS volume root fails', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  format)
    exit 0
    ;;
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    exit 0
    ;;
  mount)
    exit 42
    ;;
esac
exit 9
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
exit 1
SH
      chmod +x "$bin/juicefs" "$bin/mountpoint"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      ensure_afscp_local_runtime_volume_root
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('failed to mount AFSCP_VOLUME_ROOT with JuiceFS');
    expect(result.stderr).toContain('local-real fails closed');
  });

  it('cleans up a local-created AFSCP JuiceFS mount when post-mount validation fails', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    ;;
  mount)
    mountpoint="\${@: -1}"
    mkdir -p "$mountpoint"
    printf 'mounted\\n' > "$mountpoint/.juicefs-mounted"
    ;;
  umount)
    rm -f "$2/.juicefs-mounted"
    ;;
esac
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
      cat > "$bin/findmnt" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-no" && "$2" == "FSTYPE" ]]; then
  printf 'ext4\\n'
  exit 0
fi
exit 0
SH
      chmod +x "$bin/juicefs" "$bin/mountpoint" "$bin/findmnt"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      set +e
      ensure_afscp_local_runtime_volume_root
      ensure_status=$?
      set -e
      printf 'ensure_status=%s\\n' "$ensure_status"
      if afscp_is_mountpoint "$mount_root"; then
        printf 'still_mountpoint=yes\\n'
      else
        printf 'still_mountpoint=no\\n'
      fi
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
      cat "\${SNIPPET_TEMP_ROOT}/juicefs.log"
      exit "$ensure_status"
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP_VOLUME_ROOT is mounted as ext4, expected JuiceFS');
    expect(result.stdout).toContain('juicefs mount');
    expect(result.stdout).toContain('juicefs umount');
    expect(result.stdout).toContain('still_mountpoint=no');
    expect(result.stdout).toContain('marker=absent');
  });

  it('fails closed before mounting when AFSCP_VOLUME_ROOT mountpoint state is indeterminate', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      for tool in mkdir realpath sed tr head rm dirname cat; do
        ln -s "$(command -v "$tool")" "$bin/$tool"
      done
      cat > "$bin/mountpoint" <<'SH'
#!/bin/bash
printf 'mountpoint %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/mountpoint.log"
exit 2
SH
      cat > "$bin/seq" <<'SH'
#!/bin/bash
printf '1\\n'
SH
      cat > "$bin/sleep" <<'SH'
#!/bin/bash
exit 0
SH
      cat > "$bin/juicefs" <<'SH'
#!/bin/bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
exit 0
SH
      chmod +x "$bin/mountpoint" "$bin/seq" "$bin/sleep" "$bin/juicefs"
      export PATH="$bin"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      set +e
      ensure_afscp_local_runtime_volume_root
      ensure_status=$?
      set -e
      printf 'ensure_status=%s\\n' "$ensure_status"
      if [[ -f "$SNIPPET_TEMP_ROOT/juicefs.log" ]]; then
        cat "$SNIPPET_TEMP_ROOT/juicefs.log"
      fi
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
      exit "$ensure_status"
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unable to determine AFSCP_VOLUME_ROOT mountpoint state');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stdout).toContain('marker=absent');
    expect(result.stdout).not.toContain('juicefs ');
  });

  it('does not unmount an externally mounted AFSCP_VOLUME_ROOT when no local-real marker exists', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      printf 'external\\n' > "$mount_root/.external-mounted"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      cat > "$bin/umount" <<'SH'
#!/usr/bin/env bash
printf 'umount %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.external-mounted" ]]
SH
      chmod +x "$bin/juicefs" "$bin/umount" "$bin/mountpoint"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      rm -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER"
      stop_afscp_local_runtime
      if [[ -f "$SNIPPET_TEMP_ROOT/unmount.log" ]]; then
        cat "$SNIPPET_TEMP_ROOT/unmount.log"
      fi
      if [[ -f "$mount_root/.external-mounted" ]]; then
        printf 'external_mount=present\\n'
      else
        printf 'external_mount=absent\\n'
      fi
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('external_mount=present');
    expect(result.stdout).toContain('marker=absent');
    expect(result.stdout).not.toContain('juicefs umount');
    expect(result.stdout).not.toContain('umount ');
  });

  it('fails closed and keeps the marker when local-real cannot determine mountpoint state during stop', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root" "$(dirname "$AFSCP_VOLUME_ROOT_MOUNT_MARKER")"
      printf '%s\\n' "$mount_root" > "$AFSCP_VOLUME_ROOT_MOUNT_MARKER"
      for tool in head realpath sed rm dirname; do
        ln -s "$(command -v "$tool")" "$bin/$tool"
      done
      cat > "$bin/juicefs" <<'SH'
#!/bin/bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      cat > "$bin/umount" <<'SH'
#!/bin/bash
printf 'umount %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      chmod +x "$bin/juicefs" "$bin/umount"
      export PATH="$bin"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      set +e
      stop_afscp_local_runtime
      stop_status=$?
      set -e
      printf 'stop_status=%s\\n' "$stop_status"
      if [[ -f "$SNIPPET_TEMP_ROOT/unmount.log" ]]; then
        cat "$SNIPPET_TEMP_ROOT/unmount.log"
      fi
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
      exit "$stop_status"
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('mountpoint or findmnt is required to validate AFSCP_VOLUME_ROOT');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stdout).toContain('marker=present');
    expect(result.stdout).not.toContain('juicefs umount');
    expect(result.stdout).not.toContain('umount ');
  });

  it('unmounts the local-real AFSCP JuiceFS volume root on internal runtime stop', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    ;;
  mount)
    mountpoint="\${@: -1}"
    mkdir -p "$mountpoint"
    printf 'mounted\\n' > "$mountpoint/.juicefs-mounted"
    ;;
  umount)
    rm -f "$2/.juicefs-mounted"
    ;;
esac
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
      cat > "$bin/findmnt" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-no" && "$2" == "FSTYPE" ]]; then
  printf 'fuse.juicefs\\n'
  exit 0
fi
exit 0
SH
      chmod +x "$bin/juicefs" "$bin/mountpoint" "$bin/findmnt"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      ensure_afscp_local_runtime_volume_root
      stop_afscp_local_runtime
      cat "\${SNIPPET_TEMP_ROOT}/juicefs.log"
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('juicefs umount');
    expect(result.stdout).toContain('/afscp-volume-root');
    expect(result.stdout).toContain('marker=absent');
  });

  it('fails closed without unmounting when the local-real AFSCP marker points outside AFSCP_VOLUME_ROOT', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      foreign_root="\${SNIPPET_TEMP_ROOT}/foreign-volume-root"
      mkdir -p "$bin" "$mount_root" "$foreign_root" "$(dirname "$AFSCP_VOLUME_ROOT_MOUNT_MARKER")"
      printf 'mounted\\n' > "$foreign_root/.juicefs-mounted"
      printf '%s\\n' "$foreign_root" > "$AFSCP_VOLUME_ROOT_MOUNT_MARKER"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      cat > "$bin/umount" <<'SH'
#!/usr/bin/env bash
printf 'umount %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/unmount.log"
exit 0
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
      chmod +x "$bin/juicefs" "$bin/umount" "$bin/mountpoint"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      set +e
      stop_afscp_local_runtime
      stop_status=$?
      set -e
      printf 'stop_status=%s\\n' "$stop_status"
      if [[ -f "$SNIPPET_TEMP_ROOT/unmount.log" ]]; then
        cat "$SNIPPET_TEMP_ROOT/unmount.log"
      fi
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
      exit "$stop_status"
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AFSCP local-real mount marker path');
    expect(result.stderr).toContain('does not match AFSCP_VOLUME_ROOT');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stdout).toContain('marker=present');
    expect(result.stdout).not.toContain('juicefs umount');
    expect(result.stdout).not.toContain('umount ');
  });

  it('fails closed and keeps the mount marker when the local-real AFSCP JuiceFS unmount fails', () => {
    const result = runInternalCommonSnippet(`
      bin="\${SNIPPET_TEMP_ROOT}/bin"
      mount_root="\${SNIPPET_TEMP_ROOT}/afscp-volume-root"
      mkdir -p "$bin" "$mount_root"
      cat > "$bin/juicefs" <<'SH'
#!/usr/bin/env bash
printf 'juicefs %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
case "$1" in
  config)
    printf '{"Name":"vol-local-manual","Storage":"minio","Bucket":"http://localhost:19000/mbos-dev/"}\\n'
    ;;
  mount)
    mountpoint="\${@: -1}"
    mkdir -p "$mountpoint"
    printf 'mounted\\n' > "$mountpoint/.juicefs-mounted"
    ;;
  umount)
    exit 55
    ;;
esac
exit 0
SH
      cat > "$bin/umount" <<'SH'
#!/usr/bin/env bash
printf 'umount %s\\n' "$*" >> "$SNIPPET_TEMP_ROOT/juicefs.log"
exit 56
SH
      cat > "$bin/mountpoint" <<'SH'
#!/usr/bin/env bash
[[ "$1" == "-q" && -f "$2/.juicefs-mounted" ]]
SH
      cat > "$bin/findmnt" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-no" && "$2" == "FSTYPE" ]]; then
  printf 'fuse.juicefs\\n'
  exit 0
fi
exit 0
SH
      chmod +x "$bin/juicefs" "$bin/umount" "$bin/mountpoint" "$bin/findmnt"
      export PATH="$bin:$PATH"
      AFSCP_JVS_ENABLED=false
      AFSCP_VOLUME_ROOT="$mount_root"
      ensure_afscp_local_runtime_volume_root
      set +e
      stop_afscp_local_runtime
      stop_status=$?
      set -e
      printf 'stop_status=%s\\n' "$stop_status"
      if [[ -f "$AFSCP_VOLUME_ROOT_MOUNT_MARKER" ]]; then
        printf 'marker=present\\n'
      else
        printf 'marker=absent\\n'
      fi
      if afscp_is_mountpoint "$mount_root"; then
        printf 'still_mountpoint=yes\\n'
      else
        printf 'still_mountpoint=no\\n'
      fi
      cat "\${SNIPPET_TEMP_ROOT}/juicefs.log"
      exit "$stop_status"
    `);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('failed to unmount AFSCP local-real JuiceFS volume root');
    expect(result.stderr).toContain('local-real fails closed');
    expect(result.stdout).toContain('juicefs umount');
    expect(result.stdout).toContain('umount ');
    expect(result.stdout).toContain('marker=present');
    expect(result.stdout).toContain('still_mountpoint=yes');
  });

  it('runs the local-real AFSCP unmount path before reset removes internal runtime state', () => {
    const reset = readFileSync('scripts/local-manual/internal-reset.sh', 'utf8');

    expect(reset.indexOf('stop_internal_runtime')).toBeGreaterThanOrEqual(0);
    expect(reset.indexOf('reset_owned_afscp_local_runtime_for_gate')).toBeGreaterThanOrEqual(0);
    expect(reset.indexOf('rm -rf "${INTERNAL_REAL_DIR}"')).toBeGreaterThanOrEqual(0);
    expect(reset.indexOf('stop_internal_runtime')).toBeLessThan(reset.indexOf('reset_owned_afscp_local_runtime_for_gate'));
    expect(reset.indexOf('stop_internal_runtime')).toBeLessThan(reset.indexOf('rm -rf "${INTERNAL_REAL_DIR}"'));
    expect(reset.indexOf('reset_owned_afscp_local_runtime_for_gate')).toBeLessThan(
      reset.indexOf('rm -rf "${INTERNAL_REAL_DIR}"'),
    );
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
    const startBody = functionBody(common, 'start_internal_runtime');

    expect(common).toContain('bash "${CONTROL_SCRIPT}" start-asbcp');
    expect(common).toContain('bash "${CONTROL_SCRIPT}" stop-asbcp');
    expect(startBody).toContain('ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}"');
    expect(startBody).toContain('AFSCP_ORCHESTRATOR_TOKEN="${afscp_orchestrator_token}"');
    expect(common).not.toContain('start-cleaner');
    expect(common).not.toContain('stop-cleaner');
    expect(common).not.toContain('INTERNAL_SANDBOX_CLEANER');
    expect(common).not.toContain('CLEANER_LOG=');
    expect(common).not.toContain('CLEANER_INTERVAL_SECONDS=');
  });
});
