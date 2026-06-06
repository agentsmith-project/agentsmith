import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX } from './governance/current-release-boundary-schema';

const RUNNER_IMAGE_LOCK_TRUTH_PATH =
  'release/agentsmith-runner-image.lock';
const LEGACY_RUNNER_IMAGE_LOCK_FIXTURE_PATH =
  'scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock';
const NON_CANONICAL_RUNNER_IMAGE_LOCK_PATH = 'infra/deploy/shared/agentsmith-runner-image.lock';
const AFSCP_PROBE_SHELL_VAR_VALUES = {
  AFSCP_BASE_URL: 'http://shell-var-only-afscp.local:29094',
  AFSCP_EXPORT_GATEWAY_BASE_URL: 'http://shell-var-only-webdav.local:29095',
  AFSCP_DEFAULT_VOLUME_ID: 'vol_shell_var_only',
  AFSCP_CALLER_SERVICE: 'agentsmith-api-shell-var',
  AFSCP_SERVICE_TOKEN: 'shell-var-product-token',
  AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap-shell-var',
  AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'shell-var-bootstrap-token',
  AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-shell-var',
  AFSCP_ORCHESTRATOR_SERVICE_TOKEN: 'shell-var-orchestrator-service-token',
  AFSCP_ORCHESTRATOR_TOKEN: 'shell-var-orchestrator-token',
};

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

function shellFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(`${functionName}() {`);
  expect(start, `${functionName} start`).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf('\nrun_', start + functionName.length + 4);
  const nextMode = source.indexOf('\nset +e', start);
  const endCandidates = [nextFunction, nextMode].filter((index) => index > start);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : source.length;

  return source.slice(start, end);
}

