import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

describe("rehearsal managed agent-task verification contract", () => {
  it("does not ship removed internal chat runner specs in demo or cluster release bundles", () => {
    const demoBuild = read("scripts/demo-deploy/build-offline-bundle.sh");
    const clusterBuild = read("scripts/cluster-deploy/build-bundle.sh");

    for (const buildScript of [demoBuild, clusterBuild]) {
      expect(buildScript).not.toContain(
        "integration-internal-chat-runner.spec.ts",
      );
      expect(buildScript).not.toContain("integration-chat-local-upstream.ts");
      expect(buildScript).not.toContain("internal-chat-isolation-probe.ts");
    }
  });

  it("runs release-like verify flows with kube inputs and agent-task runner image env", () => {
    const demoVerify = read("scripts/demo-deploy/verify.sh");
    const clusterVerify = read("scripts/cluster-deploy/verify.sh");

    for (const verifyScript of [demoVerify, clusterVerify]) {
      expect(verifyScript).toContain("VERIFY_BUNDLED_KUBECTL=");
      expect(verifyScript).toContain("KUBECONFIG=/tmp/verify-kubeconfig");
      expect(verifyScript).toContain("INTEGRATION_AGENT_TASK_RUNNER_IMAGE");
      expect(verifyScript).toContain("INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE");
      expect(verifyScript).toContain("INTEGRATION_INTERNAL_AGENT_IMAGE");
      expect(verifyScript).not.toContain("INTEGRATION_CODEX_RUNNER");
      expect(verifyScript).not.toContain(
        "INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE",
      );
      expect(verifyScript).not.toContain(
        "INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE",
      );
      expect(verifyScript).not.toContain(
        "integration-internal-chat-runner.spec.ts",
      );
    }
  });

  it("keeps cluster managed runner verification host-reachable from kind workloads", () => {
    const clusterVerify = read("scripts/cluster-deploy/verify.sh");

    expect(clusterVerify).toContain(
      'INTEGRATION_INTERNAL_WORKLOAD_UPSTREAM_HOST_VALUE="${INTEGRATION_INTERNAL_WORKLOAD_UPSTREAM_HOST:-${RESOLVED_KIND_GATEWAY_HOST:-}}"',
    );
    expect(clusterVerify).toContain(
      'INTEGRATION_INTERNAL_WORKLOAD_UPSTREAM_HOST_VALUE="$(detect_kind_gateway_ip)"',
    );
    expect(clusterVerify).toContain(
      "managed runner verify upstream host is empty",
    );
    expect(clusterVerify).toContain(
      '-e INTEGRATION_INTERNAL_WORKLOAD_UPSTREAM_HOST="${INTEGRATION_INTERNAL_WORKLOAD_UPSTREAM_HOST_VALUE}"',
    );
  });

  it("keeps the agent-task runner image available to demo full and cluster rehearsal targets", () => {
    const demoDeploy = read("scripts/demo-deploy/deploy.sh");
    const clusterBuild = read("scripts/cluster-deploy/build-bundle.sh");
    const clusterLib = read("scripts/cluster-deploy/lib.sh");

    expect(demoDeploy).toContain(
      'AGENT_TASK_RUNNER_IMAGE="$(awk -F= \'$1=="agentsmith_agent_task_runner_image"{print $2}\' "${RELEASE_ROOT}/VERSION")"',
    );
    expect(demoDeploy).toContain('"${AGENT_TASK_RUNNER_IMAGE}"');

    expect(clusterBuild).toContain(
      'AGENT_TASK_RUNNER_IMAGE="$(awk -F= \'$1=="agentsmith_agent_task_runner_image"{print $2}\' "${BUNDLE_DIR}/VERSION")"',
    );
    expect(clusterBuild).toContain('"${AGENT_TASK_RUNNER_IMAGE}"');

    expect(clusterLib).toContain(
      'AGENT_TASK_RUNNER_IMAGE="$(read_version_value agentsmith_agent_task_runner_image)"',
    );
    expect(clusterLib).toContain('"${AGENT_TASK_RUNNER_IMAGE}" \\');
    expect(clusterLib).not.toContain(
      'CHAT_RUNNER_IMAGE="$(read_version_value agentsmith_chat_runner_image)"',
    );
  });
});
