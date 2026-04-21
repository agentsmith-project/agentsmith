import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

describe('rehearsal internal chat verification contract', () => {
  it('ships the internal chat spec in demo and cluster release bundles', () => {
    const demoBuild = read('scripts/demo-deploy/build-offline-bundle.sh');
    const clusterBuild = read('scripts/cluster-deploy/build-bundle.sh');

    expect(demoBuild).toContain('copy_bundle_file "${ROOT_DIR}/e2e/integration-internal-chat-runner.spec.ts"');
    expect(clusterBuild).toContain('copy_bundle_file "${ROOT_DIR}/e2e/integration-internal-chat-runner.spec.ts"');
  });

  it('runs internal chat verification in release-like demo full and cluster verify flows', () => {
    const demoVerify = read('scripts/demo-deploy/verify.sh');
    const clusterVerify = read('scripts/cluster-deploy/verify.sh');

    expect(demoVerify).toContain('DEMO_FULL_MODE_VERIFY_MOUNTS=()');
    expect(demoVerify).toContain('DEMO_FULL_MODE_VERIFY_ENV=()');
    expect(demoVerify).toContain('prepare_demo_full_mode_verify_inputs() {');
    expect(demoVerify).toContain('if ! demo_mode_is_full; then');
    expect(demoVerify).toContain('VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC="$(resolve_verify_source_file "e2e/integration-internal-chat-runner.spec.ts")"');
    expect(demoVerify).toContain('VERIFY_BUNDLED_KUBECTL="${RELEASE_ROOT}/tools/kubectl"');
    expect(demoVerify).toContain('[[ -x "${VERIFY_BUNDLED_KUBECTL}" ]] || die "bundled kubectl missing from release tools"');
    expect(demoVerify).toContain('VERIFY_KUBECONFIG_SOURCE="${KUBECONFIG:-}"');
    expect(demoVerify).toContain('[[ -f "${VERIFY_KUBECONFIG_SOURCE}" ]] || die "verify kubeconfig missing"');
    expect(demoVerify).toContain('DEMO_FULL_MODE_VERIFY_MOUNTS+=(');
    expect(demoVerify).toContain('-v "${VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC}:/app/e2e/integration-internal-chat-runner.spec.ts:ro"');
    expect(demoVerify).toContain('-v "${VERIFY_BUNDLED_KUBECTL}:/usr/local/bin/kubectl:ro"');
    expect(demoVerify).toContain('-v "${VERIFY_KUBECONFIG_SOURCE}:/tmp/verify-kubeconfig:ro"');
    expect(demoVerify).toContain('DEMO_FULL_MODE_VERIFY_ENV+=(');
    expect(demoVerify).toContain('-e KUBECONFIG=/tmp/verify-kubeconfig');
    expect(demoVerify).toContain('-e SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}"');
    expect(demoVerify).toContain('-e SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}"');
    expect(demoVerify).toContain('-e INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}"');
    expect(demoVerify).toContain('-e INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE="${CHAT_RUNNER_IMAGE}"');
    expect(demoVerify).toContain('-e INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE="${CHAT_RUNNER_IMAGE}"');
    expect(demoVerify).toContain('-e INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE=0');
    expect(demoVerify).toContain('-e INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE=0');
    expect(demoVerify).toContain('VERIFY_PLAYWRIGHT_SPECS=(');
    expect(demoVerify).toContain('prepare_demo_full_mode_verify_inputs');
    expect(demoVerify).toContain('VERIFY_PLAYWRIGHT_SPECS+=(e2e/integration-internal-chat-runner.spec.ts)');
    expect(demoVerify).toContain('"${DEMO_FULL_MODE_VERIFY_MOUNTS[@]}"');
    expect(demoVerify).toContain('"${DEMO_FULL_MODE_VERIFY_ENV[@]}"');

    expect(clusterVerify).toContain('VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC=');
    expect(clusterVerify).toContain('VERIFY_BUNDLED_KUBECTL="${RELEASE_ROOT}/tools/kubectl"');
    expect(clusterVerify).toContain('[[ -x "${VERIFY_BUNDLED_KUBECTL}" ]] || die "bundled kubectl missing from release tools"');
    expect(clusterVerify).toContain('ensure_operator_manager_kubeconfig');
    expect(clusterVerify).toContain('VERIFY_KUBECONFIG_SOURCE="${SHARED_MANAGER_KUBECONFIG}"');
    expect(clusterVerify).toContain('[[ -f "${VERIFY_KUBECONFIG_SOURCE}" ]] || die "verify kubeconfig missing"');
    expect(clusterVerify).toContain('infra_preflight_verify_kubeconfig');
    expect(clusterVerify).toContain('verify kubeconfig cannot read pods -n ${INTERNAL_AGENT_K8S_NAMESPACE}');
    expect(clusterVerify).toContain('get pods -n \\"${INTERNAL_AGENT_K8S_NAMESPACE}\\" >/dev/null');
    expect(clusterVerify).toContain('record_service verify_kubeconfig ready "${VERIFY_KUBECONFIG_SOURCE}"');
    expect(clusterVerify).toContain('-v "${VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC}:/app/e2e/integration-internal-chat-runner.spec.ts:ro"');
    expect(clusterVerify).toContain('-v "${VERIFY_BUNDLED_KUBECTL}:/usr/local/bin/kubectl:ro"');
    expect(clusterVerify).toContain('-v "${VERIFY_KUBECONFIG_SOURCE}:/tmp/verify-kubeconfig:ro"');
    expect(clusterVerify).toContain('-e KUBECONFIG=/tmp/verify-kubeconfig');
    expect(clusterVerify).toContain('-e SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL}"');
    expect(clusterVerify).toContain('-e SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY}"');
    expect(clusterVerify).toContain('-e INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE}"');
    expect(clusterVerify).toContain('-e INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE="${K8S_CHAT_RUNNER_IMAGE}"');
    expect(clusterVerify).toContain('-e INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE="${CHAT_RUNNER_IMAGE}"');
    expect(clusterVerify).toContain('-e INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE=0');
    expect(clusterVerify).toContain('-e INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE=0');
    expect(clusterVerify).toContain('e2e/integration-internal-chat-runner.spec.ts');
  });

  it('keeps the chat runner image available to demo full and cluster rehearsal targets', () => {
    const demoDeploy = read('scripts/demo-deploy/deploy.sh');
    const clusterBuild = read('scripts/cluster-deploy/build-bundle.sh');
    const clusterLib = read('scripts/cluster-deploy/lib.sh');

    expect(demoDeploy).toContain('CHAT_RUNNER_IMAGE="$(awk -F= \'$1=="agentsmith_chat_runner_image"{print $2}\' "${RELEASE_ROOT}/VERSION")"');
    expect(demoDeploy).toContain('"${CHAT_RUNNER_IMAGE}"');

    expect(clusterBuild).toContain('CHAT_RUNNER_IMAGE="$(awk -F= \'$1=="agentsmith_chat_runner_image"{print $2}\' "${BUNDLE_DIR}/VERSION")"');
    expect(clusterBuild).toContain('"${CHAT_RUNNER_IMAGE}"');

    expect(clusterLib).toContain('CHAT_RUNNER_IMAGE="$(read_version_value agentsmith_chat_runner_image)"');
    expect(clusterLib).toContain('K8S_CHAT_RUNNER_IMAGE="$(read_version_value agentsmith_chat_runner_k8s_image)"');
    expect(clusterLib).toContain('if [[ -z "${K8S_CHAT_RUNNER_IMAGE}" ]]; then');
    expect(clusterLib).toContain('"${CHAT_RUNNER_IMAGE}" \\');
  });
});