function shellFunctionDefinition(source: string, functionName: string): string {
  const match = source.match(new RegExp(`^${functionName}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'mu'));
  expect(match?.[0], `${functionName} definition`).toBeTruthy();
  return match?.[0] ?? '';
}

function shellFunctionBefore(source: string, startNeedle: string, nextNeedle: string): string {
  return `${sectionBetween(source, startNeedle, `\n}\n\n${nextNeedle}`)}\n}`;
}

function sectionBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `${startNeedle} start`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end, `${endNeedle} end`).toBeGreaterThan(start);

  return source.slice(start, end);
}

function runRunnerProjectionSmokeImagePreconditions(args: {
  explicitImage?: string;
  buildImage?: string;
  gateMode?: 'runner-projection-smoke' | 'runner-locked-runtime-smoke';
} = {}): { stdout: string; stderr: string; status: number | null } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runner-projection-smoke-image-'));
  const lockPath = path.join(tempRoot, 'agentsmith-runner-image.lock');
  const scriptPath = path.join(tempRoot, 'image-preconditions.sh');
  const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
  const lockFunction = shellFunctionBefore(
    agentTaskGate,
    '\nrunner_image_lock_value() {',
    'deepseek_openai_host',
  );
  const imagePreconditionFunction = shellFunctionBefore(
    agentTaskGate,
    '\nensure_runner_projection_smoke_image_preconditions() {',
    'ensure_runner_projection_smoke_deepseek_preconditions',
  );

  writeFileSync(
    lockPath,
    read(RUNNER_IMAGE_LOCK_TRUTH_PATH),
    'utf8',
  );
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="${repoRoot}"
GATE_MODE="${args.gateMode ?? 'runner-projection-smoke'}"
RUNNER_IMAGE_LOCK_PATH="${lockPath}"
INTERNAL_REAL_DIR="${tempRoot}/internal"
RUNNER_IMAGE="agentsmith-managed-runner:local"
EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE="\${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"
mkdir -p "\${INTERNAL_REAL_DIR}"

gate_record_failure() {
  printf 'failure:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
}

gate_record_preflight_check() {
  printf 'preflight:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
}

docker() {
  if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" && "\${3:-}" == "--format" ]]; then
    printf 'sha256:runner-projection-smoke-image-id\\n'
    return 0
  fi
  if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
    return 0
  fi
  printf 'unexpected docker call: %s\\n' "$*" >&2
  return 1
}

${lockFunction}
${imagePreconditionFunction}

ensure_runner_projection_smoke_image_preconditions
resolved_image_id="\${INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID:-\${INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID:-}}"
printf 'resolved_runner=%s\\n' "\${RUNNER_IMAGE}"
printf 'exported_image=%s\\n' "\${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"
printf 'build_runner_image=%s\\n' "\${BUILD_RUNNER_IMAGE:-}"
printf 'exported_build=%s\\n' "\${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-}"
printf 'image_id=%s\\n' "\${resolved_image_id}"
`,
    'utf8',
  );

  try {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(args.explicitImage === undefined ? {} : { INTEGRATION_INTERNAL_AGENT_IMAGE: args.explicitImage }),
        ...(args.buildImage === undefined ? {} : { INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE: args.buildImage }),
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runRunnerProjectionSmokeDeepseekPreconditions(args: {
  openaiBaseUrl: string;
}): { stdout: string; stderr: string; status: number | null } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runner-projection-smoke-deepseek-'));
  const scriptPath = path.join(tempRoot, 'deepseek-preconditions.sh');
  const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
  const hostFunction = shellFunctionBefore(
    agentTaskGate,
    '\ndeepseek_openai_host() {',
    'ensure_runner_projection_smoke_deepseek_preconditions',
  );
  const deepseekPreconditionFunction = shellFunctionBefore(
    agentTaskGate,
    '\nensure_runner_projection_smoke_deepseek_preconditions() {',
    'ensure_runner_projection_smoke_image_preconditions',
  );

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
GATE_MODE="runner-projection-smoke"
INTERNAL_REAL_DIR="${tempRoot}/internal"
mkdir -p "\${INTERNAL_REAL_DIR}"

gate_record_failure() {
  printf 'failure:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
}

gate_record_preflight_check() {
  printf 'preflight:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
}

${hostFunction}
${deepseekPreconditionFunction}

ensure_runner_projection_smoke_deepseek_preconditions
`,
    'utf8',
  );

  try {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BACKEND_REAL_OPENAI_BASE_URL: args.openaiBaseUrl,
        BACKEND_REAL_OPENAI_BASE_URL_VALUE: '',
        PRESET_OPENAI_ENDPOINT_BASE_URL: '',
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function renderSandboxState(env: Record<string, string>): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-'));
  const stateFile = path.join(tempRoot, 'sandbox-control.env');

  try {
    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          ROOT_DIR="$REPO_ROOT"
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          CONFIG_PATH="$TEMP_ROOT/asbcp.yaml"
          ASBCP_PORT="28080"
          ASBCP_INTERNAL_BASE_URL_VALUE="http://127.0.0.1:28080"
          ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
          KIND_CLUSTER_NAME="agentsmith"
          K8S_NAMESPACE="agentsmith-sandbox"
          CSI_DRIVER="csi.juicefs.com"
          STORAGE_CAPACITY="1Pi"
          STORAGE_CLASS_NAME=""
          MOUNT_OPTIONS=""
          SUBDIR=""
          MOUNT_SERVICE_ACCOUNT=""
          MOUNT_IMAGE_OVERRIDE=""
          AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="http://minio.internal:9000"
          MINIO_ACCESS_KEY="minio-ak"
          MINIO_SECRET_KEY="minio-sk"
          MINIO_BUCKET="mbos-dev"
          mkdir -p "$INTERNAL_REAL_DIR"
          internal_real_gate_write_sandbox_state_file "$STATE_FILE" "$CONFIG_PATH" "$TEMP_ROOT/asbcp.log"
          cat "$STATE_FILE"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          ...env,
          REPO_ROOT: repoRoot,
          TEMP_ROOT: tempRoot,
          HOME: path.join(tempRoot, 'home'),
          STATE_FILE: stateFile,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function renderInternalBackendSandboxConfig(): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-config-'));
  const configPath = path.join(tempRoot, 'asbcp.yaml');

  try {
    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          ROOT_DIR="$REPO_ROOT"
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          CONFIG_PATH="$CONFIG_PATH_VALUE"
          ASBCP_PORT="28080"
          K8S_NAMESPACE="agentsmith-sandbox"
          RUNNER_IMAGE="runner:test"
          internal_real_gate_write_sandbox_config
          cat "$CONFIG_PATH"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          CONFIG_PATH_VALUE: configPath,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runPrepareRuntimeWithLegacyRunnerImage(args: {
  legacyRef: string;
  buildRunnerImage: '0' | '1';
}): { stdout: string; stderr: string; status: number | null } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-legacy-'));

  try {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -uo pipefail
          ROOT_DIR="$REPO_ROOT"
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$TEMP_ROOT/calls.log"
          : > "$calls_file"
          record() { printf '%s\\n' "$*" >> "$calls_file"; }
          internal_real_gate_require_host_tools() { record require_host_tools; }
          internal_real_gate_default_kind_cluster_name() { record default_kind_cluster_name; printf 'agentsmith\\n'; }
          internal_real_gate_ensure_kind_cluster() { record ensure_kind_cluster; }
          internal_real_gate_runner_image_reuse_ready() { record reuse_ready; return 1; }
          build_runner_image() { record "build_runner_image $*"; }
          docker() { record "docker $*"; return 1; }
          kubectl() { record "kubectl $*"; return 0; }
          internal_real_gate_publish_local_runner_image_ref() {
            record "publish $*"
            printf 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:%s\\n' "$DIGEST_HEX"
          }
          internal_real_gate_preflight_kind_registry_runner_image() { record "preflight $*"; }
          internal_real_gate_prepare_managed_runner_image_handoff() {
            record child_handoff
            managed_runner_image_handoff_reject_legacy_runner_image_ref "$RUNNER_IMAGE" "[internal-real-gate]" || return 1
          }
          ensure_agentsmith_owned_namespace() { record "namespace $*"; }
          internal_real_gate_ensure_kind_image() { record "kind_image $*"; }
          internal_real_gate_ensure_afscp_storage_csi() { record csi; }
          internal_real_gate_resolve_kind_gateway() { record gateway; printf '172.18.0.1\\n'; }
          k8s_external_minio_fqdn() { record "minio $*"; printf 'minio.internal\\n'; }
          render_k8s_external_dependency_services() { record "render_deps $*"; }
          ensure_internal_afscp_local_runtime() { record afscp; }
          internal_real_gate_write_sandbox_config() { record write_config; }

          GATE_MODE=core-composite
          RUNNER_KIND=agent-task
          RUNNER_BASE_IMAGE=agentsmith-managed-runner-base:local
          RUNNER_IMAGE="$LEGACY_REF"
          BUILD_RUNNER_IMAGE="$BUILD_RUNNER_IMAGE_VALUE"
          DOCKER_BUILD_PROXY_VALUE=""
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          K8S_NAMESPACE=agentsmith-sandbox
          CONFIG_PATH="$TEMP_ROOT/asbcp.yaml"
          ASBCP_PORT=28080
          API_PORT=20072
          INTEGRATION_POSTGRES_PORT=25432
          INTEGRATION_MINIO_API_PORT=29000
          AFSCP_STORAGE_CSI_NAMESPACE=kube-system
          mkdir -p "$INTERNAL_REAL_DIR"

          set +e
          prepare_internal_backend_real_gate_runtime
          status=$?
          set -e
          printf 'status=%s\\n' "$status"
          sed 's/^/call:/' "$calls_file"
          exit 0
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          TEMP_ROOT: tempRoot,
          LEGACY_REF: args.legacyRef,
          BUILD_RUNNER_IMAGE_VALUE: args.buildRunnerImage,
          DIGEST_HEX: 'f'.repeat(64),
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runInternalSpecGrepEarlyFailureHarness(options: { runs?: number } = {}): {
  stdout: string;
  stderr: string;
  status: number | null;
  summary: string;
  internalFailure: string;
  internalChildEvidenceExists: boolean;
  afscpApiLogTail: string;
  asbcpDockerLogs: string;
  k8sPodStatus: string;
  k8sEvents: string;
  afscpRuntimeFingerprint: string;
  runtimeReadinessSummary: string;
  runtimeReadinessDetails: string;
  runtimeStabilityBlockerSummary: string;
} {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-spec-grep-evidence-'));
  const uploadRoot = path.join(tempRoot, 'upload', 'child-internal-evidence');
  const scriptPath = path.join(tempRoot, 'harness.sh');
  const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
  const evidenceFunctions = sectionBetween(
    agentTaskGate,
    '\nchild_internal_evidence_slug() {',
    '\nif [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]',
  );
  const runGrepFunction = shellFunctionDefinition(agentTaskGate, 'run_internal_spec_grep');

  try {
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="${repoRoot}"
TEMP_ROOT="${tempRoot}"
INTERNAL_REAL_DIR="${tempRoot}/internal"
CHILD_INTERNAL_EVIDENCE_ROOT="${uploadRoot}"
GATE_MODE="files-restore-continue"
KEEP_FAILED_ENV=0
K8S_NAMESPACE="agentsmith-sandbox"
KIND_CONTEXT_NAME="kind-agentsmith"
CONTEXT_NAME="kind-agentsmith"
ASBCP_PORT=28080
AFSCP_BASE_URL="http://127.0.0.1:30090"
AFSCP_EXPORT_GATEWAY_BASE_URL="http://127.0.0.1:30091"
AFSCP_DEFAULT_VOLUME_ID="vol_internal_probe"
AFSCP_SERVICE_TOKEN="known-product-token"
AFSCP_BOOTSTRAP_SERVICE_TOKEN="known-bootstrap-token"
AFSCP_ORCHESTRATOR_TOKEN="known-orchestrator-token"
CONTROL_SCRIPT="${tempRoot}/control.sh"
mkdir -p "\${INTERNAL_REAL_DIR}" "\${CHILD_INTERNAL_EVIDENCE_ROOT}"
printf 'api ready token=%s\\n' "\${AFSCP_SERVICE_TOKEN}" > "\${INTERNAL_REAL_DIR}/afscp-api.log"
printf 'API call summary request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending error_code=AGENT_SANDBOX_UNAVAILABLE token=%s\\n' "\${AFSCP_SERVICE_TOKEN}" >> "\${INTERNAL_REAL_DIR}/afscp-api.log"
cat >> "\${INTERNAL_REAL_DIR}/afscp-api.log" <<'LOG'
[files] runtime_pending_readiness_failure {"event":"runtime_pending_readiness_failure","theme":"runtime_pending_readiness","scope":"file_library_runtime_access_release","diagnostic":{"theme":"runtime_pending_readiness","workspace_id":"ws_default","project_id":"proj_runtime","file_library_id":"flib_runtime","task_id":"task_runtime","workload_id":"workload-runtime-1","request_id":"release:begin:req-runtime-json","operation":"delete_pod","error_code":"AGENT_SANDBOX_UNAVAILABLE","mapped_error_code":"FILE_LIBRARY_OPERATION_FAILED","mapped_message":"file_library_operation_failed","status":502,"retryable":true,"pod_manager":{"theme":"runtime_pending_readiness","workspaceId":"ws_default","projectId":"proj_runtime","workloadId":"workload-runtime-1","api_trace":[{"operation":"delete_pod","outcome":"error","workload_id":"workload-runtime-1","request_id":"req-runtime-json-api-trace","phase":"pending","status_code":502,"error_code":"AGENT_SANDBOX_UNAVAILABLE","asbcp_code":"dependency_failure","retryable":true}],"pod_manager_summary":{"workload_id":"workload-runtime-1","operations":["delete_pod"],"request_ids":["req-runtime-json-step"],"latest_operation":"delete_pod","latest_outcome":"error","latest_phase":"pending","latest_status_code":502,"latest_error_code":"AGENT_SANDBOX_UNAVAILABLE","latest_asbcp_code":"dependency_failure"},"asbcp_call_summaries":[{"operation":"delete_pod","outcome":"error","workload_id":"workload-runtime-1","request_id":"req-runtime-json-asbcp-summary","phase":"pending","status_code":502,"error_code":"AGENT_SANDBOX_UNAVAILABLE","asbcp_code":"dependency_failure","retryable":true}],"steps":[{"operation":"delete_pod","outcome":"error","workloadId":"workload-runtime-1","status":502,"requestId":"req-runtime-json-step","code":"AGENT_SANDBOX_UNAVAILABLE","asbcpCode":"dependency_failure","retryable":true,"message":"asbcp_error: delete_pod 502"}]}}}
asbcp_workload_status http_status=200 request_id=req-runtime-status workload_id=workload-runtime-1 status=offline phase=offline error_code=INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING
LOG
printf 'worker ready token=%s\\n' "\${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" > "\${INTERNAL_REAL_DIR}/afscp-worker.log"
printf 'pod manager create_or_ensure_pod request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending error_code=AGENT_SANDBOX_UNAVAILABLE\\n' >> "\${INTERNAL_REAL_DIR}/afscp-worker.log"
printf 'ASBCP create/status summary request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending status_code=503 error_code=AGENT_SANDBOX_UNAVAILABLE\\n' >> "\${INTERNAL_REAL_DIR}/afscp-worker.log"
printf 'gateway ready token=%s\\n' "\${AFSCP_ORCHESTRATOR_TOKEN}" > "\${INTERNAL_REAL_DIR}/afscp-export-gateway.log"

gate_record_failure() {
  mkdir -p "$1"
  printf '%s|%s|%s\\n' "$2" "$3" "$4" >> "$1/failure-records.txt"
}

gate_record_preflight_check() {
  printf 'unexpected preflight: %s\\n' "$*" >> "\${TEMP_ROOT}/calls.txt"
}

info() { :; }
timeout() { shift; "$@"; }
docker() { printf 'docker unavailable in harness\\n'; return 1; }
kubectl() { printf 'kubectl unavailable in harness\\n'; return 1; }
resolve_internal_spec_port_pair() { return 1; }
prepare_internal_backend_real_spec_runtime() {
  printf 'unexpected prepare\\n' >> "\${TEMP_ROOT}/calls.txt"
  return 1
}
run_internal_spec() {
  printf 'unexpected run\\n' >> "\${TEMP_ROOT}/calls.txt"
  return 1
}

${evidenceFunctions}
${runGrepFunction}

status=0
for run_index in $(seq 1 ${options.runs ?? 1}); do
  set +e
  run_internal_spec_grep e2e/integration-files-user-stories.spec.ts "same task can continue after Files restore" 21020 3121
  status=$?
  set -e
  printf 'status_%s=%s\\n' "\${run_index}" "\${status}"
done
printf 'upload_root=%s\\n' "\${CHILD_INTERNAL_EVIDENCE_ROOT}"
find "\${CHILD_INTERNAL_EVIDENCE_ROOT}" -maxdepth 2 -type f | sort
exit 0
`,
      'utf8',
    );

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const summaryPath = path.join(uploadRoot, 'files_restore_continuation_spec', 'summary.txt');
    const internalFailurePath = path.join(tempRoot, 'internal', 'failure-records.txt');
    const afscpApiLogTailPath = path.join(uploadRoot, 'files_restore_continuation_spec', 'afscp-api-log-tail.txt');
    const asbcpDockerLogsPath = path.join(uploadRoot, 'files_restore_continuation_spec', 'asbcp-docker-logs.txt');
    const k8sPodStatusPath = path.join(uploadRoot, 'files_restore_continuation_spec', 'k8s-pod-status.txt');
    const k8sEventsPath = path.join(uploadRoot, 'files_restore_continuation_spec', 'k8s-events.txt');
    const afscpRuntimeFingerprintPath = path.join(
      uploadRoot,
      'files_restore_continuation_spec',
      'afscp-runtime-fingerprint.txt',
    );
    const runtimeReadinessSummaryPath = path.join(
      uploadRoot,
      'files_restore_continuation_spec',
      'runtime-readiness-summary.txt',
    );
    const runtimeReadinessDetailsPath = path.join(
      uploadRoot,
      'files_restore_continuation_spec',
      'runtime-readiness-details.json',
    );
    const runtimeStabilityBlockerSummaryPath = path.join(
      uploadRoot,
      'files_restore_continuation_spec',
      'runtime-stability-blocker-summary.txt',
    );

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '',
      internalFailure: existsSync(internalFailurePath) ? readFileSync(internalFailurePath, 'utf8') : '',
      internalChildEvidenceExists: existsSync(path.join(tempRoot, 'internal', 'child-internal-evidence')),
      afscpApiLogTail: existsSync(afscpApiLogTailPath) ? readFileSync(afscpApiLogTailPath, 'utf8') : '',
      asbcpDockerLogs: existsSync(asbcpDockerLogsPath) ? readFileSync(asbcpDockerLogsPath, 'utf8') : '',
      k8sPodStatus: existsSync(k8sPodStatusPath) ? readFileSync(k8sPodStatusPath, 'utf8') : '',
      k8sEvents: existsSync(k8sEventsPath) ? readFileSync(k8sEventsPath, 'utf8') : '',
      afscpRuntimeFingerprint: existsSync(afscpRuntimeFingerprintPath)
        ? readFileSync(afscpRuntimeFingerprintPath, 'utf8')
        : '',
      runtimeReadinessSummary: existsSync(runtimeReadinessSummaryPath)
        ? readFileSync(runtimeReadinessSummaryPath, 'utf8')
        : '',
      runtimeReadinessDetails: existsSync(runtimeReadinessDetailsPath)
        ? readFileSync(runtimeReadinessDetailsPath, 'utf8')
        : '',
      runtimeStabilityBlockerSummary: existsSync(runtimeStabilityBlockerSummaryPath)
        ? readFileSync(runtimeStabilityBlockerSummaryPath, 'utf8')
        : '',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runInternalSpecGrepCleanPassHarness(options: { runtimeMarker?: boolean } = {}): {
  stdout: string;
  stderr: string;
  status: number | null;
  runtimeReadinessDetails: string;
} {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-spec-grep-clean-pass-'));
  const uploadRoot = path.join(tempRoot, 'upload', 'child-internal-evidence');
  const scriptPath = path.join(tempRoot, 'harness.sh');
  const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
  const evidenceFunctions = sectionBetween(
    agentTaskGate,
    '\nchild_internal_evidence_slug() {',
    '\nif [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]',
  );
  const runGrepFunction = shellFunctionDefinition(agentTaskGate, 'run_internal_spec_grep');

  try {
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="${repoRoot}"
TEMP_ROOT="${tempRoot}"
INTERNAL_REAL_DIR="${tempRoot}/internal"
CHILD_INTERNAL_EVIDENCE_ROOT="${uploadRoot}"
GATE_MODE="files-restore-continue"
KEEP_FAILED_ENV=0
ASBCP_PORT=28080
CONTROL_SCRIPT="${tempRoot}/control.sh"
mkdir -p "\${INTERNAL_REAL_DIR}" "\${CHILD_INTERNAL_EVIDENCE_ROOT}"
printf '#!/usr/bin/env bash\\nexit 0\\n' > "\${CONTROL_SCRIPT}"
chmod +x "\${CONTROL_SCRIPT}"
if [[ "${options.runtimeMarker ? '1' : '0'}" == "1" ]]; then
  printf 'API call summary request_id=req-runtime-pass workload_id=workload-runtime-pass phase=offline error_code=AGENT_SANDBOX_UNAVAILABLE\\n' > "\${INTERNAL_REAL_DIR}/afscp-api.log"
  printf 'pod manager create_or_ensure_pod request_id=req-runtime-pass workload_id=workload-runtime-pass phase=offline error_code=AGENT_SANDBOX_UNAVAILABLE\\n' > "\${INTERNAL_REAL_DIR}/afscp-worker.log"
  printf 'ASBCP create/status summary request_id=req-runtime-pass workload_id=workload-runtime-pass phase=offline status_code=503 error_code=AGENT_SANDBOX_UNAVAILABLE\\n' >> "\${INTERNAL_REAL_DIR}/afscp-worker.log"
fi

gate_record_failure() {
  printf 'unexpected failure: %s\\n' "$*" >> "\${TEMP_ROOT}/calls.txt"
}

gate_record_preflight_check() {
  printf 'preflight:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}" >> "\${TEMP_ROOT}/calls.txt"
}

info() { :; }
resolve_internal_spec_port_pair() { printf '21020 3121\\n'; }
prepare_internal_backend_real_spec_runtime() {
  local state_file="\${TEMP_ROOT}/sandbox-control.env"
  printf 'INTERNAL_AGENT_K8S_NAMESPACE=agentsmith-sandbox\\n' > "\${state_file}"
  printf '%s\\n' "\${state_file}"
}
run_internal_spec() {
  printf 'run_internal_spec:%s\\n' "$*" >> "\${TEMP_ROOT}/calls.txt"
  return 0
}

${evidenceFunctions}
${runGrepFunction}

set +e
run_internal_spec_grep e2e/integration-files-user-stories.spec.ts "same task can continue after Files restore" 21020 3121
status=$?
set -e
printf 'status=%s\\n' "\${status}"
find "\${CHILD_INTERNAL_EVIDENCE_ROOT}" -maxdepth 2 -type f | sort
exit 0
`,
      'utf8',
    );

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const runtimeReadinessDetailsPath = path.join(
      uploadRoot,
      'files_restore_continuation_spec',
      'runtime-readiness-details.json',
    );

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
      runtimeReadinessDetails: existsSync(runtimeReadinessDetailsPath)
        ? readFileSync(runtimeReadinessDetailsPath, 'utf8')
        : '',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function sendJson(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => resolve(body));
  });
}

async function runAfscpReadExportProbeHarness(options: {
  createExportStatus?: number;
  createExportErrorBody?: Record<string, unknown>;
  webdavStatus?: number;
  webdavBody?: string;
  runs?: number;
  requestTimeoutMs?: number;
  accessUrlOverride?: string;
  hangReadyz?: boolean;
  hangCreateExport?: boolean;
  hangWebdav?: boolean;
  hangRevoke?: boolean;
} = {}): Promise<{
  stdout: string;
  stderr: string;
  status: number | null;
  runResults: Array<{ stdout: string; stderr: string; status: number | null }>;
  log: string;
  requests: string[];
  webdavAuthorization: string;
  webdavAuthorizations: string[];
  exportIdempotencyKeys: string[];
  webdavUrls: string[];
}> {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'afscp-read-export-probe-'));
  const logPath = path.join(tempRoot, 'probe.log');
  const requests: string[] = [];
  const exportIdempotencyKeys: string[] = [];
  const webdavUrls: string[] = [];
  const webdavAuthorizations: string[] = [];
  const exportByIdempotencyKey = new Map<string, { exportId: string; accessUrl: string }>();
  const revokedWebdavPaths = new Set<string>();
  let webdavAuthorization = '';

  const webdavServer = createServer((request, response) => {
    requests.push(`webdav:${request.method ?? ''}:${request.url ?? ''}`);
    webdavAuthorization = String(request.headers.authorization ?? '');
    webdavAuthorizations.push(webdavAuthorization);
    if (options.hangWebdav) {
      return;
    }
    if (revokedWebdavPaths.has(request.url ?? '')) {
      response.statusCode = 403;
      response.end('revoked');
      return;
    }
    response.statusCode = options.webdavStatus ?? 207;
    response.end(options.webdavBody ?? '<multistatus />');
  });

  const webdavPort = await listenOnLoopback(webdavServer);
  const webdavUrlForExport = (index: number) => `http://127.0.0.1:${webdavPort}/export_probe_${index}`;

  const operationEnvelope = (operationId: string, resourceType: string, resourceId: string) => ({
    operation_id: operationId,
    operation_state: 'succeeded',
    resource: { type: resourceType, id: resourceId },
    result: null,
    error: null,
  });
  const exportEnvelope = (exportId: string, accessUrl: string) => ({
    operation_id: `op_${exportId}`,
    operation_state: 'succeeded',
    resource: { type: 'export', id: exportId },
    result: {
      export: { export_id: exportId },
      access: {
        url: accessUrl,
        auth: { type: 'basic', username: 'probe-user', password: 'probe-pass' },
        mode: 'read_only',
        expires_at: '2026-06-02T00:00:00.000Z',
      },
    },
    error: null,
  });

  const apiServer = createServer(async (request, response) => {
    const method = request.method ?? '';
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(`api:${method}:${requestUrl.pathname}`);

    if (method === 'GET' && requestUrl.pathname === '/readyz') {
      if (options.hangReadyz) {
        return;
      }
      response.statusCode = 200;
      response.end('ok');
      return;
    }
    await readBody(request);
    if (method === 'PUT' && /^\/internal\/v1\/namespaces\/[^/]+$/u.test(requestUrl.pathname)) {
      sendJson(response, 200, operationEnvelope('op_namespace_probe', 'namespace', 'ns_gate_probe_fixture01'));
      return;
    }
    if (method === 'PUT' && requestUrl.pathname.endsWith('/volume-binding')) {
      sendJson(response, 200, operationEnvelope('op_binding_probe', 'namespace_volume_binding', 'ns_gate_probe_fixture01'));
      return;
    }
    if (method === 'GET' && requestUrl.pathname.startsWith('/internal/v1/operations/')) {
      const operationId = requestUrl.pathname.split('/').pop() ?? 'op_unknown';
      sendJson(response, 200, operationEnvelope(operationId, 'operation', operationId));
      return;
    }
    if (method === 'GET' && requestUrl.pathname === '/internal/v1/repos/repo_gate_probe_fixture01') {
      sendJson(response, 404, { error_code: 'afscp_resource_not_found', message: 'not found' });
      return;
    }
    if (method === 'POST' && requestUrl.pathname === '/internal/v1/repos') {
      sendJson(response, 200, operationEnvelope('op_repo_probe', 'repo', 'repo_gate_probe_fixture01'));
      return;
    }
    if (method === 'POST' && requestUrl.pathname === '/internal/v1/repos/repo_gate_probe_fixture01/exports') {
      if (options.hangCreateExport) {
        return;
      }
      const idempotencyKey = String(request.headers['idempotency-key'] ?? '');
      exportIdempotencyKeys.push(idempotencyKey);
      const status = options.createExportStatus ?? 200;
      const existing = exportByIdempotencyKey.get(idempotencyKey);
      const exportRecord = existing ?? {
        exportId: `export_probe_${exportByIdempotencyKey.size + 1}`,
        accessUrl: options.accessUrlOverride ?? webdavUrlForExport(exportByIdempotencyKey.size + 1),
      };
      if (!existing) {
        exportByIdempotencyKey.set(idempotencyKey, exportRecord);
      }
      webdavUrls.push(exportRecord.accessUrl);
      sendJson(response, status, status >= 200 && status < 300
        ? exportEnvelope(exportRecord.exportId, exportRecord.accessUrl)
        : options.createExportErrorBody ?? { error_code: 'afscp_backend_unavailable', message: 'unavailable' });
      return;
    }
    if (method === 'DELETE' && requestUrl.pathname.startsWith('/internal/v1/exports/')) {
      const exportId = decodeURIComponent(requestUrl.pathname.split('/').pop() ?? '');
      const exportRecord = [...exportByIdempotencyKey.values()].find((record) => record.exportId === exportId);
      if (exportRecord) {
        revokedWebdavPaths.add(new URL(exportRecord.accessUrl).pathname);
      }
      if (options.hangRevoke) {
        return;
      }
      sendJson(response, 200, operationEnvelope('op_export_revoke', 'export', exportId));
      return;
    }

    sendJson(response, 404, { error_code: 'not_found', message: requestUrl.pathname });
  });

  const apiPort = await listenOnLoopback(apiServer);

  try {
    const runChild = () => new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve, reject) => {
      const child = spawn('node', ['scripts/lib/afscp-read-export-probe.mjs'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          AFSCP_BASE_URL: `http://127.0.0.1:${apiPort}`,
          AFSCP_EXPORT_GATEWAY_BASE_URL: `http://127.0.0.1:${webdavPort}`,
          AFSCP_DEFAULT_VOLUME_ID: 'vol_probe_fixture',
          AFSCP_CALLER_SERVICE: 'agentsmith-api',
          AFSCP_SERVICE_TOKEN: 'fixture-product-token-secret',
          AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
          AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'fixture-bootstrap-token-secret',
          AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
          AFSCP_ORCHESTRATOR_SERVICE_TOKEN: 'fixture-orchestrator-token-secret',
          AFSCP_READ_EXPORT_PROBE_MARKER: 'fixture01',
          AFSCP_READ_EXPORT_PROBE_LOG: logPath,
          ...(options.requestTimeoutMs === undefined
            ? {}
            : { AFSCP_READ_EXPORT_PROBE_REQUEST_TIMEOUT_MS: String(options.requestTimeoutMs) }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (status) => {
        resolve({ stdout, stderr, status });
      });
    });
    const runResults: Array<{ stdout: string; stderr: string; status: number | null }> = [];
    for (let runIndex = 0; runIndex < (options.runs ?? 1); runIndex += 1) {
      runResults.push(await runChild());
    }
    const result = runResults[runResults.length - 1] ?? { stdout: '', stderr: '', status: null };

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      runResults,
      log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
      requests,
      webdavAuthorization,
      webdavAuthorizations,
      exportIdempotencyKeys,
      webdavUrls,
    };
  } finally {
    await closeServer(apiServer);
    await closeServer(webdavServer);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runAfscpReadExportProbeShellVarHarness(): {
  stdout: string;
  stderr: string;
  status: number | null;
  capturedEnv: string;
} {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'afscp-read-export-probe-shell-vars-'));
  const binDir = path.join(tempRoot, 'bin');
  const capturePath = path.join(tempRoot, 'captured-env.txt');
  const nodeStubPath = path.join(binDir, 'node');
  const envKeys = Object.keys(AFSCP_PROBE_SHELL_VAR_VALUES);
  const captureLines = envKeys.map((key) => `    printf '${key}=%s\\n' "\${${key}:-}"`).join('\n');
  const shellAssignments = Object.entries(AFSCP_PROBE_SHELL_VAR_VALUES)
    .map(([key, value]) => `          ${key}=${JSON.stringify(value)}`)
    .join('\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REPO_ROOT: repoRoot,
    TEMP_ROOT: tempRoot,
    CAPTURE_ENV_FILE: capturePath,
    REAL_NODE: process.execPath,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };
  for (const key of envKeys) {
    delete env[key];
  }

  try {
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      nodeStubPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == *"/scripts/lib/afscp-read-export-probe.mjs" ]]; then
  {
${captureLines}
  } > "\${CAPTURE_ENV_FILE}"
  printf '{"status":"passed","source":"webdav_propfind","webdav_status":207}\\n'
  exit 0
fi
exec "\${REAL_NODE}" "$@"
`,
      'utf8',
    );
    chmodSync(nodeStubPath, 0o755);

    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          ROOT_DIR="$REPO_ROOT"
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          mkdir -p "$INTERNAL_REAL_DIR"
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"

          gate_record_failure() {
            printf 'failure:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
          }

          gate_record_preflight_check() {
            printf 'preflight:%s|%s|%s\\n' "\${2:-}" "\${3:-}" "\${4:-}"
          }

${shellAssignments}

          set +e
          internal_real_gate_probe_afscp_read_export
          status=$?
          set -e
          printf 'status=%s\\n' "$status"
          exit 0
        `,
      ],
      {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
      capturedEnv: existsSync(capturePath) ? readFileSync(capturePath, 'utf8') : '',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runChildInternalEvidenceRedactorHarness(input: string): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'child-internal-redactor-'));
  const scriptPath = path.join(tempRoot, 'redactor.sh');
  const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
  const redactionFunctions = shellFunctionBefore(
    agentTaskGate,
    '\nredact_child_internal_known_values() {',
    'run_child_internal_evidence_command',
  );

  try {
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
set -euo pipefail
ASBCP_SERVICE_KEY_VALUE="known-asbcp-secret"
ASBCP_SERVICE_KEY=""
AFSCP_SERVICE_TOKEN="known-product-token"
AFSCP_BOOTSTRAP_SERVICE_TOKEN="known-bootstrap-token"
AFSCP_ORCHESTRATOR_TOKEN="known-orchestrator-token"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN=""
PRESET_ENDPOINT_API_KEY_VALUE="sk-known-provider-secret"
PRESET_ENDPOINT_API_KEY=""

${redactionFunctions}

redact_child_internal_evidence
`,
      'utf8',
    );

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      input,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('internal backend-real gate runtime contract', () => {
  it('writes ASBCP sandbox config with the ASBCP main container contract', () => {
    const config = renderInternalBackendSandboxConfig();

    expect(config).toContain('runnerImage: runner:test');
    expect(config).toContain('containerName: main');
    expect(config).not.toContain('containerName: runner');
  });

  it('passes the AFSCP read-export probe through createExport and WebDAV PROPFIND without logging secrets', async () => {
    const result = await runAfscpReadExportProbeHarness();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('"status": "passed"');
    expect(result.stdout).toContain('"source": "webdav_propfind"');
    expect(result.stdout).toContain('"fixture_scope": "gate_owned_afscp_read_export_probe"');
    expect(result.stdout).toContain('"webdav_status": 207');
    expect(result.requests).toContain('api:POST:/internal/v1/repos/repo_gate_probe_fixture01/exports');
    expect(result.requests).toContain('webdav:PROPFIND:/export_probe_1');
    expect(result.webdavAuthorization).toBe(`Basic ${Buffer.from('probe-user:probe-pass', 'utf8').toString('base64')}`);
    expect(`${result.stdout}\n${result.log}`).not.toContain('probe-pass');
    expect(`${result.stdout}\n${result.log}`).not.toContain('fixture-product-token-secret');
    expect(`${result.stdout}\n${result.log}`).not.toContain('fixture-bootstrap-token-secret');
    expect(`${result.stdout}\n${result.log}`).not.toContain('fixture-orchestrator-token-secret');
    expect(result.log).toContain('"export_id_fingerprint":"sha256:');
    expect(result.log).not.toContain('export_probe_1');
  });

  it('passes AFSCP probe runtime env from shell vars even when they are not exported', () => {
    const result = runAfscpReadExportProbeShellVarHarness();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status=0');
    for (const [key, value] of Object.entries(AFSCP_PROBE_SHELL_VAR_VALUES)) {
      expect(result.capturedEnv).toContain(`${key}=${value}`);
    }
  });

  it('uses a unique read-export idempotency key on repeat probes without replaying a revoked WebDAV URL', async () => {
    const result = await runAfscpReadExportProbeHarness({ runs: 2 });

    expect(result.runResults).toHaveLength(2);
    expect(result.runResults.map((run) => run.status)).toEqual([0, 0]);
    expect(result.exportIdempotencyKeys).toHaveLength(2);
    expect(new Set(result.exportIdempotencyKeys).size).toBe(2);
    expect(result.exportIdempotencyKeys[0]).toContain('agentsmith-read-export-probe:fixture01:read-export:');
    expect(result.webdavUrls).toHaveLength(2);
    expect(new Set(result.webdavUrls).size).toBe(2);
    expect(result.requests).toContain('webdav:PROPFIND:/export_probe_1');
    expect(result.requests).toContain('webdav:PROPFIND:/export_probe_2');
    expect(result.requests.filter((entry) => entry === 'api:DELETE:/internal/v1/exports/export_probe_1')).toHaveLength(1);
    expect(result.requests.filter((entry) => entry === 'api:DELETE:/internal/v1/exports/export_probe_2')).toHaveLength(1);
  });

  it('classifies AFSCP createExport failures with a source discriminant and redacted response details', async () => {
    const result = await runAfscpReadExportProbeHarness({
      createExportStatus: 503,
      createExportErrorBody: {
        error_code: 'afscp_backend_unavailable',
        retryable: true,
        message: 'token=fixture-product-token-secret password=probe-pass',
      },
    });
    const output = `${result.stdout}\n${result.stderr}\n${result.log}`;

    expect(result.status).toBe(1);
    expect(output).toContain('"source": "afscp_create_export"');
    expect(output).toContain('"failure_class": "backend_unavailable"');
    expect(output).toContain('"http_status": 503');
    expect(output).toContain('"afscp_error_code": "afscp_backend_unavailable"');
    expect(output).not.toContain('fixture-product-token-secret');
    expect(output).not.toContain('probe-pass');
  });

  it('classifies WebDAV PROPFIND 401, 403, and 5xx without retrying or exposing Basic auth', async () => {
    const cases: Array<[number, string]> = [
      [401, 'admin_action_required'],
      [403, 'admin_action_required'],
      [503, 'backend_unavailable'],
    ];

    for (const [status, failureClass] of cases) {
      const result = await runAfscpReadExportProbeHarness({
        webdavStatus: status,
        webdavBody: 'Authorization: Basic should-not-survive password=probe-pass token=fixture-product-token-secret',
      });
      const output = `${result.stdout}\n${result.stderr}\n${result.log}`;

      expect(result.status).toBe(1);
      expect(output).toContain('"source": "webdav_propfind"');
      expect(output).toContain(`"failure_class": "${failureClass}"`);
      expect(output).toContain(`"webdav_status": ${status}`);
      expect(result.requests.filter((entry) => entry.startsWith('webdav:PROPFIND'))).toHaveLength(1);
      expect(result.requests.filter((entry) => entry === 'api:DELETE:/internal/v1/exports/export_probe_1')).toHaveLength(1);
      expect(output).not.toContain('probe-pass');
      expect(output).not.toContain('fixture-product-token-secret');
      expect(output).not.toContain('should-not-survive');
    }
  });

  it('rejects createExport access URLs outside the configured export gateway origin before sending Basic auth', async () => {
    const result = await runAfscpReadExportProbeHarness({
      accessUrlOverride: 'http://127.0.0.1:1/export_probe_1',
    });
    const output = `${result.stdout}\n${result.stderr}\n${result.log}`;

    expect(result.status).toBe(1);
    expect(output).toContain('"source": "afscp_create_export"');
    expect(output).toContain('"failure_class": "export_gateway_origin_mismatch"');
    expect(result.requests.filter((entry) => entry.startsWith('webdav:PROPFIND'))).toHaveLength(0);
    expect(result.webdavAuthorizations).toHaveLength(0);
    expect(result.requests.filter((entry) => entry === 'api:DELETE:/internal/v1/exports/export_probe_1')).toHaveLength(1);
    expect(output).not.toContain('probe-pass');
  });

  it('does not treat generic WebDAV 200 responses as a read-export pass', async () => {
    const result = await runAfscpReadExportProbeHarness({
      webdavStatus: 200,
      webdavBody: 'ok',
    });
    const output = `${result.stdout}\n${result.stderr}\n${result.log}`;

    expect(result.status).toBe(1);
    expect(output).toContain('"source": "webdav_propfind"');
    expect(output).toContain('"failure_class": "webdav_multistatus_required"');
    expect(output).toContain('"webdav_status": 200');
    expect(result.requests.filter((entry) => entry === 'api:DELETE:/internal/v1/exports/export_probe_1')).toHaveLength(1);
  });

  it('fails fast with clear source and failure class when AFSCP or WebDAV accepts but never responds', async () => {
    const cases: Array<{
      options: NonNullable<Parameters<typeof runAfscpReadExportProbeHarness>[0]>;
      source: string;
      failureClass: string;
    }> = [
      { options: { hangReadyz: true }, source: 'afscp_runtime_ready', failureClass: 'afscp_request_timeout' },
      { options: { hangCreateExport: true }, source: 'afscp_create_export', failureClass: 'afscp_request_timeout' },
      { options: { hangWebdav: true }, source: 'webdav_propfind', failureClass: 'webdav_propfind_timeout' },
    ];

    for (const testCase of cases) {
      const startedAt = Date.now();
      const result = await runAfscpReadExportProbeHarness({
        ...testCase.options,
        requestTimeoutMs: 50,
      });
      const output = `${result.stdout}\n${result.stderr}\n${result.log}`;

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result.status).toBe(1);
      expect(output).toContain(`"source": "${testCase.source}"`);
      expect(output).toContain(`"failure_class": "${testCase.failureClass}"`);
      expect(output).toContain('"timeout_ms": 50');
    }

    const revokeStartedAt = Date.now();
    const revokeResult = await runAfscpReadExportProbeHarness({
      hangRevoke: true,
      requestTimeoutMs: 50,
    });
    expect(Date.now() - revokeStartedAt).toBeLessThan(2_000);
    expect(revokeResult.status).toBe(0);
    expect(revokeResult.stdout).toContain('"status": "passed"');
  });

  it('keeps the Agent Task gate aligned on shared internal sandbox bootstrap', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const reclaimSpec = read('e2e/integration-internal-sandbox-reclaim.spec.ts');
    const developmentGuide = read('DEVELOPMENT.md');
    const prepareRuntimeFunction = sectionBetween(
      helper,
      '\nprepare_internal_backend_real_gate_runtime() {',
      '\n}\n\nprepare_internal_backend_real_spec_runtime()',
    );
    const secondRunIndex = reclaimSpec.indexOf('const secondRun = await startAgentTaskRunViaApi');
    const secondOutcomeIndex = reclaimSpec.indexOf('runnerOutputActivityId: secondRun.runnerOutputActivityId');
    const asbcpRestartIndex = reclaimSpec.indexOf("await runInternalSandboxControl('stop-asbcp')");

    expect(agentTaskGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');

    expect(agentTaskGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(agentTaskGate).toContain('reset_internal_afscp_local_runtime');
    expect(agentTaskGate).toContain(
      '\ntrap cleanup EXIT\n\nensure_internal_integration_deps_for_afscp\nwait_for_internal_integration_deps_for_afscp\nensure_internal_default_workspace_for_afscp\nensure_internal_kind_cluster_for_afscp_reset\nreset_internal_afscp_local_runtime\nenable_files_restore_continuation_afscp_restore_recovery\nprepare_internal_backend_real_gate_runtime',
    );
    expect(agentTaskGate).toContain('ensure_internal_kind_cluster_for_afscp_reset()');
    expect(agentTaskGate).toContain('ensure_internal_default_workspace_for_afscp()');
    expect(agentTaskGate).toContain('export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null');
    expect(agentTaskGate).toContain('export AFSCP_DATABASE_URL="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_ENVIRONMENT=local-real');
    expect(agentTaskGate).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(agentTaskGate).toContain('export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"');
    expect(agentTaskGate).toContain('export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_MINIO_API_PORT="${ORIGINAL_INTEGRATION_MINIO_API_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_KEYCLOAK_PORT="${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}"');
    expect(agentTaskGate.indexOf('trap cleanup EXIT')).toBeLessThan(
      agentTaskGate.indexOf('prepare_internal_backend_real_gate_runtime'),
    );
    expect(agentTaskGate).toContain('export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"');
    expect(agentTaskGate).not.toContain('RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host');

    expect(helper).toContain('ASBCP_INTERNAL_BASE_URL_VALUE="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"');
    expect(helper).toContain(
      'AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"',
    );
    expect(helper).toContain('internal_real_gate_ensure_afscp_storage_csi');
    expect(helper).toContain('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    expect(helper).not.toContain('kubectl create namespace "${K8S_NAMESPACE}"');
    expect(helper).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
    expect(helper).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE');
    expect(helper).not.toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
    expect(helper).toContain('render_k8s_external_dependency_services \\');
    expect(helper).toContain('internal_real_gate_start_runtime "${spec_state_file}"');
    expect(helper).toContain('internal_real_gate_probe_afscp_read_export()');
    expect(helper).toContain('AFSCP_READ_EXPORT_PROBE_SHELL_TIMEOUT_SECONDS:-90');
    expect(helper).not.toContain('local -a probe_env=(');
    expect(helper).toContain('export AFSCP_READ_EXPORT_PROBE_LOG="${probe_log}"');
    expect(helper).toContain('export AFSCP_BASE_URL="${AFSCP_BASE_URL:-}"');
    expect(helper).toContain('export AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-}"');
    expect(helper).toContain('export AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-}"');
    expect(helper).toContain('export AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-}"');
    expect(helper).toContain('export AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-}"');
    expect(helper).toContain('export AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}"');
    expect(helper).toContain('export AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-}"');
    expect(helper).toContain('export AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}"');
    expect(helper).toContain('export AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}"');
    expect(helper).toContain('export AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN:-}"');
    expect(helper).toContain('timeout "${probe_shell_timeout}" \\');
    expect(helper).not.toContain('timeout "${probe_shell_timeout}" env "${probe_env[@]}"');
    expect(helper).not.toContain('env "${probe_env[@]}"');
    expect(helper).toContain('node "${ROOT_DIR:-$(pwd)}/scripts/lib/afscp-read-export-probe.mjs"');
    expect(helper).toContain('gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "afscp_read_export_probe"');
    expect(prepareRuntimeFunction).toContain('internal_real_gate_probe_afscp_read_export || return 1');
    expect(prepareRuntimeFunction.indexOf('ensure_internal_afscp_local_runtime')).toBeLessThan(
      prepareRuntimeFunction.indexOf('internal_real_gate_probe_afscp_read_export || return 1'),
    );
    expect(prepareRuntimeFunction.indexOf('internal_real_gate_probe_afscp_read_export || return 1')).toBeLessThan(
      prepareRuntimeFunction.indexOf('internal_real_gate_write_sandbox_config'),
    );
    expect(helper).not.toContain('start-cleaner');
    expect(helper).not.toContain('stop-cleaner');
    expect(helper).not.toContain('with-cleaner');
    expect(helper).not.toContain('sandbox-cleaner');
    expect(helper).toContain('rebuild_runner_base_image="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}"');
    expect(helper).toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "${rebuild_runner_base_image}" "1"',
    );
    expect(helper).not.toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "0" "1"',
    );

    expect(agentTaskGate).toContain('ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\');
    expect(agentTaskGate).not.toContain('start-cleaner');
    expect(agentTaskGate).not.toContain('stop-cleaner');
    expect(agentTaskGate).not.toContain('with-cleaner');
    expect(agentTaskGate).not.toContain('cleaner_log');
    expect(agentTaskGate).not.toContain('sandbox-cleaner');
    expect(agentTaskGate).toContain('ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(agentTaskGate).toContain('AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}" \\');
    expect(agentTaskGate).toContain('AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \\');
    expect(agentTaskGate).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=');
    expect(agentTaskGate).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT=');
    expect(agentTaskGate).not.toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE=');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \\');
    expect(agentTaskGate).toContain(
      'INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \\',
    );
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \\');

    expect(reclaimSpec).toContain('deleteInternalWorkloadViaAsbcp');
    expect(secondRunIndex).toBeGreaterThanOrEqual(0);
    expect(secondOutcomeIndex).toBeGreaterThan(secondRunIndex);
    expect(asbcpRestartIndex).toBeGreaterThan(secondOutcomeIndex);
    expect(reclaimSpec).not.toContain('start-cleaner');
    expect(reclaimSpec).not.toContain('stop-cleaner');
    expect(reclaimSpec).not.toContain('run-cleaner-once');
    expect(developmentGuide).not.toContain('sandbox-cleaner');
  });

  it('starts the internal Agent Task gate without duplicating AFSCP stop before reset', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const startupBlock = sectionBetween(
      agentTaskGate,
      '\ntrap cleanup EXIT\n',
      '\ngate_record_preflight_check "${INTERNAL_REAL_DIR}" "kind_cluster"',
    );
    const resetFunction = sectionBetween(
      agentTaskGate,
      '\nreset_internal_afscp_local_runtime() {',
      '\n}\n\nrecord_service()',
    );
    const kindResetBootstrapFunction = sectionBetween(
      agentTaskGate,
      '\nensure_internal_kind_cluster_for_afscp_reset() {',
      '\n}\n\nreset_internal_afscp_local_runtime()',
    );
    const cleanupFunction = sectionBetween(
      agentTaskGate,
      '\ncleanup() {',
      '\n}\ntrap cleanup EXIT',
    );

    expect(startupBlock).not.toContain('\nstop_internal_afscp_local_runtime\n');
    expect(startupBlock.match(/\nensure_internal_kind_cluster_for_afscp_reset\n/g) ?? []).toHaveLength(1);
    expect(startupBlock.match(/\nreset_internal_afscp_local_runtime\n/g) ?? []).toHaveLength(1);
    expect(startupBlock.indexOf('\nensure_internal_kind_cluster_for_afscp_reset\n')).toBeLessThan(
      startupBlock.indexOf('\nreset_internal_afscp_local_runtime\n'),
    );
    expect(resetFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
    expect(resetFunction).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(resetFunction.indexOf('stop_internal_afscp_local_runtime')).toBeLessThan(
      resetFunction.indexOf('reset_owned_afscp_local_runtime_for_gate'),
    );
    expect(kindResetBootstrapFunction).toContain('internal_real_gate_require_host_tools');
    expect(kindResetBootstrapFunction).toContain('internal_real_gate_ensure_kind_cluster');
    expect(cleanupFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
  });

  it('lets internal AFSCP ensure use gate-owned deps without shared substrate connection env', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const ensureFunction = sectionBetween(
      agentTaskGate,
      '\nensure_internal_afscp_local_runtime() {',
      '\n}\n\nstop_internal_afscp_local_runtime()',
    );
    const resetFunction = sectionBetween(
      agentTaskGate,
      '\nreset_internal_afscp_local_runtime() {',
      '\n}\n\nrecord_service()',
    );

    expect(ensureFunction).toContain('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1');
    expect(resetFunction).toContain('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1');
    expect(ensureFunction).toContain('export PATH="${INTERNAL_REAL_DIR}/bin:${PATH}"');
    expect(ensureFunction).toContain('export LD_LIBRARY_PATH="${INTERNAL_REAL_DIR}/bin/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"');
    expect(ensureFunction).toContain('AFSCP_JUICEFS_OUTPUT_PATH="${INTERNAL_REAL_DIR}/bin/juicefs"');
    expect(ensureFunction).toContain('bash "${ROOT_DIR}/scripts/afscp-jvs-image-smoke.sh"');
    expect(ensureFunction.indexOf('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1')).toBeLessThan(
      ensureFunction.indexOf('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"'),
    );
    expect(ensureFunction.indexOf('AFSCP_JUICEFS_OUTPUT_PATH="${INTERNAL_REAL_DIR}/bin/juicefs"')).toBeLessThan(
      ensureFunction.indexOf('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"'),
    );
  });

  it('allocates isolated ports for nested Context Store specs without cleaning unowned dev servers', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(agentTaskGate).toContain('resolve_internal_spec_port_pair()');
    expect(agentTaskGate).toContain('prepare_internal_spec_port_pair()');
    expect(agentTaskGate).toContain('backend_real_gate_cleanup_listener "${web_port}" web || return 1');
    expect(agentTaskGate).toContain('INTERNAL_REAL_SPEC_WEB_PORT_BASE:-33000');
    expect(agentTaskGate).toContain('preferred ports api=${preferred_api_port} web=${preferred_web_port} unavailable');
    expect(agentTaskGate).toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members|task context stays private to the task owner within the same workspace" 23079 33079',
    );
    expect(agentTaskGate).not.toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members" 20079 3101',
    );
    expect(agentTaskGate).not.toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "task context stays private to the task owner within the same workspace" 20080 3041',
    );
  });

  it('writes only non-sensitive AFSCP ASBCP identity into isolated sandbox state instead of raw tokens', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const state = renderSandboxState({
      AFSCP_INTERNAL_BASE_URL: 'http://formal-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_TOKEN: 'formal-orchestrator-token',
      AFSCP_CALLER_SERVICE: 'formal-asbcp',
      AFSCP_ACTOR_TYPE: 'service',
      AFSCP_ACTOR_ID: 'formal-sandbox-actor',
      AFSCP_BASE_URL: 'http://legacy-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN: 'legacy-orchestrator-token',
    });

    expect(state).toContain('AFSCP_INTERNAL_BASE_URL="http://formal-afscp.internal:28090"');
    expect(state).toContain('AFSCP_CALLER_SERVICE="formal-asbcp"');
    expect(state).toContain('AFSCP_ACTOR_TYPE="service"');
    expect(state).toContain('AFSCP_ACTOR_ID="formal-sandbox-actor"');
    expect(state).toMatch(/KUBECONFIG=".*\/home\/agentsmith\/local-kind\/kind-agentsmith\.kubeconfig"/u);
    expect(state).toContain('ASBCP_SERVICE_KEY_FINGERPRINT="sha256:');
    expect(state).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="sha256:');
    expect(state).not.toContain('ASBCP_SERVICE_KEY_VALUE=');
    expect(state).not.toContain('sandbox-service-key');
    expect(state).not.toContain('AFSCP_ORCHESTRATOR_TOKEN="formal-orchestrator-token"');
    expect(state).not.toContain('AFSCP_ORCHESTRATOR_SERVICE_TOKEN="formal-orchestrator-token"');
    expect(state).not.toContain('legacy-orchestrator-token');
    expect(state).not.toContain('CLEANER_');
    expect(state).not.toContain('sandbox-cleaner');
    expect(helper).not.toMatch(/^afscp:\s*$/mu);
  });

  it('fails direct managed Agent Task run-integration usage before Playwright when ASBCP env is missing', () => {
    const integrationGate = read('scripts/run-integration-e2e-full.sh');

    expect(integrationGate).toContain('preflight_managed_agent_task_asbcp_env');
    expect(integrationGate).toContain('managed_agent_task_asbcp_env');
    expect(integrationGate).toContain('Managed Agent Task backend-real coverage requires ASBCP bootstrap');
    expect(integrationGate).toContain('agent-task-backend-real-runner|e2e/integration-agent-task-runner.spec.ts|e2e/integration-visual-review.spec.ts');
    expect(integrationGate).toContain("grep -q 'startAgentTaskRunViaApi'");
  });

  it('runs backend-real core internal coverage through one composite managed Agent Task producer with batched greps', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');
    const skillsFunction = shellFunctionBody(agentTaskGate, 'run_skills_runtime_specs');
    const compositeFunction = shellFunctionBody(agentTaskGate, 'run_core_composite_specs');

    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--core-composite" ]]');
    expect(agentTaskGate).toContain('running internal agent-task core composite real integration');
    expect(backendRealRun).toContain('bash scripts/run-internal-agent-task-real-gate.sh --core-composite');

    expect(skillsFunction.match(/run_internal_spec_grep e2e\/integration-agent-task-runner\.spec\.ts/g) ?? []).toHaveLength(1);
    expect(skillsFunction.match(/run_internal_spec_grep e2e\/integration-context-store-isolation\.spec\.ts/g) ?? []).toHaveLength(1);
    expect(skillsFunction).toContain(
      'reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner'
      + '|writes task context through mbos-context and persists it for the task owner'
      + '|keeps provider-neutral projection smoke on mbos-context without projected dependencies'
      + '|reads task context through mbos-context inside a real Agent Task terminal session resolved by the default Agent Runner'
      + '|rejects shared workspace context writes inside a real Agent Task terminal session resolved by the default Agent Runner',
    );
    expect(skillsFunction).toContain(
      'member context stays private between workspace members'
      + '|task context stays private to the task owner within the same workspace',
    );
    expect(skillsFunction.match(/reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner/g) ?? [])
      .toHaveLength(1);

    expect(compositeFunction).toContain('run_skills_runtime_specs "${API_PORT}" "${WEB_PORT}"');
    expect(compositeFunction).toContain('run_internal_reclaim_spec "$((API_PORT + 1))" "$((WEB_PORT + 1))"');
    expect(compositeFunction).not.toContain('run_internal_workspace_specs');
  });

  it('collects child internal evidence on failed internal specs without replacing scenario failure classification', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const collector = sectionBetween(
      agentTaskGate,
      '\ncollect_child_internal_failure_evidence() {',
      '\n}\n\nrecord_child_internal_spec_failure()',
    );
    const dockerCollector = sectionBetween(
      agentTaskGate,
      '\ncollect_asbcp_docker_log_evidence() {',
      '\n}\n\ncollect_child_internal_failure_evidence()',
    );
    const logTailCollector = sectionBetween(
      agentTaskGate,
      '\ncollect_child_internal_log_tails() {',
      '\n}\n\ncollect_child_internal_runtime_flake_evidence()',
    );
    const runtimeFlakeCollector = sectionBetween(
      agentTaskGate,
      '\ncollect_child_internal_runtime_flake_evidence() {',
      '\n}\n\ncollect_child_internal_failure_evidence()',
    );
    const runtimeDetailsCollector = sectionBetween(
      agentTaskGate,
      '\ncollect_runtime_readiness_details() {',
      '\n}\n\nannotate_runtime_readiness_details()',
    );
    const runtimeSummaryCollector = sectionBetween(
      agentTaskGate,
      '\ncollect_runtime_readiness_summary() {',
      '\n}\n\nruntime_readiness_flake_markers_present()',
    );
    const evidenceCommand = sectionBetween(
      agentTaskGate,
      '\nrun_child_internal_evidence_command() {',
      '\n}\n\ncollect_asbcp_docker_log_evidence()',
    );
    const redaction = sectionBetween(
      agentTaskGate,
      '\nredact_child_internal_known_values() {',
      '\n}\n\nrun_child_internal_evidence_command()',
    );
    const recorder = sectionBetween(
      agentTaskGate,
      '\nrecord_child_internal_spec_failure() {',
      '\n}\n\nif [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]',
    );
    const runSpecFunction = shellFunctionBody(agentTaskGate, 'run_internal_spec');
    const grepFunction = shellFunctionBody(agentTaskGate, 'run_internal_spec_grep');
    const reclaimFunction = shellFunctionBody(agentTaskGate, 'run_internal_reclaim_spec');
    const workspaceFunction = shellFunctionBody(agentTaskGate, 'run_internal_workspace_specs');
    const evidenceSurface = `${collector}\n${dockerCollector}\n${evidenceCommand}\n${logTailCollector}`;

    expect(agentTaskGate).toContain('CHILD_INTERNAL_EVIDENCE_ROOT="${INTERNAL_REAL_DIR}/child-internal-evidence"');
    expect(agentTaskGate).toContain('CHILD_INTERNAL_EVIDENCE_ROOT="$(dirname "$(realpath -m "${RELEASE_REAL_READY_LOG_DIR}")")/child-internal-evidence"');
    expect(collector).toContain('evidence_dir="${CHILD_INTERNAL_EVIDENCE_ROOT}/${safe_stage:-child-spec}"');
    expect(logTailCollector).toContain('log-tails.txt');
    expect(logTailCollector).toContain('afscp-api.log');
    expect(logTailCollector).toContain('afscp-worker.log');
    expect(logTailCollector).toContain('afscp-export-gateway.log');
    expect(logTailCollector).toContain('afscp-read-export-probe.log');
    expect(collector).toContain('collect_afscp_child_evidence "${evidence_dir}"');
    expect(agentTaskGate).toContain('collect_afscp_child_runtime_fingerprint()');
    expect(agentTaskGate).toContain('afscp-runtime-fingerprint.txt');
    expect(agentTaskGate).toContain('afscp-api-log-tail.txt');
    expect(agentTaskGate).toContain('afscp-worker-log-tail.txt');
    expect(agentTaskGate).toContain('afscp-export-gateway-log-tail.txt');
    for (const runtimeCollector of [runtimeDetailsCollector, runtimeSummaryCollector]) {
      expect(runtimeCollector).toContain('"${evidence_dir}/afscp-api-log-tail.txt"');
      expect(runtimeCollector).toContain('"${evidence_dir}/afscp-worker-log-tail.txt"');
      expect(runtimeCollector).toContain('"${evidence_dir}/asbcp-docker-logs.txt"');
    }
    expect(collector).toContain('exit_status=%s');
    expect(collector).toContain('spec=%s');
    expect(collector).toContain('grep_label=%s');
    expect(collector).toContain('api_port=%s');
    expect(collector).toContain('web_port=%s');
    expect(collector).toContain('collect_asbcp_docker_log_evidence "${evidence_dir}/asbcp-docker-logs.txt" "${child_asbcp_container_ref}"');
    expect(runtimeFlakeCollector).toContain('classification=runtime_flake');
    expect(runtimeFlakeCollector).toContain('focused_gate_passed_after_runtime_readiness_marker');
    expect(runtimeFlakeCollector).toContain('runtime-flake-summary.txt');
    expect(runtimeFlakeCollector).toContain('collect_runtime_readiness_summary "${evidence_dir}" "${spec_state_file}"');
    expect(runtimeFlakeCollector).toContain('gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${safe_stage:-child-spec}_runtime_flake" "warning"');
    expect(runtimeDetailsCollector).toContain("errorCode === 'AGENT_SANDBOX_UNAVAILABLE'");
    expect(runtimeDetailsCollector).toContain("signal.phase = 'unknown';");
    expect(runSpecFunction).toContain('spec_output_log="${spec_log_dir}/playwright-output.log"');
    expect(runSpecFunction).toContain('mkdir -p "${spec_log_dir}"');
    expect(runSpecFunction).toContain(') 2>&1 | tee "${spec_output_log}"');
    expect(runSpecFunction).toContain('return "${PIPESTATUS[0]}"');
    expect(collector).toContain('kubectl --request-timeout=15s get pods -n "${child_namespace}" -o wide');
    expect(collector).not.toContain('describe pods');
    expect(collector).not.toContain('k8s-pods-describe.txt');
    expect(evidenceSurface).not.toMatch(/\bkubectl\b[^\n]*\bdescribe\b/);
    expect(evidenceSurface).not.toMatch(/\bkubectl\b[^\n]*\bget\s+secrets?\b/);
    expect(evidenceSurface).not.toMatch(/\s-o\s+ya?ml(?:\s|$|["'])/);
    expect(evidenceSurface).not.toMatch(/\s-o\s+json(?:\s|$|["'])/);
    expect(evidenceSurface).not.toContain('printenv');
    expect(collector).toContain('"${evidence_dir}/k8s-pod-status.txt"');
    expect(collector).toContain('.status.containerStatuses');
    expect(collector).toContain('.status.initContainerStatuses');
    expect(collector).toContain('kubectl --request-timeout=15s get events -n "${child_namespace}" --sort-by=.metadata.creationTimestamp');
    expect(collector).toContain('kubectl command is not available; pod list evidence was not collected.');
    expect(collector).toContain('kubectl command is not available; pod status evidence was not collected.');
    expect(evidenceCommand).toContain('| redact_child_internal_evidence | tail -n "${max_lines}"');
    expect(dockerCollector).toContain('docker command is not available; ASBCP docker logs were not collected.');
    expect(dockerCollector).toContain('ASBCP container id/name could not be resolved; docker logs were not collected.');
    expect(dockerCollector).toContain('docker logs --tail');
    expect(redaction).toContain('redact_child_internal_known_values | redact_child_internal_secret_patterns');
    expect(redaction).toContain('secret_name_pattern');
    expect(redaction).toContain('api[_-]?key');
    expect(redaction).toContain('([[:alnum:]_]+[_-])?key');
    expect(redaction).toContain('token');
    expect(redaction).toContain('password');
    expect(redaction).toContain('authorization');
    expect(redaction).toContain('bearer');
    expect(redaction).toContain('basic');
    expect(redaction).toContain('sk-');
    expect(redaction).toContain('[[:space:]]*[:=]');
    expect(redaction).toContain('[REDACTED]');

    const failureRecord = 'gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "${stage}" "${message}"';
    const evidenceCollect = 'collect_child_internal_failure_evidence "${stage}" "${spec_state_file}" "${message}" "${exit_status}" "${spec}" "${label}" "${spec_api_port}" "${spec_web_port}" || true';
    expect(recorder).toContain(failureRecord);
    expect(recorder).toContain(evidenceCollect);
    expect(recorder.indexOf(failureRecord)).toBeLessThan(recorder.indexOf(evidenceCollect));

    expect(agentTaskGate).toContain('internal_spec_evidence_stage()');
    expect(grepFunction).toContain(
      'record_child_internal_spec_failure "${evidence_stage}" "${spec} failed before Playwright: unable to resolve isolated ports for preferred api=${preferred_api_port} web=${preferred_web_port}" "" "${spec_status}" "${spec}" "${label}" "${preferred_api_port}" "${preferred_web_port}"',
    );
    expect(grepFunction).toContain(
      'record_child_internal_spec_failure "${evidence_stage}" "${spec} failed before Playwright: internal ASBCP spec runtime setup failed with status ${spec_status}" "${spec_state_file}" "${spec_status}" "${spec}" "${label}" "${spec_api_port}" "${spec_web_port}"',
    );
    expect(grepFunction).toContain(
      'record_child_internal_spec_failure "${evidence_stage}" "${spec} failed with status ${spec_status}" "${spec_state_file}" "${spec_status}" "${spec}" "${label}" "${spec_api_port}" "${spec_web_port}"',
    );
    expect(grepFunction).toContain(
      'collect_child_internal_runtime_flake_evidence "${evidence_stage}" "${spec_state_file}" "${spec}" "${label}" "${spec_api_port}" "${spec_web_port}" || true',
    );
    expect(reclaimFunction).toContain(
      'record_child_internal_spec_failure "reclaim_spec" "integration-internal-sandbox-reclaim failed with status ${reclaim_status}" "${reclaim_state_file}"',
    );
    expect(workspaceFunction).toContain(
      'record_child_internal_spec_failure "workspace_spec" "integration-agent-task-runner failed with status ${workspace_status}" "${workspace_state_file}"',
    );
    expect(agentTaskGate).toContain(
      'record_child_internal_spec_failure "visual_review_spec" "integration-visual-review failed with status ${VISUAL_REVIEW_STATUS}" "${VISUAL_REVIEW_STATE_FILE}"',
    );
  });

  it('redacts child internal evidence headers and secret key-value output at runtime', () => {
    const rawSecrets = [
      'QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      'bearer-token-secret',
      'case-basic-secret',
      'plain-token-value',
      'plain-password-value',
      'plain-api-key-value',
      'sk-live-raw-secret123456',
      'known-asbcp-secret',
      'known-product-token',
      'known-bootstrap-token',
      'known-orchestrator-token',
      'sk-known-provider-secret',
    ];
    const input = [
      `Authorization: Basic ${rawSecrets[0]}`,
      `authorization :   bearer ${rawSecrets[1]}`,
      `AUTHORIZATION: BASIC ${rawSecrets[2]}`,
      `token=${rawSecrets[3]}`,
      `password = "${rawSecrets[4]}"`,
      `service_api_key: '${rawSecrets[5]}'`,
      `PRESET_ENDPOINT_API_KEY=${rawSecrets[6]}`,
      `known values ${rawSecrets[7]} ${rawSecrets[8]} ${rawSecrets[9]} ${rawSecrets[10]} ${rawSecrets[11]}`,
    ].join('\n');

    const result = runChildInternalEvidenceRedactorHarness(`${input}\n`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    for (const rawSecret of rawSecrets) {
      expect(result.stdout).not.toContain(rawSecret);
    }
    expect(result.stdout).toContain('Authorization: Basic [REDACTED]');
    expect(result.stdout).toContain('authorization :   bearer [REDACTED]');
    expect(result.stdout).toContain('AUTHORIZATION: BASIC [REDACTED]');
    expect(result.stdout).toContain('token=[REDACTED]');
    expect(result.stdout).toContain('password = [REDACTED]');
    expect(result.stdout).toContain('service_api_key: [REDACTED]');
    expect(result.stdout).toContain('PRESET_ENDPOINT_API_KEY=[REDACTED]');
  });

  it('records Files restore continuation clean-pass runtime readiness evidence for Product Readiness', () => {
    const result = runInternalSpecGrepCleanPassHarness();

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json');

    const details = JSON.parse(result.runtimeReadinessDetails) as {
      schema_version: string;
      theme: string;
      convergence_policy?: { backoff?: string; interval_ms?: number[] };
      classification_rules?: Record<string, string>;
      outcome: string;
      classification: string;
      stage: string;
      gate_mode: string;
      spec: string;
      grep_label: string;
      api_port: string;
      web_port: string;
      signals: unknown[];
      call_summaries: unknown[];
      k8s_pods: unknown[];
    };
    expect(details).toMatchObject({
      schema_version: 'agentsmith.runtime-readiness-details/v1',
      theme: 'runtime_pending_readiness',
      outcome: 'focused_gate_passed',
      classification: 'clean_pass',
      stage: 'files_restore_continuation_spec',
      gate_mode: 'files-restore-continue',
      spec: 'e2e/integration-files-user-stories.spec.ts',
      grep_label: 'same task can continue after Files restore',
      api_port: '21020',
      web_port: '3121',
      signals: [],
      call_summaries: [],
      k8s_pods: [],
    });
    expect(details.convergence_policy).toMatchObject({
      backoff: 'increasing_after_consecutive_non_terminal',
      interval_ms: [60_000, 90_000, 120_000, 180_000, 300_000],
    });
    expect(details.classification_rules?.runtime_flake).toContain('passed on rerun');
    expect(details.classification_rules?.stability_blocker).toContain('consecutive');
  });

  it('records focused runtime readiness flake classification in runtime readiness JSON', () => {
    const result = runInternalSpecGrepCleanPassHarness({ runtimeMarker: true });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/runtime-flake-summary.txt');

    const details = JSON.parse(result.runtimeReadinessDetails) as {
      schema_version: string;
      theme: string;
      outcome: string;
      classification: string;
      convergence_policy?: { state_convergence?: Record<string, unknown> };
      classification_rules?: Record<string, string>;
      signals: Array<{ source: string; error_code?: string }>;
      call_summaries: Array<{ source: string; error_code?: string }>;
    };
    expect(details).toMatchObject({
      schema_version: 'agentsmith.runtime-readiness-details/v1',
      theme: 'runtime_pending_readiness',
      outcome: 'focused_gate_passed_after_runtime_readiness_marker',
      classification: 'runtime_flake',
    });
    expect(Object.keys(details.convergence_policy?.state_convergence ?? {}).sort()).toEqual([
      'afscp_workspace_binding',
      'agent_task_sandbox',
      'files',
      'read_export',
    ]);
    expect(details.classification_rules?.runtime_flake).toContain('passed on rerun');
    expect(details.call_summaries).toEqual(details.signals);
    expect(details.call_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'api', error_code: 'AGENT_SANDBOX_UNAVAILABLE' }),
      expect.objectContaining({ source: 'pod_manager', error_code: 'AGENT_SANDBOX_UNAVAILABLE' }),
      expect.objectContaining({ source: 'asbcp_create_status', error_code: 'AGENT_SANDBOX_UNAVAILABLE' }),
    ]));
  });

  it('records files restore continuation early failures into the campaign-uploadable child evidence root', () => {
    const result = runInternalSpecGrepEarlyFailureHarness();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status_1=1');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/summary.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/afscp-api-log-tail.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/asbcp-docker-logs.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/k8s-pod-status.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/k8s-events.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/afscp-runtime-fingerprint.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-summary.txt');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json');
    expect(result.summary).toContain('stage=files_restore_continuation_spec');
    expect(result.summary).toContain('gate_mode=files-restore-continue');
    expect(result.summary).toContain('spec=e2e/integration-files-user-stories.spec.ts');
    expect(result.summary).toContain('grep_label=same task can continue after Files restore');
    expect(result.summary).toContain('exit_status=1');
    expect(result.summary).toContain('api_port=21020');
    expect(result.summary).toContain('web_port=3121');
    expect(result.summary).toContain('/upload/child-internal-evidence/files_restore_continuation_spec');
    expect(result.internalFailure).toContain('scenario_assertion_failed|files_restore_continuation_spec|e2e/integration-files-user-stories.spec.ts failed before Playwright');
    expect(result.internalChildEvidenceExists).toBe(false);
    expect(result.afscpApiLogTail).toContain('AFSCP API');
    expect(result.afscpApiLogTail).toContain('api ready token=[REDACTED]');
    expect(result.afscpApiLogTail).not.toContain('known-product-token');
    expect(result.asbcpDockerLogs).toContain('$ docker logs --tail');
    expect(result.asbcpDockerLogs).toContain('docker unavailable in harness');
    expect(result.k8sPodStatus).toContain('kubectl --request-timeout=15s get pods');
    expect(result.k8sPodStatus).toContain('kubectl unavailable in harness');
    expect(result.k8sEvents).toContain('kubectl --request-timeout=15s get events');
    expect(result.k8sEvents).toContain('kubectl unavailable in harness');
    expect(result.afscpRuntimeFingerprint).toContain('afscp_api_port=30090');
    expect(result.afscpRuntimeFingerprint).toContain('afscp_export_gateway_port=30091');
    expect(result.afscpRuntimeFingerprint).toContain('afscp_default_volume_id=vol_internal_probe');
    expect(result.afscpRuntimeFingerprint).toContain('afscp_api_container=agentsmith-afscp-local-30090-api');
    expect(result.runtimeReadinessSummary).toContain('theme=runtime_pending_readiness');
    expect(result.runtimeReadinessSummary).toContain('classification_hint=');
    expect(result.runtimeReadinessSummary).toContain('AGENT_SANDBOX_RATE_LIMITED');
    expect(result.runtimeReadinessSummary).toContain('completed_release_fence -> same_task_owner_rebind');
    expect(result.runtimeReadinessSummary).toContain('api ready token=[REDACTED]');
    expect(result.runtimeReadinessSummary).toContain('API call summary request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending error_code=AGENT_SANDBOX_UNAVAILABLE token=[REDACTED]');
    expect(result.runtimeReadinessSummary).toContain('pod manager create_or_ensure_pod request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending error_code=AGENT_SANDBOX_UNAVAILABLE');
    expect(result.runtimeReadinessSummary).toContain('ASBCP create/status summary request_id=req-runtime-1 workload_id=workload-runtime-1 phase=pending status_code=503 error_code=AGENT_SANDBOX_UNAVAILABLE');
    expect(result.runtimeReadinessSummary).toContain('===== k8s pod status =====');
    expect(result.runtimeReadinessSummary).toContain('===== k8s events tail =====');
    expect(result.runtimeReadinessSummary).not.toContain('known-product-token');
    type RuntimeReadinessSignal = {
      source: string;
      request_id?: string;
      workload_id?: string;
      phase?: string;
      status_code?: string;
      status?: string;
      http_status?: string;
      error_code?: string;
      asbcp_code?: string;
      retryable?: string;
      call?: string;
      line?: string;
    };
    const details = JSON.parse(result.runtimeReadinessDetails) as {
      schema_version: string;
      theme: string;
      signals: RuntimeReadinessSignal[];
    };
    expect(details.schema_version).toBe('agentsmith.runtime-readiness-details/v1');
    expect(details.theme).toBe('runtime_pending_readiness');
    expect(details.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'api',
        request_id: 'req-runtime-1',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'create_or_ensure_pod',
        request_id: 'req-runtime-1',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        request_id: 'req-runtime-1',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        status_code: '503',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
      }),
      expect.objectContaining({
        source: 'api',
        request_id: 'release:begin:req-runtime-json',
        workload_id: 'workload-runtime-1',
        phase: 'unknown',
        status_code: '502',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        call: 'delete_pod',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'delete_pod',
        request_id: 'req-runtime-json-step',
        workload_id: 'workload-runtime-1',
        phase: 'unknown',
        status_code: '502',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        asbcp_code: 'dependency_failure',
        retryable: 'true',
      }),
      expect.objectContaining({
        source: 'api',
        call: 'delete_pod',
        request_id: 'req-runtime-json-api-trace',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        status_code: '502',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        asbcp_code: 'dependency_failure',
        retryable: 'true',
      }),
      expect.objectContaining({
        source: 'pod_manager',
        call: 'delete_pod',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        status_code: '502',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        asbcp_code: 'dependency_failure',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        call: 'delete_pod',
        request_id: 'req-runtime-json-asbcp-summary',
        workload_id: 'workload-runtime-1',
        phase: 'pending',
        status_code: '502',
        error_code: 'AGENT_SANDBOX_UNAVAILABLE',
        asbcp_code: 'dependency_failure',
        retryable: 'true',
      }),
      expect.objectContaining({
        source: 'asbcp_create_status',
        request_id: 'req-runtime-status',
        workload_id: 'workload-runtime-1',
        http_status: '200',
        status: 'offline',
        phase: 'offline',
        error_code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
      }),
    ]));
    expect(result.runtimeReadinessDetails).not.toContain('known-product-token');
  });

  it('upgrades consecutive focused runtime readiness failures to a stability blocker', () => {
    const result = runInternalSpecGrepEarlyFailureHarness({ runs: 2 });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status_1=1');
    expect(result.stdout).toContain('status_2=1');
    expect(result.stdout).toContain('/upload/child-internal-evidence/files_restore_continuation_spec/runtime-stability-blocker-summary.txt');
    expect(result.internalFailure).toContain('scenario_assertion_failed|files_restore_continuation_spec|e2e/integration-files-user-stories.spec.ts failed before Playwright');
    expect(result.internalFailure).toContain('stability_blocker|files_restore_continuation_spec_runtime_readiness|consecutive focused gate runtime readiness failures');
    expect(result.runtimeStabilityBlockerSummary).toContain('classification=stability_blocker');
    expect(result.runtimeStabilityBlockerSummary).toContain('outcome=consecutive_focused_gate_runtime_readiness_failures');
    expect(result.runtimeStabilityBlockerSummary).toContain('stage=files_restore_continuation_spec');
    expect(result.runtimeStabilityBlockerSummary).toContain('previous_failure_marker=');
    expect(result.runtimeStabilityBlockerSummary).not.toContain('known-product-token');

    const details = JSON.parse(result.runtimeReadinessDetails) as {
      classification?: string;
      outcome?: string;
      convergence_policy?: { backoff?: string };
      classification_rules?: Record<string, string>;
    };
    expect(details).toMatchObject({
      classification: 'stability_blocker',
      outcome: 'consecutive_focused_gate_runtime_readiness_failures',
    });
    expect(details.convergence_policy?.backoff).toBe('increasing_after_consecutive_non_terminal');
    expect(details.classification_rules?.stability_blocker).toContain('consecutive');
  });

  it('fails skills-runtime fast when managed runner image env is explicitly provided', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const skillsWrapper = read('scripts/skills-runtime-backend-real-gate.sh');

    expect(helper).toContain('[[ -n "${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTEGRATION_INTERNAL_AGENT_IMAGE")');
    expect(helper).toContain('[[ -n "${INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTERNAL_AGENT_IMAGE")');
    expect(helper).toContain('[[ -n "${MANAGED_RUNNER_IMAGE:-}" ]] && explicit_image_env+=("MANAGED_RUNNER_IMAGE")');
    expect(helper).toContain('unset them, or use --runner-projection-smoke for release-locked image coverage');
    expect(agentTaskGate).not.toContain('--skills-runtime ignores managed runner image env');
    expect(agentTaskGate).not.toContain('unset INTEGRATION_INTERNAL_AGENT_IMAGE INTERNAL_AGENT_IMAGE MANAGED_RUNNER_IMAGE');
    expect(skillsWrapper).toContain('exit 1');
    expect(skillsWrapper).not.toContain('unset INTEGRATION_INTERNAL_AGENT_IMAGE INTERNAL_AGENT_IMAGE MANAGED_RUNNER_IMAGE');
    expect(skillsWrapper).toContain('unset them, or use --runner-projection-smoke for release-locked image coverage');
  });

  it('prepares a local kind registry digest handoff for non-projection internal gates', () => {
    const repoRoot = process.cwd();
    const runnerDigest = `sha256:${'f'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$(mktemp)"
          trap 'rm -f "$calls_file"' EXIT
          internal_real_gate_publish_local_runner_image_ref() {
            printf 'publish %s\\n' "$1" >> "$calls_file"
            printf 'kind-registry:5000/mbos/agentsmith-managed-runner@%s\\n' "$RUNNER_DIGEST"
          }
          internal_real_gate_preflight_kind_registry_runner_image() {
            printf 'preflight %s\\n' "$1" >> "$calls_file"
          }
          GATE_MODE=core-composite
          RUNNER_IMAGE=agentsmith-managed-runner:local
          internal_real_gate_prepare_managed_runner_image_handoff
          printf 'runner=%s\\n' "$RUNNER_IMAGE"
          cat "$calls_file"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RUNNER_DIGEST: runnerDigest,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const prepareRuntime = sectionBetween(
      helper,
      '\nprepare_internal_backend_real_gate_runtime() {',
      '\n}\n\nprepare_internal_backend_real_spec_runtime()',
    );

    expect(output).toContain(`runner=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(output).toContain('publish agentsmith-managed-runner:local');
    expect(output).toContain(`preflight kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(output).not.toContain('agentsmith-agent-task-runner:local');
    expect(prepareRuntime).toContain('internal_real_gate_prepare_managed_runner_image_handoff');
    expect(prepareRuntime.indexOf('internal_real_gate_prepare_managed_runner_image_handoff')).toBeLessThan(
      prepareRuntime.indexOf('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"'),
    );
  });

  it('rejects legacy agent-task-runner digest refs before child specs inherit the image', () => {
    const repoRoot = process.cwd();
    const legacyDigestRef = `agentsmith-agent-task-runner@sha256:${'1'.repeat(64)}`;
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          internal_real_gate_publish_local_runner_image_ref() {
            printf 'publish %s\\n' "$1"
          }
          internal_real_gate_preflight_kind_registry_runner_image() {
            printf 'preflight %s\\n' "$1"
          }
          GATE_MODE=core-composite
          RUNNER_IMAGE="$LEGACY_DIGEST_REF"
          internal_real_gate_prepare_managed_runner_image_handoff
          printf 'child-spec RUNNER_IMAGE=%s\\n' "$RUNNER_IMAGE"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          LEGACY_DIGEST_REF: legacyDigestRef,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('child-spec RUNNER_IMAGE=');
    expect(result.stdout).not.toContain('preflight ');
    expect(result.stdout).not.toContain('publish ');
    expect(result.stderr).toContain('must not reference old agent-task-runner image/path');
    expect(result.stderr).toContain(legacyDigestRef);
  });

  it('rejects legacy runner image refs before prepare runtime can reuse, build, inspect, or hand off', () => {
    const cases = [
      {
        legacyRef: 'agentsmith-agent-task-runner:local',
        buildRunnerImage: '1' as const,
      },
      {
        legacyRef: `kind-registry:5000/mbos/agentsmith-agent-task-runner@sha256:${'1'.repeat(64)}`,
        buildRunnerImage: '0' as const,
      },
    ];

    for (const testCase of cases) {
      const result = runPrepareRuntimeWithLegacyRunnerImage(testCase);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('status=1');
      expect(result.stderr).toContain('must not reference old agent-task-runner image/path');
      expect(result.stderr).toContain(testCase.legacyRef);
      expect(result.stdout).not.toContain('call:reuse_ready');
      expect(result.stdout).not.toContain('call:build_runner_image');
      expect(result.stdout).not.toContain('call:docker image inspect');
      expect(result.stdout).not.toContain('call:publish ');
      expect(result.stdout).not.toContain('call:preflight ');
      expect(result.stdout).not.toContain('call:child_handoff');
    }
  });

  it('prints only the linux/amd64 local kind registry manifest digest ref on publish helper stdout', () => {
    const repoRoot = process.cwd();
    const indexDigest = `sha256:${'a'.repeat(64)}`;
    const amd64ManifestDigest = `sha256:${'b'.repeat(64)}`;
    const attestationDigest = `sha256:${'c'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" ]]; then
              return 0
            fi
            if [[ "$1" == "push" ]]; then
              printf 'latest: digest: %s size: 1234\\n' "$INDEX_DIGEST"
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"%s","platform":{"os":"linux","architecture":"amd64"}},{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"%s","platform":{"os":"unknown","architecture":"unknown"}}]}' "$AMD64_MANIFEST_DIGEST" "$ATTESTATION_DIGEST"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          INDEX_DIGEST: indexDigest,
          AMD64_MANIFEST_DIGEST: amd64ManifestDigest,
          ATTESTATION_DIGEST: attestationDigest,
          RUNTIME_LINE_ID: 'stdout-contract',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${amd64ManifestDigest}\n`);
  });

  it('uses the pushed single image manifest digest instead of a tag-only fallback', () => {
    const repoRoot = process.cwd();
    const rawManifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: `sha256:${'d'.repeat(64)}`,
        size: 512,
      },
      layers: [],
    });
    const expectedDigest = `sha256:${createHash('sha256').update(rawManifest).digest('hex')}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" || "$1" == "push" ]]; then
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '%s' "$RAW_MANIFEST"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RAW_MANIFEST: rawManifest,
          RUNTIME_LINE_ID: 'single-manifest-contract',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${expectedDigest}\n`);
  });

  it('fails fast when the pushed local kind registry ref has no linux/amd64 manifest digest', () => {
    const repoRoot = process.cwd();
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" ]]; then
              return 0
            fi
            if [[ "$1" == "push" ]]; then
              printf 'latest: digest: sha256:%s size: 1234\\n' "\${INDEX_DIGEST_HEX}"
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:%s","platform":{"os":"unknown","architecture":"unknown"}}]}' "\${ATTESTATION_DIGEST_HEX}"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          INDEX_DIGEST_HEX: 'a'.repeat(64),
          ATTESTATION_DIGEST_HEX: 'c'.repeat(64),
          RUNTIME_LINE_ID: 'missing-amd64-contract',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('could not resolve linux/amd64 manifest digest for managed runner image after push');
    expect(result.stderr).not.toContain('kind-registry:5000/mbos/agentsmith-managed-runner:');
  });

  it('reconciles kind registry NO_PROXY and CRI-pulls the final skills-runtime digest ref before workload start', () => {
    const repoRoot = process.cwd();
    const runnerDigestRef = `kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'e'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$(mktemp)"
          trap 'rm -f "$calls_file"' EXIT
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          kind_configure_registry_no_proxy_for_containerd() {
            printf 'no-proxy %s %s %s\\n' "$1" "$2" "$3" >> "$calls_file"
          }
          docker() {
            if [[ "$1" == "exec" && "$3" == "crictl" && "$4" == "pull" ]]; then
              printf 'cri-pull %s %s\\n' "$2" "$5" >> "$calls_file"
              return 0
            fi
            return 1
          }
          KIND_NODE_NAME="agentsmith-control-plane"
          internal_real_gate_preflight_kind_registry_runner_image "$RUNNER_DIGEST_REF"
          cat "$calls_file"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RUNNER_DIGEST_REF: runnerDigestRef,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const prepareRuntime = sectionBetween(
      helper,
      '\nprepare_internal_backend_real_gate_runtime() {',
      '\n}\n\nprepare_internal_backend_real_spec_runtime()',
    );
    const handoffFunction = sectionBetween(
      helper,
      '\ninternal_real_gate_prepare_managed_runner_image_handoff() {',
      '\n}\n\ninternal_real_gate_wait_for_afscp_storage_csi_pods()',
    );

    expect(output).toContain('no-proxy agentsmith-control-plane kind-registry 5000');
    expect(output).toContain(`cri-pull agentsmith-control-plane ${runnerDigestRef}`);
    expect(handoffFunction).toContain('internal_real_gate_preflight_kind_registry_runner_image "${RUNNER_IMAGE}"');
    expect(prepareRuntime).toContain('internal_real_gate_prepare_managed_runner_image_handoff || return 1');
    expect(prepareRuntime.indexOf('internal_real_gate_prepare_managed_runner_image_handoff || return 1')).toBeLessThan(
      prepareRuntime.indexOf('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"'),
    );
  });

  it('passes child integration specs through the parent-prepared deps/init/default-workspace boundary', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const integrationCallIndex = agentTaskGate.indexOf('bash scripts/run-integration-e2e-full.sh "${spec}" "$@"');

    expect(integrationCallIndex).toBeGreaterThanOrEqual(0);
    expect(agentTaskGate).toContain('local spec_kubeconfig');
    expect(agentTaskGate).toContain('spec_kubeconfig="$(internal_real_gate_asbcp_kubeconfig_path)"');
    expect(agentTaskGate).toContain('KUBECONFIG="${spec_kubeconfig}" \\');
    expect(agentTaskGate.indexOf('KUBECONFIG="${spec_kubeconfig}" \\')).toBeLessThan(integrationCallIndex);
    for (const assignment of [
      'INTEGRATION_BOOTSTRAP_DEPS=false \\',
      'INTEGRATION_INIT_DEPS=false \\',
      'INTEGRATION_ENSURE_DEFAULT_WORKSPACE=false \\',
    ]) {
      expect(agentTaskGate).toContain(assignment);
      expect(agentTaskGate.indexOf(assignment)).toBeLessThan(integrationCallIndex);
    }
    expect(agentTaskGate).toContain('ensure_internal_default_workspace_for_afscp');
  });

  it('routes backend-real visual review through the shared internal sandbox bootstrap', () => {
    const visualWrapper = read('scripts/backend-real-visual-review.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(visualWrapper).toContain('bash scripts/run-internal-agent-task-real-gate.sh --visual-review');
    expect(visualWrapper).toContain('INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${ARTIFACT_DIR}"');
    expect(visualWrapper).toContain('export NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE:-validation}"');
    expect(visualWrapper).toContain('NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE}"');
    expect(visualWrapper).not.toContain('bash scripts/run-integration-e2e-full.sh e2e/integration-visual-review.spec.ts');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--visual-review" ]]');
    expect(agentTaskGate).toContain('running backend-real visual review with internal managed Agent Task sandbox');
    expect(agentTaskGate).toContain('run_internal_spec e2e/integration-visual-review.spec.ts "${API_PORT}" "${WEB_PORT}" "${VISUAL_REVIEW_STATE_FILE}"');
    expect(agentTaskGate).toContain('RELEASE_REAL_VISUAL_ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${INTERNAL_VISUAL_ARTIFACT_DIR}}"');
    expect(agentTaskGate).toContain('UX_TRACE_OUTPUT_ROOT="${UX_TRACE_OUTPUT_ROOT:-${INTERNAL_VISUAL_ARTIFACT_DIR}/ux-traces}"');
    expect(agentTaskGate).toContain('INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\');
    expect(agentTaskGate.indexOf('INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\')).toBeLessThan(
      agentTaskGate.indexOf('bash scripts/run-integration-e2e-full.sh "${spec}" "$@"'),
    );
  });

  it('routes Files restore continuation through the internal managed Agent Task sandbox harness', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const wrapper = read('scripts/files-restore-continuation-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');

    expect(packageJson.scripts?.['test:e2e:integration:files:user-stories:restore-continue'])
      .toBe('bash scripts/files-restore-continuation-real-gate.sh');
    expect(wrapper).toContain('RESTORE_CONTINUATION_SPEC="e2e/integration-files-user-stories.spec.ts"');
    expect(wrapper).toContain('RESTORE_CONTINUATION_GREP="same task can continue after Files restore"');
    expect(wrapper).toContain('bash scripts/run-internal-agent-task-real-gate.sh --files-restore-continue -- "$@"');
    expect(wrapper).toContain('npx playwright test --list --config playwright.config.integration.ts');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--files-restore-continue" ]]');
    expect(agentTaskGate).toContain('running Files restore continuation with internal managed Agent Task sandbox');
    expect(agentTaskGate).toContain(
      'run_internal_spec_grep e2e/integration-files-user-stories.spec.ts "same task can continue after Files restore" 21020 3121 "${PLAYWRIGHT_PASSTHROUGH_ARGS[@]}"',
    );
    expect(agentTaskGate).toContain('ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\');
    expect(agentTaskGate).toContain('ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\');
    expect(agentTaskGate).toContain('AGENT_EXECUTION_WS_BASE_URL="${spec_agent_execution_ws_base_url}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(agentTaskGate).toContain('export ENV_FILE=/dev/null');
    expect(agentTaskGate).toContain(
      'export ENV_FILE=/dev/null\n'
      + '    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}"\n'
      + '    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"',
    );
    expect(backendRealRun).not.toContain('test:e2e:integration:files:user-stories:restore-continue');
    expect(backendRealRun).not.toContain('e2e/integration-files-user-stories.spec.ts');
  });

  it('defaults runner projection smoke to the locked digest image and disables image builds', () => {
    const lock = read(RUNNER_IMAGE_LOCK_TRUTH_PATH);
    const lockedImage = lock.match(/^image=(.+)$/m)?.[1] ?? '';
    const lockedDigest = lock.match(/^image_digest=(.+)$/m)?.[1] ?? '';
    const result = runRunnerProjectionSmokeImagePreconditions();

    expect(lockedImage).toContain(`@${lockedDigest}`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`resolved_runner=${lockedImage}`);
    expect(result.stdout).toContain(`exported_image=${lockedImage}`);
    expect(result.stdout).toContain('build_runner_image=0');
    expect(result.stdout).toContain('exported_build=0');
    expect(result.stdout).toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(result.stdout).toContain('preflight:runner_projection_smoke_image_lock|passed|');
    expect(result.stdout).not.toContain('INTEGRATION_INTERNAL_AGENT_IMAGE is required');
  });

  it('rejects explicit runner projection smoke image drift before docker inspect', () => {
    const lock = read(RUNNER_IMAGE_LOCK_TRUTH_PATH);
    const lockedImage = lock.match(/^image=(.+)$/m)?.[1] ?? '';
    const driftedImage = lockedImage.replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`);
    const result = runRunnerProjectionSmokeImagePreconditions({
      explicitImage: driftedImage,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failure:infra_dependency_unready|runner_projection_smoke_image_lock|');
    expect(result.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(result.stdout).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must match locked digest image ref from agentsmith-runner-image.lock');
    expect(result.stderr).toContain('requires INTEGRATION_INTERNAL_AGENT_IMAGE to exactly match image=');
    expect(result.stderr).toContain(`expected=${lockedImage}`);
    expect(result.stderr).toContain(`actual=${driftedImage}`);
  });

  it('rejects explicit runner projection smoke legacy aliases before docker inspect', () => {
    const legacyImage = 'agentsmith-agent-task-runner:local';
    const result = runRunnerProjectionSmokeImagePreconditions({
      explicitImage: legacyImage,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failure:infra_dependency_unready|runner_projection_smoke_image|');
    expect(result.stdout).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must not reference old agent-task-runner image/path');
    expect(result.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(result.stderr).toContain('old agent-task-runner image/path is rejected');
    expect(result.stderr).toContain(legacyImage);
  });

  it('rejects explicit runner projection smoke build requests without falling back to local build', () => {
    const result = runRunnerProjectionSmokeImagePreconditions({
      buildImage: '1',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failure:infra_dependency_unready|runner_projection_smoke_image|');
    expect(result.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(result.stdout).toContain('INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 is required');
    expect(result.stderr).toContain('requires INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0');
    expect(result.stderr).toContain('old monorepo runner image build');
  });

  it('keeps runner projection smoke focused and fail-fast on a canonical runner image', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const runnerImageLockChecker = read('scripts/contracts/check-runner-image-lock.ts');
    const releaseBoundaryChecker = read('scripts/contracts/check-release-boundary-contract.ts');
    const releaseContractArtifact = read('scripts/governance/release-contract-artifact.ts');
    const backendRealRun = read('scripts/backend-real-run.sh');
    const agentTaskRunnerSpec = read('e2e/integration-agent-task-runner.spec.ts');
    const realHelpers = read('e2e/integration-real-helpers.ts');
    const runnerImageLockTruth = CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX.find(
      (entry) => entry.truth === 'runner_image_lock',
    );
    const deepseekPrecondition = sectionBetween(
      agentTaskGate,
      '\nensure_runner_projection_smoke_deepseek_preconditions() {',
      '\n}\n\nensure_runner_projection_smoke_image_preconditions',
    );
    const imagePrecondition = sectionBetween(
      agentTaskGate,
      '\nensure_runner_projection_smoke_image_preconditions() {',
      '\n}\n\nensure_runner_projection_smoke_deepseek_preconditions',
    );
    const projectionFunction = shellFunctionBody(agentTaskGate, 'run_runner_projection_smoke_spec');
    const projectionCase = sectionBetween(
      agentTaskRunnerSpec,
      "test('keeps provider-neutral projection smoke on mbos-context without projected dependencies",
      "test('keeps locked agentsmith-runner image provider-neutral for projection smoke",
    );
    const projectionIntent = sectionBetween(
      projectionCase,
      'intent: [',
      "].join(' ')",
    );
    const projectionCommandBuilder = sectionBetween(
      agentTaskRunnerSpec,
      'function buildProviderNeutralProjectionSmokeCommand',
      'test.describe',
    );
    const removedProjectionBuilder = ['build', 'JiraProjectionEnvSmokeCommand'].join('');
    const removedJiraProjection = ['jira', 'auth'].join('-');
    const removedJiraMissingFields = ['missing', 'jira', 'auth', 'fields'].join('_');
    const removedJiraSkillScript = ['jira', 'ops.py'].join('_');

    expect(packageJson.scripts?.['test:agent-task:runner:projection-smoke'])
      .toBe('bash scripts/run-internal-agent-task-real-gate.sh --runner-projection-smoke');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--runner-projection-smoke" ]]');
    expect(agentTaskGate).toContain('running focused runner projection smoke with canonical agentsmith-runner image');
    expect(agentTaskGate).toContain('ensure_runner_projection_smoke_image_preconditions');
    expect(agentTaskGate).toContain('ensure_runner_projection_smoke_deepseek_preconditions');
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_PROJECTION_SMOKE=1');
    expect(agentTaskGate).toContain('export INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE=1');
    expect(agentTaskGate).toContain('EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"');
    expect(agentTaskGate).toContain(
      `RUNNER_IMAGE_LOCK_PATH="\${RUNNER_IMAGE_LOCK_PATH:-\${ROOT_DIR}/${RUNNER_IMAGE_LOCK_TRUTH_PATH}}"`,
    );
    expect(runnerImageLockChecker).toContain(`'${RUNNER_IMAGE_LOCK_TRUTH_PATH}'`);
    expect(runnerImageLockTruth?.physical_source).toBe(RUNNER_IMAGE_LOCK_TRUTH_PATH);
    expect(releaseBoundaryChecker).toContain(
      `const RUNNER_IMAGE_LOCK_RELATIVE_PATH = '${RUNNER_IMAGE_LOCK_TRUTH_PATH}' as const;`,
    );
    expect(releaseBoundaryChecker).not.toContain("join(FIXTURE_ROOT, 'agentsmith-runner-image.lock')");
    expect(releaseContractArtifact).toContain(`'${RUNNER_IMAGE_LOCK_TRUTH_PATH}' as const`);
    expect(agentTaskGate).not.toContain(LEGACY_RUNNER_IMAGE_LOCK_FIXTURE_PATH);
    expect(runnerImageLockChecker).not.toContain(LEGACY_RUNNER_IMAGE_LOCK_FIXTURE_PATH);
    expect(releaseBoundaryChecker).not.toContain(LEGACY_RUNNER_IMAGE_LOCK_FIXTURE_PATH);
    expect(releaseContractArtifact).not.toContain(LEGACY_RUNNER_IMAGE_LOCK_FIXTURE_PATH);
    expect(agentTaskGate).not.toContain(NON_CANONICAL_RUNNER_IMAGE_LOCK_PATH);
    expect(runnerImageLockChecker).not.toContain(NON_CANONICAL_RUNNER_IMAGE_LOCK_PATH);
    expect(releaseBoundaryChecker).not.toContain(NON_CANONICAL_RUNNER_IMAGE_LOCK_PATH);
    expect(releaseContractArtifact).not.toContain(NON_CANONICAL_RUNNER_IMAGE_LOCK_PATH);
    expect(agentTaskGate).toContain('BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-0}"');
    expect(agentTaskGate).not.toContain('INTEGRATION_INTERNAL_AGENT_IMAGE is required');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must not reference old agent-task-runner image/path');
    expect(agentTaskGate).toContain('INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 is required');
    expect(agentTaskGate).toContain('old monorepo runner image build');
    expect(imagePrecondition).toContain('locked_image="$(runner_image_lock_value image)"');
    expect(imagePrecondition).toContain('locked_digest="$(runner_image_lock_value image_digest)"');
    expect(imagePrecondition).toContain('if [[ "${locked_image}" != *@sha256:* ]]; then');
    expect(imagePrecondition).toContain('if [[ -n "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" && "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" != "${locked_image}" ]]; then');
    expect(imagePrecondition).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must match locked digest image ref from agentsmith-runner-image.lock');
    expect(imagePrecondition).toContain('tag-only or local non-digest images are not accepted');
    expect(imagePrecondition).toContain('RUNNER_IMAGE="${locked_image}"');
    expect(imagePrecondition).toContain('export INTEGRATION_INTERNAL_AGENT_IMAGE="${locked_image}"');
    expect(imagePrecondition).toContain('export INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE="${BUILD_RUNNER_IMAGE}"');
    expect(imagePrecondition).not.toContain('repo_digests');
    expect(imagePrecondition).not.toContain('lock_pending');
    expect(agentTaskGate).toContain('command -v docker >/dev/null 2>&1');
    expect(agentTaskGate).toContain('docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1');
    expect(agentTaskGate).toContain("docker image inspect --format '{{.Id}}' \"${RUNNER_IMAGE}\"");
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID="${image_id}"');
    expect(agentTaskGate).toContain('scripts/contracts/check-runner-image-lock.ts');
    expect(agentTaskGate).toContain('BACKEND_REAL_OPENAI_BASE_URL must resolve to DeepSeek');
    expect(agentTaskGate).toContain('deepseek_openai_host()');
    expect(deepseekPrecondition).toContain('deepseek_openai_host "${openai_base_url}"');
    expect(deepseekPrecondition).toContain('"api.deepseek.com"');
    expect(deepseekPrecondition).toContain('*.deepseek.com');
    expect(deepseekPrecondition).not.toContain('*deepseek*');
    expect(deepseekPrecondition).toContain('resolved_host=${openai_host_for_log}');
    expect(deepseekPrecondition).toContain('"passed" "host=${openai_host}"');
    expect(deepseekPrecondition).not.toContain('resolved=${openai_base_url');
    expect(agentTaskGate).toContain('new URL(raw).hostname.toLowerCase()');
    expect(agentTaskGate).toContain('BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL:-${BACKEND_REAL_OPENAI_BASE_URL_VALUE}}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_RUNNER_PROJECTION_SMOKE="${INTEGRATION_RUNNER_PROJECTION_SMOKE:-0}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE="${INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE:-0}" \\');
    expect(agentTaskGate).toContain('docker is required to inspect INTEGRATION_INTERNAL_AGENT_IMAGE');
    expect(agentTaskGate).toContain('local docker image not found');
    expect(projectionFunction).toContain(
      'keeps provider-neutral projection smoke on mbos-context without projected dependencies',
    );
    expect(projectionCase).toContain('buildProviderNeutralProjectionSmokeCommand');
    expect(projectionCase).toContain('readRunnerProjectionSmokeImage');
    expect(projectionCase).toContain('runnerImage: projectionSmokeImage');
    expect(projectionCase).toContain('forceManagedRunnerUpsert: true');
    expect(projectionCase).toContain('runner_projection_smoke_expected_image: projectionSmokeImage');
    expect(projectionCase).toContain('expect(prepared.runnerConfiguredImage).toBe(projectionSmokeImage)');
    expect(projectionCase).toContain('expectManagedAgentRunnerImageEvidenceViaApi');
    expect(projectionCase).toContain('expectManagedWorkloadPodImage');
    expect(projectionCase).toContain('includeRunnerBoundarySmoke: Boolean(projectionSmokeImage)');
    expect(projectionCommandBuilder).toContain('unexpected_projected_dependencies');
    expect(projectionCase).toContain('RUNNER_PROJECTION_BOUNDARY::ok');
    expect(projectionCase).toContain('RUNNER_SEMANTIC_SOURCE::blue');
    expect(projectionCase).toContain("token: 'RUNNER_LLM_SEMANTIC::BLUE'");
    expect(projectionIntent).toContain('RUNNER_LLM_SEMANTIC::');
    expect(projectionIntent).toContain('uppercase');
    expect(projectionIntent).not.toContain('RUNNER_LLM_SEMANTIC::BLUE');
    expect(projectionCase).toContain('expectRunnerOutputNotToLeakSecret(runnerOutputContent, requireRealLaneApiKey(),');
    expect(projectionCase).toContain('redacted provider endpoint api key');
    expect(agentTaskRunnerSpec).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
    expect(agentTaskRunnerSpec).toContain('includeRunnerBoundarySmoke');
    expect(agentTaskRunnerSpec).toContain('home != task_home');
    expect(agentTaskRunnerSpec).toContain('task_home.startswith("/home/")');
    expect(agentTaskRunnerSpec).toContain('os.getcwd() != workspace_path');
    expect(agentTaskRunnerSpec).toContain('workspace_path != task_home + "/workspace"');
    expect(agentTaskRunnerSpec).toContain('artifacts_path != workspace_path + "/.artifacts"');
    expect(agentTaskRunnerSpec).toContain('control_env_leak:MBOS_AGENT_KEY');
    expect(agentTaskRunnerSpec).toContain('control_env_leak:MBOS_AGENT_WS_URL');
    expect(agentTaskRunnerSpec).toContain('control_env_leak:AGENT_KEY');
    expect(agentTaskRunnerSpec).toContain('control_env_leak:AGENT_WS_URL');
    expect(projectionCommandBuilder).toContain('context_value_persisted:');
    expect(agentTaskRunnerSpec).not.toContain(removedProjectionBuilder);
    expect(agentTaskRunnerSpec).not.toContain(removedJiraProjection);
    expect(agentTaskRunnerSpec).not.toContain(removedJiraMissingFields);
    expect(agentTaskRunnerSpec).not.toContain('/rest/api/2/myself');
    expect(agentTaskRunnerSpec).toContain('runner_projection_smoke_non_canonical_image');
    expect(realHelpers).toContain('INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE');
    expect(realHelpers).toContain('managed_runner_projection_smoke_image_required');
    expect(realHelpers).toContain('configuredImage: seededDefault.configuredImage');
    expect(realHelpers).toContain('expectManagedAgentRunnerImageEvidenceViaApi');
    expect(realHelpers).toContain('expectManagedWorkloadPodImage');
    expect(projectionCase).not.toContain(removedJiraSkillScript);
    expect(projectionFunction).not.toContain('reads task context through mbos-context');
    expect(backendRealRun).not.toContain('--runner-projection-smoke');
  });

  it('redacts raw DeepSeek precondition URLs and secrets on runner projection smoke failure', () => {
    const rawUrl =
      'https://provider.example.test/v1/chat/completions?api_key=sk-test-deepseek-query-secret&token=secret-token';
    const result = runRunnerProjectionSmokeDeepseekPreconditions({ openaiBaseUrl: rawUrl });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failure:infra_dependency_unready|runner_projection_smoke_deepseek|');
    expect(result.stderr).toContain('resolved_host=provider.example.test');
    expect(combinedOutput).not.toContain(rawUrl);
    expect(combinedOutput).not.toContain('/v1/chat/completions');
    expect(combinedOutput).not.toContain('api_key=');
    expect(combinedOutput).not.toContain('sk-test-deepseek-query-secret');
    expect(combinedOutput).not.toContain('secret-token');
    expect(combinedOutput).not.toContain('token=');
  });

  it('enables AFSCP direct restore recovery only for the focused Files restore continuation gate', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(agentTaskGate).toContain('enable_files_restore_continuation_afscp_restore_recovery()');
    expect(agentTaskGate).toContain(
      'if [[ "${GATE_MODE}" == "files-restore-continue" ]]; then\n'
      + '    export AFSCP_RESTORE_RECOVERY_ENABLED="${AFSCP_RESTORE_RECOVERY_ENABLED:-true}"\n'
      + '  fi',
    );
    expect(agentTaskGate).toContain(
      '\nwait_for_internal_integration_deps_for_afscp\n'
      + 'ensure_internal_default_workspace_for_afscp\n'
      + 'ensure_internal_kind_cluster_for_afscp_reset\n'
      + 'reset_internal_afscp_local_runtime\n'
      + 'enable_files_restore_continuation_afscp_restore_recovery\n'
      + 'prepare_internal_backend_real_gate_runtime',
    );
    expect(agentTaskGate).not.toContain('AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256="');
    expect(agentTaskGate).not.toContain('AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF="');
  });

  it('keeps Files restore continuation evidence based on runner-observed task metadata', () => {
    const spec = read('e2e/integration-files-user-stories.spec.ts');
    const story = read('e2e/stories/backend-real/agent-task-image-asset-savepoint-delete-restore.story.md');

    expect(spec).toContain('runtime_task_id = os.environ.get("MBOS_AGENT_TASK_ID", "").strip()');
    expect(spec).toContain('f"runtime_observed_task_id={runtime_task_id}"');
    expect(spec).toContain('expect(postRestoreFields.runtime_observed_task_id).toBe(taskId)');
    expect(spec).toContain('f"api_bound_task_id={api_task_id}"');
    expect(spec).toContain('f"api_bound_workspace_file_library_id={api_bound_library_id}"');
    expect(spec).not.toContain('expected_task_id =');
    expect(spec).not.toContain('expected_library_id =');
    expect(spec).not.toContain('expected_evidence =');
    expect(story).toContain('runner-observed task metadata');
  });

  it('keeps locked runner runtime smoke focused on provider-neutral projection absence with the canonical locked image', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');
    const agentTaskRunnerSpec = read('e2e/integration-agent-task-runner.spec.ts');
    const realHelpers = read('e2e/integration-real-helpers.ts');
    const orchestrator = read('packages/api-entry-node/src/notebook-execution-orchestrator.ts');
    const orchestratorTest = read('packages/api-entry-node/src/notebook-execution-orchestrator.test.ts');
    const lockedRuntimeFunction = shellFunctionBody(agentTaskGate, 'run_runner_locked_runtime_smoke_spec');
    const lockedRuntimeCase = sectionBetween(
      agentTaskRunnerSpec,
      "test('keeps locked agentsmith-runner image provider-neutral for projection smoke",
      "test('reads task context through mbos-context inside",
    );
    const projectionCommandBuilder = sectionBetween(
      agentTaskRunnerSpec,
      'function buildProviderNeutralProjectionSmokeCommand',
      'test.describe',
    );
    const lockedRuntimeCommandBuilder = sectionBetween(
      agentTaskRunnerSpec,
      'function buildLockedRuntimeProjectionBoundarySmokeCommand',
      'test.describe',
    );
    const removedFeishuProjection = ['feishu', 'managed', 'user'].join('-');
    const removedJiraProjection = ['jira', 'auth'].join('-');
    const removedFeishuMcpField = ['feishu', 'mcp', 'endpoint'].join('_');
    const removedFeishuSkillScript = ['feishu', 'mcp.py'].join('_');
    const removedJiraSkillScript = ['jira', 'ops.py'].join('_');

    expect(packageJson.scripts?.['test:agent-task:runner:locked-runtime'])
      .toBe('bash scripts/run-internal-agent-task-real-gate.sh --runner-locked-runtime-smoke');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--runner-locked-runtime-smoke" ]]');
    expect(agentTaskGate).toContain('running focused locked runtime smoke with canonical agentsmith-runner image');
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE=1');
    expect(agentTaskGate).toContain('export INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE=1');
    expect(agentTaskGate).toContain('INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE="${INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE:-0}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID="${INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID:-}" \\');
    expect(agentTaskGate).toContain(
      `RUNNER_IMAGE_LOCK_PATH="\${RUNNER_IMAGE_LOCK_PATH:-\${ROOT_DIR}/${RUNNER_IMAGE_LOCK_TRUTH_PATH}}"`,
    );
    expect(agentTaskGate).toContain('BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-0}"');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must not reference old agent-task-runner image/path');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must match locked digest image ref from agentsmith-runner-image.lock');
    expect(agentTaskGate).toContain('INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 is required');
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID="${image_id}"');
    expect(lockedRuntimeFunction).toContain(
      'keeps locked agentsmith-runner image provider-neutral for projection smoke in a real Agent Task run',
    );
    expect(lockedRuntimeFunction).not.toContain('reads task context through mbos-context');
    expect(lockedRuntimeFunction).not.toContain('writes task context through mbos-context');
    expect(lockedRuntimeFunction).not.toContain('keeps provider-neutral projection smoke on mbos-context without projected dependencies');
    expect(lockedRuntimeFunction).not.toContain('run_skills_runtime_specs');
    expect(agentTaskGate).toContain('focused locked runner runtime smoke passed');
    expect(backendRealRun).not.toContain('--runner-locked-runtime-smoke');
    expect(backendRealRun).not.toContain('test:agent-task:runner:locked-runtime');
    expect(lockedRuntimeCase).toContain('readRunnerLockedRuntimeSmokeImage');
    expect(lockedRuntimeCase).toContain('runnerImage: lockedRuntimeSmokeImage');
    expect(lockedRuntimeCase).toContain('forceManagedRunnerUpsert: true');
    expect(lockedRuntimeCase).toContain('runner_locked_runtime_smoke_expected_image: lockedRuntimeSmokeImage');
    expect(lockedRuntimeCase).toContain('expect(prepared.runnerConfiguredImage).toBe(lockedRuntimeSmokeImage)');
    expect(lockedRuntimeCase).toContain('expectManagedAgentRunnerImageEvidenceViaApi');
    expect(lockedRuntimeCase).toContain('diagnosticsPrefix: \'runner_locked_runtime_smoke\'');
    expect(lockedRuntimeCase).toContain('expectManagedWorkloadPodImage');
    expect(lockedRuntimeCase).not.toContain('putContextEntryViaApi');
    expect(lockedRuntimeCase).not.toContain('context_cli.py"), "get", "--scope", "task", "--key"');
    expect(lockedRuntimeCase).not.toContain('context_cli.py get --scope task --key');
    expect(lockedRuntimeCase).not.toContain('PROJECTION_SMOKE::${contextValue}');
    expect(lockedRuntimeCase).toContain('buildLockedRuntimeProjectionBoundarySmokeCommand');
    expect(lockedRuntimeCase).toContain('const lockedRuntimeTaskToken = `LOCKED_RUNTIME_TASK::${taskId}`');
    expect(lockedRuntimeCase).toContain('const lockedRuntimeRunToken = `LOCKED_RUNTIME_RUN::${expectedRunId}`');
    expect(lockedRuntimeCase).toContain(
      'const lockedRuntimeBoundaryToken = `RUNNER_PROJECTION_BOUNDARY::ok::${taskId}::${expectedRunId}`',
    );
    expect(lockedRuntimeCase).toContain('token: lockedRuntimeTaskToken');
    expect(lockedRuntimeCase).toContain('token: lockedRuntimeRunToken');
    expect(lockedRuntimeCase).not.toContain('token: `LOCKED_RUNTIME_SMOKE::');
    expect(lockedRuntimeCase).not.toContain('marker: smokeMarker');
    expect(lockedRuntimeCase).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
    expect(projectionCommandBuilder).toContain('data=json.loads(raw)');
    expect(projectionCommandBuilder).toContain('unexpected_projected_dependencies');
    expect(lockedRuntimeCommandBuilder).toContain('function buildLockedRuntimeProjectionBoundarySmokeCommand(): string');
    expect(lockedRuntimeCommandBuilder).not.toContain('marker: string');
    expect(lockedRuntimeCommandBuilder).not.toContain('args.marker');
    expect(lockedRuntimeCommandBuilder).not.toContain('LOCKED_RUNTIME_SMOKE::');
    expect(lockedRuntimeCommandBuilder).not.toContain('RUNNER_PROJECTION_BOUNDARY::ok');
    expect(lockedRuntimeCommandBuilder).toContain('runtime_task_id=os.environ.get("MBOS_AGENT_TASK_ID","").strip()');
    expect(lockedRuntimeCommandBuilder).toContain('runtime_run_id=os.environ.get("MBOS_AGENT_RUN_ID","").strip()');
    expect(lockedRuntimeCommandBuilder).toContain('missing_MBOS_AGENT_TASK_ID');
    expect(lockedRuntimeCommandBuilder).toContain('missing_MBOS_AGENT_RUN_ID');
    expect(lockedRuntimeCommandBuilder).toContain('"LOCKED_RUNTIME_TASK::"+runtime_task_id');
    expect(lockedRuntimeCommandBuilder).toContain('"LOCKED_RUNTIME_RUN::"+runtime_run_id');
    expect(lockedRuntimeCommandBuilder).toContain('mbos-context","list"');
    expect(lockedRuntimeCommandBuilder).toContain('empty_context_projection');
    expect(lockedRuntimeCommandBuilder).toContain('unexpected_projected_dependencies');
    expect(lockedRuntimeCommandBuilder).toContain('control_env_leak:MBOS_AGENT_KEY');
    expect(lockedRuntimeCase).toContain('expectRunnerOutputNotToLeakSecret(runnerOutputContent, requireRealLaneApiKey()');
    expect(lockedRuntimeCase).not.toContain('createExternalConnectionViaApi');
    expect(lockedRuntimeCase).not.toContain(removedFeishuProjection);
    expect(lockedRuntimeCase).not.toContain(removedJiraProjection);
    expect(lockedRuntimeCase).not.toContain(removedFeishuMcpField);
    expect(lockedRuntimeCase).not.toContain(removedFeishuSkillScript);
    expect(lockedRuntimeCase).not.toContain(removedJiraSkillScript);
    expect(orchestrator).not.toContain(removedFeishuProjection);
    expect(orchestrator).not.toContain(removedJiraProjection);
    expect(orchestratorTest).toContain('does not synthesize provider-specific projected dependencies from simple Context Store credentials');
    expect(orchestratorTest).toContain('does not synthesize provider-specific projected dependencies from managed external connections');
    expect(orchestratorTest).not.toContain(removedFeishuProjection);
    expect(orchestratorTest).not.toContain(removedJiraProjection);
    expect(realHelpers).toContain('diagnosticsPrefix?: "runner_projection_smoke" | "runner_locked_runtime_smoke"');
  });

  it('defaults locked runner runtime smoke to the locked digest image and disables image builds', () => {
    const lock = read(RUNNER_IMAGE_LOCK_TRUTH_PATH);
    const lockedImage = lock.match(/^image=(.+)$/m)?.[1] ?? '';
    const lockedDigest = lock.match(/^image_digest=(.+)$/m)?.[1] ?? '';
    const result = runRunnerProjectionSmokeImagePreconditions({
      gateMode: 'runner-locked-runtime-smoke',
    });

    expect(lockedImage).toContain(`@${lockedDigest}`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`resolved_runner=${lockedImage}`);
    expect(result.stdout).toContain(`exported_image=${lockedImage}`);
    expect(result.stdout).toContain('build_runner_image=0');
    expect(result.stdout).toContain('exported_build=0');
    expect(result.stdout).toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(result.stdout).toContain('preflight:runner_locked_runtime_smoke_image_lock|passed|');
  });

  it('rejects locked runner runtime smoke image drift and build fallback before docker inspect', () => {
    const lock = read(RUNNER_IMAGE_LOCK_TRUTH_PATH);
    const lockedImage = lock.match(/^image=(.+)$/m)?.[1] ?? '';
    const driftedImage = lockedImage.replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`);
    const driftResult = runRunnerProjectionSmokeImagePreconditions({
      gateMode: 'runner-locked-runtime-smoke',
      explicitImage: driftedImage,
    });
    const legacyResult = runRunnerProjectionSmokeImagePreconditions({
      gateMode: 'runner-locked-runtime-smoke',
      explicitImage: 'agentsmith-agent-task-runner:local',
    });
    const buildResult = runRunnerProjectionSmokeImagePreconditions({
      gateMode: 'runner-locked-runtime-smoke',
      buildImage: '1',
    });

    expect(driftResult.status).toBe(1);
    expect(driftResult.stdout).toContain('failure:infra_dependency_unready|runner_locked_runtime_smoke_image_lock|');
    expect(driftResult.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(driftResult.stderr).toContain('--runner-locked-runtime-smoke requires INTEGRATION_INTERNAL_AGENT_IMAGE to exactly match image=');

    expect(legacyResult.status).toBe(1);
    expect(legacyResult.stdout).toContain('failure:infra_dependency_unready|runner_locked_runtime_smoke_image|');
    expect(legacyResult.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(legacyResult.stderr).toContain('--runner-locked-runtime-smoke requires a canonical agentsmith-runner image');

    expect(buildResult.status).toBe(1);
    expect(buildResult.stdout).toContain('failure:infra_dependency_unready|runner_locked_runtime_smoke_image|');
    expect(buildResult.stdout).not.toContain('image_id=sha256:runner-projection-smoke-image-id');
    expect(buildResult.stderr).toContain('--runner-locked-runtime-smoke requires INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0');
  });
});
