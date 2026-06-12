import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function shellFunctionDefinition(source: string, functionName: string): string {
  const match = source.match(new RegExp(`^${functionName}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'mu'));
  return match?.[0] ?? '';
}

describe('run-integration-release-user-story integration dependency contract', () => {
  it('preserves caller-selected integration and substrate ports through backend-real env loading', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const loadIndex = script.indexOf('load_backend_real_env "${ROOT_DIR}/.env.backend-real"');

    expect(loadIndex).toBeGreaterThanOrEqual(0);
    for (const key of [
      'INTEGRATION_API_PORT',
      'INTEGRATION_WEB_PORT',
      'INTEGRATION_POSTGRES_PORT',
      'INTEGRATION_MONGO_PORT',
      'INTEGRATION_REDIS_PORT',
      'INTEGRATION_MINIO_API_PORT',
      'INTEGRATION_MINIO_CONSOLE_PORT',
      'INTEGRATION_KEYCLOAK_PORT',
    ]) {
      const original = `ORIGINAL_${key}="\${${key}:-}"`;
      const restore = `export ${key}="\${ORIGINAL_${key}}"`;

      expect(script).toContain(original);
      expect(script).toContain(restore);
      expect(script.indexOf(original)).toBeLessThan(loadIndex);
      expect(script.indexOf(restore)).toBeGreaterThan(loadIndex);
    }
  });

  it('honors caller-provided Agent Task runner images without legacy codex runner aliases', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/managed-runner-image-handoff.sh"');
    expect(script).toContain('source "${ROOT_DIR}/scripts/scenarios/common.sh"');
    expect(script).toContain('RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"');
    expect(script).toContain(
      'RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain(
      'RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain('BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-1}}"');
    expect(script).not.toContain('INTEGRATION_CODEX_RUNNER');
    expect(script).not.toContain(':-notebook');
  });

  it('revalidates Redis auth before reusing integration dependency readiness', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const readyFunction = shellFunctionDefinition(script, 'release_user_story_integration_deps_ready');

    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/local-redis-auth.sh"');
    expect(script).toContain('local_redis_require_simple_password REDIS_PASSWORD "${REDIS_PASSWORD}" "[integration-release-user-story]"');
    expect(readyFunction).toContain('readiness_state_field_ready_with_identity integration_deps_ready');
    expect(readyFunction).toContain('local_redis_auth_ping "127.0.0.1" "${INTEGRATION_REDIS_PORT}" "${REDIS_PASSWORD}" "[integration-release-user-story]"');
  });

  it('hands the release user story managed runner image to ASBCP as a digest-pinned kind registry ref', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const buildEnd = script.indexOf('\nfi\nprepare_release_user_story_managed_runner_image_handoff');
    const prepareStart = script.indexOf('prepare_release_user_story_managed_runner_image_handoff()');
    const prepareEnd = script.indexOf('\nrelease_user_story_integration_deps_ready()', prepareStart);
    const prepareBody = script.slice(prepareStart, prepareEnd);
    const csiStart = script.indexOf('ensure_afscp_storage_csi()');
    const csiEnd = script.indexOf('\nensure_release_user_story_integration_deps_for_afscp', csiStart);
    const csiBody = script.slice(csiStart, csiEnd);
    const configIndex = script.indexOf('runnerImage: ${RUNNER_IMAGE}');
    const childIndex = script.indexOf('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \\');

    expect(script).toContain('release_user_story_publish_local_runner_image_ref()');
    expect(script).toContain('prepare_release_user_story_managed_runner_image_handoff()');
    expect(script).toContain('managed_runner_image_handoff_publish_local_runner_image_ref');
    expect(script).toContain('managed_runner_image_handoff_preflight_kind_registry_runner_image');
    expect(script).toContain('managed_runner_image_handoff_is_digest_ref "${RUNNER_IMAGE}"');
    expect(script).toContain('managed_runner_image_handoff_reject_legacy_runner_image_ref "${RUNNER_IMAGE}"');
    expect(script).toContain('RUNNER_IMAGE="$(release_user_story_publish_local_runner_image_ref "${RUNNER_IMAGE}")"');
    expect(buildEnd).toBeGreaterThanOrEqual(0);
    expect(prepareStart).toBeGreaterThanOrEqual(0);
    expect(prepareBody).toContain('failed to publish managed runner image to local kind registry');
    expect(prepareBody).toContain('failed to preflight managed runner digest image ${RUNNER_IMAGE}');
    expect(csiBody).toContain('if ! release_user_story_runner_image_from_kind_registry; then');
    expect(csiBody).toContain('ensure_kind_image "${RUNNER_IMAGE}"');
    expect(configIndex).toBeGreaterThan(buildEnd);
    expect(childIndex).toBeGreaterThan(configIndex);
  });

  it('keeps internal runner storage bootstrap behind AFSCP substrate env names', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    expect(script).not.toContain('kubectl create namespace "${K8S_NAMESPACE}"');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-25432}"');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-29000}"');

    expect(script).toContain('render_k8s_external_dependency_services \\');
    expect(script).toContain('  "${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('  "${INTEGRATION_MINIO_API_PORT}"');

    expect(script).not.toContain('endpoint: localhost:${INTEGRATION_MINIO_API_PORT}');
    expect(script).not.toContain('STORAGE_ENDPOINT="localhost:${INTEGRATION_MINIO_API_PORT}"');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \\');
    expect(script).toContain('AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}" \\');
    expect(script).toContain('AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \\');

    expect(script).not.toContain('AGENT_RUNNER_DEVELOPER_JUICEFS');
    expect(script).not.toContain('INTERNAL_AGENT_JUICEFS');
    expect(script).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT');
    expect(script).not.toContain('STORAGE_ENDPOINT="localhost:19000"');
    expect(script).not.toContain('endpoint: localhost:19000');
  });

  it('passes release Keycloak truth to deps-bootstrap instead of Makefile defaults', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const bootstrapIndex = script.indexOf('make deps-bootstrap');
    const envStart = script.lastIndexOf('run_release_user_story_clean_env env \\', bootstrapIndex);
    const envBlock = script.slice(envStart, bootstrapIndex);

    expect(bootstrapIndex).toBeGreaterThanOrEqual(0);
    expect(envStart).toBeGreaterThanOrEqual(0);
    expect(envBlock).toContain('KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \\');
    expect(envBlock).toContain('KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \\');
    expect(envBlock).toContain('KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms" \\');
    expect(envBlock).toContain('KEYCLOAK_REALM="${KEYCLOAK_REALM}" \\');
    expect(envBlock).toContain('KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \\');
  });

  it('passes the ASBCP AFSCP env contract directly to the locked ASBCP image', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('AFSCP_INTERNAL_BASE_URL_VALUE="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL}}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_TOKEN_VALUE="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"');
    expect(script).toContain('AFSCP_CALLER_SERVICE_VALUE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}"');
    expect(script).toContain('AFSCP_ACTOR_TYPE_VALUE="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"');
    expect(script).toContain('AFSCP_ACTOR_ID_VALUE="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_CALLER_SERVICE_VALUE}}}"');
    expect(script).toContain('AFSCP_INTERNAL_BASE_URL="${AFSCP_INTERNAL_BASE_URL_VALUE}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="$(release_user_story_secret_fingerprint "${AFSCP_ORCHESTRATOR_TOKEN_VALUE}")"');
    expect(script).toContain('AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE_VALUE}"');
    expect(script).toContain('AFSCP_ACTOR_TYPE="${AFSCP_ACTOR_TYPE_VALUE}"');
    expect(script).toContain('AFSCP_ACTOR_ID="${AFSCP_ACTOR_ID_VALUE}"');
    expect(script).toContain('ASBCP_KUBECONFIG_PATH="$(release_user_story_asbcp_kubeconfig_path)"');
    expect(script).toContain('KUBECONFIG="${ASBCP_KUBECONFIG_PATH}"');
    expect(script).toContain('INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" bash "${CONTROL_SCRIPT}" start-asbcp');
    expect(script).not.toMatch(/^afscp:\s*$/mu);
    expect(script).not.toContain('http://127.0.0.1:28090');
  });

  it('generates ASBCP sandbox config with the ASBCP main container contract', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('containerName: main');
    expect(script).not.toContain('containerName: runner');
  });

  it('ensures a usable standalone Kubernetes context before CSI without empty kind names', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const resetIndex = script.indexOf('bash "${ROOT_DIR}/scripts/backend-real-reset.sh"');
    const firstContextEnsureIndex = script.indexOf('\nensure_release_user_story_kubernetes_context\n');
    const mainDepsIndex = script.indexOf('\nensure_release_user_story_integration_deps_for_afscp\n');
    const contextEnsureIndex = script.indexOf('\nensure_release_user_story_kubernetes_context\n', mainDepsIndex);
    const csiIndex = script.indexOf('\nensure_afscp_storage_csi\n', contextEnsureIndex);
    const contextFunctionStart = script.indexOf('ensure_release_user_story_kubernetes_context()');
    const contextFunctionEnd = script.indexOf('\nrun_release_user_story_clean_env()', contextFunctionStart);
    const contextFunctionBody = script.slice(contextFunctionStart, contextFunctionEnd);
    const readyFunctionStart = script.indexOf('release_user_story_kubectl_context_ready()');
    const readyFunctionEnd = script.indexOf('\nrelease_user_story_default_kind_kubeconfig_path()', readyFunctionStart);
    const readyFunctionBody = script.slice(readyFunctionStart, readyFunctionEnd);
    const asbcpKubeconfigStart = script.indexOf('release_user_story_asbcp_kubeconfig_path()');
    const asbcpKubeconfigEnd = script.indexOf('\nrelease_user_story_require_target_kind_context()', asbcpKubeconfigStart);
    const asbcpKubeconfigBody = script.slice(asbcpKubeconfigStart, asbcpKubeconfigEnd);

    expect(script).toContain('KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"');
    expect(script).toContain('KIND_NODE_NAME="${LOCAL_KIND_CONTROL_PLANE_NODE_NAME:-${KIND_CLUSTER_NAME}-control-plane}"');
    expect(script).not.toContain('kind_cluster_name_from_context_or_override');
    expect(script).not.toContain('kind_control_plane_node_name_from_context_or_override');
    expect(contextFunctionStart).toBeGreaterThanOrEqual(0);
    expect(readyFunctionBody).toContain('[[ "${current_context}" == "${KIND_CONTEXT_NAME}" ]] || return 1');
    expect(readyFunctionBody).toContain('kubectl --context "${KIND_CONTEXT_NAME}" get --raw=');
    expect(asbcpKubeconfigBody).not.toContain('local configured="${KUBECONFIG:-}"');
    expect(asbcpKubeconfigBody).not.toContain('${HOME}/.kube/config');
    expect(contextFunctionBody).toContain('release_user_story_fail "kind is required for the local release user story diagnostic context ${KIND_CONTEXT_NAME}."');
    expect(contextFunctionBody).toContain('LOCAL_KIND_FINAL_KUBECONFIG_PATH="${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-$(release_user_story_default_kind_kubeconfig_path "${KIND_CLUSTER_NAME}")}"');
    expect(contextFunctionBody).toContain('LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${KIND_NODE_NAME}" \\');
    expect(contextFunctionBody).toContain('ensure_local_kind_cluster');
    expect(contextFunctionBody).toContain('export KUBECONFIG="${LOCAL_KIND_FINAL_KUBECONFIG_PATH}"');
    expect(contextFunctionBody).toContain('release_user_story_require_target_kind_context "release user story rehearsal"');
    expect(contextFunctionBody).toContain('ASBCP_KUBECONFIG_PATH="$(release_user_story_asbcp_kubeconfig_path)"');
    expect(script).toContain('BACKEND_REAL_RESET_KUBE_CONTEXT="${KIND_CONTEXT_NAME}" \\');
    expect(firstContextEnsureIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThan(firstContextEnsureIndex);
    expect(mainDepsIndex).toBeGreaterThanOrEqual(0);
    expect(contextEnsureIndex).toBeGreaterThan(mainDepsIndex);
    expect(csiIndex).toBeGreaterThan(contextEnsureIndex);
  });

  it('keeps release Kubernetes writes behind the explicit local kind context guard', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    const csiFunctionStart = script.indexOf('ensure_afscp_storage_csi()');
    const csiFunctionEnd = script.indexOf('\nensure_release_user_story_integration_deps_for_afscp', csiFunctionStart);
    const csiFunctionBody = script.slice(csiFunctionStart, csiFunctionEnd);
    const namespaceApplyIndex = script.indexOf('\nensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    const namespaceGuardIndex = script.lastIndexOf('release_user_story_require_target_kind_context "sandbox namespace reconciliation"', namespaceApplyIndex);
    const externalApplyIndex = script.indexOf('\nkubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null');
    const externalGuardIndex = script.lastIndexOf('release_user_story_require_target_kind_context "external dependency service apply"', externalApplyIndex);

    expect(csiFunctionBody).toContain('release_user_story_require_target_kind_context "AFSCP storage CSI reconciliation"');
    expect(csiFunctionBody).toContain('kubectl apply --validate=false -f "${csi_manifest}" >/dev/null');
    expect(csiFunctionBody.indexOf('release_user_story_require_target_kind_context "AFSCP storage CSI reconciliation"')).toBeLessThan(
      csiFunctionBody.indexOf('kubectl apply --validate=false -f "${csi_manifest}" >/dev/null'),
    );
    expect(namespaceGuardIndex).toBeGreaterThanOrEqual(0);
    expect(namespaceGuardIndex).toBeLessThan(namespaceApplyIndex);
    expect(externalGuardIndex).toBeGreaterThanOrEqual(0);
    expect(externalGuardIndex).toBeLessThan(externalApplyIndex);
  });

  it('fails AFSCP reset closed unless the target kind context and namespace ownership are confirmed', () => {
    const runtimeLib = readFileSync('scripts/lib/afscp-local-runtime.sh', 'utf8');
    const internalCommon = readFileSync('scripts/local-manual/internal-common.sh', 'utf8');
    const resetFunctionStart = internalCommon.indexOf('reset_owned_afscp_local_runtime_k8s_state()');
    const resetFunctionEnd = internalCommon.indexOf('\nreset_owned_afscp_local_runtime_for_gate()', resetFunctionStart);
    const resetFunctionBody = internalCommon.slice(resetFunctionStart, resetFunctionEnd);
    const contextGuardStart = internalCommon.indexOf('afscp_ensure_local_kind_context_for_reset()');
    const contextGuardEnd = internalCommon.indexOf('\nafscp_assert_namespace_owned_for_reset()', contextGuardStart);
    const contextGuardBody = internalCommon.slice(contextGuardStart, contextGuardEnd);
    const ownershipGuardStart = internalCommon.indexOf('afscp_assert_namespace_owned_for_reset()');
    const ownershipGuardEnd = internalCommon.indexOf('\nreset_owned_afscp_local_runtime_k8s_state()', ownershipGuardStart);
    const ownershipGuardBody = internalCommon.slice(ownershipGuardStart, ownershipGuardEnd);

    expect(runtimeLib).toContain('export INTERNAL_AGENT_KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"');
    expect(runtimeLib).toContain('export LOCAL_KIND_FINAL_KUBECONFIG_PATH');
    expect(internalCommon).toContain('KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"');
    expect(contextGuardBody).toContain('kubectl is required before AFSCP local-real Kubernetes namespace reset; local-real fails closed');
    expect(contextGuardBody).toContain('[[ -n "${KIND_CLUSTER_NAME}" && "${KIND_CONTEXT_NAME}" == kind-* ]]');
    expect(contextGuardBody).toContain('kubectl config use-context "${KIND_CONTEXT_NAME}"');
    expect(contextGuardBody).toContain('[[ "${current_context}" == "${KIND_CONTEXT_NAME}" ]]');
    expect(contextGuardBody).toContain('kubectl --context "${KIND_CONTEXT_NAME}" get --raw=');
    expect(contextGuardBody).not.toContain('skipping AFSCP local-real Kubernetes namespace reset');
    expect(ownershipGuardBody).toContain('local owner_label_key="${AFSCP_LOCAL_RUNTIME_K8S_OWNER_LABEL_KEY:-app.kubernetes.io/managed-by}"');
    expect(ownershipGuardBody).toContain('local owner_label_value="${AFSCP_LOCAL_RUNTIME_K8S_OWNER_LABEL_VALUE:-agentsmith}"');
    expect(ownershipGuardBody).toContain('kubectl get namespace "${namespace}" -o "jsonpath={.metadata.labels.${escaped_label_key}}"');
    expect(ownershipGuardBody).toContain('namespace ${namespace} must be labelled ${owner_label_key}=${owner_label_value}');
    expect(resetFunctionBody).toContain('afscp_ensure_local_kind_context_for_reset || return 1');
    expect(resetFunctionBody).toContain('afscp_assert_namespace_owned_for_reset "${K8S_NAMESPACE}" || return 1');
    expect(resetFunctionBody.indexOf('afscp_assert_namespace_owned_for_reset "${K8S_NAMESPACE}" || return 1')).toBeLessThan(
      resetFunctionBody.indexOf('kubectl delete namespace "${K8S_NAMESPACE}" --ignore-not-found --wait=true --timeout=120s'),
    );
  });

  it('keeps release user story ASBCP state artifact free of raw service tokens', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const stateBlockStart = script.indexOf('cat > "${ASBCP_STATE_FILE}" <<EOF');
    const stateBlockEnd = script.indexOf('\nEOF', stateBlockStart);
    const stateBlock = script.slice(stateBlockStart, stateBlockEnd);
    const startLine = 'INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" bash "${CONTROL_SCRIPT}" start-asbcp';

    expect(stateBlockStart).toBeGreaterThanOrEqual(0);
    expect(stateBlock).toContain('ASBCP_SERVICE_KEY_FINGERPRINT=');
    expect(stateBlock).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT=');
    expect(stateBlock).not.toContain('ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}"');
    expect(stateBlock).not.toContain('AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}"');
    expect(script).toContain(startLine);
  });

  it('starts the wrapper-owned AFSCP local runtime before ASBCP and cleans it up', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const trapIndex = script.indexOf('trap cleanup EXIT');
    const ensureIndex = script.indexOf('\nensure_release_user_story_afscp_local_runtime\n', trapIndex);
    const sandboxStartIndex = script.indexOf('info "starting ASBCP from locked image"', trapIndex);
    const cleanupStart = script.indexOf('cleanup() {');
    const cleanupEnd = script.indexOf('trap cleanup EXIT', cleanupStart);
    const cleanupBody = script.slice(cleanupStart, cleanupEnd);

    expect(script).toContain('resolve_afscp_local_runtime_defaults "${API_PORT}" "vol_release_user_story"');
    expect(script).toContain('ensure_release_user_story_afscp_local_runtime()');
    expect(script).toContain('stop_release_user_story_afscp_local_runtime()');
    expect(script).toContain('RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED=0');
    expect(script).toContain('INTEGRATION_AFSCP_DIR="${INTEGRATION_AFSCP_DIR:-${INTEGRATION_DIR}/afscp}"');
    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(ensureIndex).toBeGreaterThan(trapIndex);
    expect(sandboxStartIndex).toBeGreaterThan(ensureIndex);
    expect(cleanupBody).toContain('RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED');
    expect(cleanupBody).toContain('stop_release_user_story_afscp_local_runtime');
  });

  it('collects runtime readiness evidence before failing the release user story', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const collectorStart = script.indexOf('collect_release_user_story_runtime_readiness_evidence()');
    const runStart = script.indexOf('info "running full integration release user story"');
    const statusIndex = script.indexOf('release_user_story_status=${PIPESTATUS[0]}', runStart);
    const collectIndex = script.indexOf('collect_release_user_story_runtime_readiness_evidence "${release_user_story_status}"', statusIndex);
    const exitIndex = script.indexOf('exit "${release_user_story_status}"', collectIndex);

    expect(collectorStart).toBeGreaterThanOrEqual(0);
    expect(script).toContain('integration_release_user_story');
    expect(script).toContain('runtime-readiness-details.json');
    expect(script).toContain('scenario-failure-summary.txt');
    expect(script).toContain('release_user_story_failure_has_runtime_marker()');
    expect(script).toContain('RELEASE_USER_STORY_RUN_LOG="${INTEGRATION_DIR}/release-user-story-run.log"');
    expect(script).toContain('release_user_story_status=${PIPESTATUS[0]}');
    expect(script).toContain('classification=stability_blocker');
    expect(script).toContain('error_code=RUNTIME_READINESS_MARKER_OBSERVED');
    expect(script).not.toContain('call=runner_output_token_timeout status_code=timeout error_code=AGENT_SANDBOX_UNAVAILABLE');
    expect(script).toContain('k8s-pvc.txt');
    expect(script).toContain('release-user-story-run-log-tail.txt');
    expect(script).toContain('node "${ROOT_DIR}/scripts/governance/runtime-readiness-details.mjs"');
    expect(statusIndex).toBeGreaterThan(runStart);
    expect(collectIndex).toBeGreaterThan(statusIndex);
    expect(exitIndex).toBeGreaterThan(collectIndex);
  });

  it('does not classify runner output token mismatch as a runtime readiness marker', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'release-user-story-runtime-marker-'));
    const runnerPath = join(fixtureRoot, 'runner.sh');
    const mismatchLog = join(fixtureRoot, 'runner-output-mismatch.log');
    const runtimeLog = join(fixtureRoot, 'runtime-marker.log');

    try {
      writeFileSync(mismatchLog, [
        'Error: runner_output_token_timeout:task_1',
        'runner/runner_output: MANAGED_CONTIN_T2_OK',
        'pod=workload-release-story phase=Running ready=true',
        '',
      ].join('\n'));
      writeFileSync(runtimeLog, [
        'Error: runner_output_token_timeout:task_1',
        'API call summary request_id=req workload_id=workload phase=offline error_code=AGENT_SANDBOX_UNAVAILABLE',
        '',
      ].join('\n'));
      writeFileSync(runnerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        shellFunctionDefinition(script, 'release_user_story_failure_has_runtime_marker'),
        'release_user_story_failure_has_runtime_marker "$1"',
        '',
      ].join('\n'));

      const mismatch = spawnSync('bash', [runnerPath, mismatchLog], { encoding: 'utf8' });
      const runtime = spawnSync('bash', [runnerPath, runtimeLog], { encoding: 'utf8' });

      expect(mismatch.status).toBe(1);
      expect(runtime.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('applies sandbox namespace dependencies only after the wrapper-owned AFSCP reset', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const trapIndex = script.indexOf('trap cleanup EXIT');
    const depsIndex = script.indexOf('\nensure_release_user_story_integration_deps_for_afscp\n', trapIndex);
    const contextEnsureIndex = script.indexOf('\nensure_release_user_story_kubernetes_context\n', depsIndex);
    const csiIndex = script.indexOf('\nensure_afscp_storage_csi\n', contextEnsureIndex);
    const afscpIndex = script.indexOf('\nensure_release_user_story_afscp_local_runtime\n', csiIndex);
    const namespaceIndex = script.indexOf('\nensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"\n', afscpIndex);
    const renderExternalDepsIndex = script.indexOf('\nrender_k8s_external_dependency_services \\', namespaceIndex);
    const applyExternalDepsIndex = script.indexOf('\nkubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null', renderExternalDepsIndex);
    const sandboxStartIndex = script.indexOf('info "starting ASBCP from locked image"', applyExternalDepsIndex);

    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(depsIndex).toBeGreaterThan(trapIndex);
    expect(contextEnsureIndex).toBeGreaterThan(depsIndex);
    expect(csiIndex).toBeGreaterThan(contextEnsureIndex);
    expect(afscpIndex).toBeGreaterThan(csiIndex);
    expect(namespaceIndex).toBeGreaterThan(afscpIndex);
    expect(renderExternalDepsIndex).toBeGreaterThan(namespaceIndex);
    expect(applyExternalDepsIndex).toBeGreaterThan(renderExternalDepsIndex);
    expect(sandboxStartIndex).toBeGreaterThan(applyExternalDepsIndex);
  });

  it('passes a single AFSCP and ASBCP runtime truth to the child integration wrapper', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const childStart = script.indexOf('info "running full integration release user story"');
    const childBody = script.slice(childStart);

    expect(childStart).toBeGreaterThanOrEqual(0);
    for (const assignment of [
      'INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\',
      'AFSCP_BASE_URL="${AFSCP_BASE_URL}" \\',
      'AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \\',
      'AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \\',
      'AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \\',
      'AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \\',
      'AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \\',
      'AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \\',
      'AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \\',
      'AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \\',
      'ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\',
      'ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\',
      'AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \\',
    ]) {
      expect(childBody).toContain(assignment);
    }
  });

  it('derives Mongo URL from the release integration port truth instead of inheriting stale parent URLs', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const portDefaultIndex = script.indexOf('INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-27027}"');
    const mongoUrlIndex = script.indexOf('MONGO_URL="mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT}/admin"');
    const runtimeEnvStart = script.indexOf('with_release_user_story_afscp_runtime_env()');
    const runtimeEnvBody = script.slice(runtimeEnvStart, script.indexOf('\nensure_release_user_story_afscp_local_runtime()', runtimeEnvStart));
    const childStart = script.indexOf('info "running full integration release user story"');
    const childBody = script.slice(childStart);

    expect(portDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(mongoUrlIndex).toBeGreaterThan(portDefaultIndex);
    expect(runtimeEnvBody).toContain('export MONGO_URL="${MONGO_URL}"');
    expect(runtimeEnvBody).toContain('export MONGO_DB_NAME="${MONGO_DB_NAME}"');
    expect(childBody).toContain('MONGO_URL="${MONGO_URL}" \\');
    expect(childBody).toContain('MONGO_DB_NAME="${MONGO_DB_NAME}" \\');
  });

  it('keeps JVS details out of the release user story wrapper contract', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).not.toContain('JVS');
    expect(script).not.toContain('jvs');
  });
});
