import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkAsbcpImageOnly } from './check-asbcp-image-only';

const roots: string[] = [];

function writeFixture(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content, 'utf8');
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'asbcp-image-only-'));
  roots.push(root);
  writeFixture(root, 'infra/deploy/unified/env/site.env.example', 'ASBCP_IMAGE=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0@sha256:1111111111111111111111111111111111111111111111111111111111111111\n');
  writeFixture(root, 'scripts/unified-deploy/check-local-kind-images.ts', 'const repo = "mbos/agentsmith-sandbox-control-plane";\n');
  writeFixture(root, 'packages/api-entry-node/src/node-api-deps-factory.ts', 'const key = env.ASBCP_SERVICE_KEY;\n');
  writeFixture(root, 'scripts/lib/internal-sandbox-real-control.sh', [
    'ASBCP_IMAGE="${ASBCP_IMAGE:?}"',
    'ASBCP_CONFIG_PATH=/etc/asbcp/asbcp-config.yaml',
  ].join('\n'));
  writeFixture(root, 'scripts/lib/internal-backend-real-gate.sh', 'AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-control-plane}"\n');
  writeFixture(root, 'scripts/lib/runtime-verification.sh', 'const key = "ASBCP_INTERNAL_BASE_URL";\n');
  writeFixture(root, 'scripts/run-integration-e2e-full.sh', 'ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL:?}"\n');
  writeFixture(root, 'scripts/run-release-local-precheck.sh', 'ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY:-}"\n');
  writeFixture(root, 'scripts/sandbox-joint-integration-smoke.sh', 'ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY:?}"\n');
  writeFixture(root, 'infra/flows/local-manual-internal.env', 'AFSCP_ORCHESTRATOR_CALLER_SERVICE=agentsmith-sandbox-control-plane\n');
  writeFixture(root, 'Makefile', 'ASBCP_INTERNAL_BASE_URL ?= http://127.0.0.1:28080\n');
  writeFixture(root, 'docs/contracts/product-terminology.md', 'AgentSmith app includes ASBCP.\n');
  writeFixture(root, 'docs/contracts/unified-deploy-contract.md', 'ASBCP is an app workload.\n');
  writeFixture(root, 'docs/user-guides/unified-deploy-operations.md', 'AgentSmith app components include ASBCP.\n');
  writeFixture(root, 'e2e/integration-internal-sandbox-reclaim.spec.ts', 'if (!process.env.ASBCP_INTERNAL_BASE_URL) throw new Error("missing_ASBCP_INTERNAL_BASE_URL");\n');
  writeFixture(root, 'e2e/integration-real-helpers.ts', 'export function deleteInternalWorkloadViaAsbcp() { return process.env.ASBCP_SERVICE_KEY; }\n');
  writeFixture(root, 'src/components/agent-tasks/TaskPage.tsx', 'export const label = "ASBCP is server managed";\n');
  writeFixture(root, 'src/messages/en-US.json', '{"agent_tasks":{"asbcp":"Sandbox workload lifecycle service"}}\n');
  writeFixture(root, 'package.json', '{"scripts":{"contracts:check-asbcp-image-only":"tsx scripts/contracts/check-asbcp-image-only.ts"}}\n');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkAsbcpImageOnly', () => {
  it('accepts canonical ASBCP image-only consumer paths', () => {
    const root = fixtureRoot();

    expect(checkAsbcpImageOnly({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects sibling source builds and legacy ASBCP runtime surface', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/check-local-kind-images.ts', [
      'const source = "../mbos-sandbox-v1/manager-service";',
      'const image = "mbos/sandbox-manager:dev";',
      'const env = "SANDBOX_MANAGER_IMAGE SANDBOX_SERVICE_KEY";',
    ].join('\n'));
    writeFixture(root, 'infra/deploy/unified/templates/app/workloads.yaml.tpl', [
      'name: agentsmith-sandbox-manager',
      'mountPath: /etc/asbcp/config.yaml',
    ].join('\n'));
    writeFixture(root, 'Makefile', 'SANDBOX_MANAGER_URL ?= http://127.0.0.1:28080\n');
    writeFixture(root, 'docs/contracts/unified-deploy-contract.md', 'sandbox-manager is active.\n');
    writeFixture(root, 'docs/user-guides/unified-deploy-operations.md', 'Use sandbox-manager in active operations.\n');
    writeFixture(root, 'e2e/integration-internal-sandbox-reclaim.spec.ts', [
      'if (!process.env.SANDBOX_MANAGER_URL) throw new Error("missing_SANDBOX_MANAGER_URL");',
      'await runInternalSandboxControl("start-manager");',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('sibling ASBCP source path');
    expect(text).toContain('legacy local-kind ASBCP image repo');
    expect(text).toContain('legacy ASBCP env prefix');
    expect(text).toContain('legacy ASBCP service key env');
    expect(text).toContain('legacy ASBCP Kubernetes identity');
    expect(text).toContain('legacy ASBCP manager command alias');
    expect(text).toContain('legacy ASBCP config path');
    expect(text).toContain('Makefile:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/contracts/unified-deploy-contract.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/user-guides/unified-deploy-operations.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('e2e/integration-internal-sandbox-reclaim.spec.ts:active AgentSmith ASBCP consumer paths');
  });

  it('rejects ASBCP browser/client public env and service key leakage', () => {
    const root = fixtureRoot();
    writeFixture(root, 'src/components/agent-tasks/TaskPage.tsx', [
      'const browserBase = process.env.NEXT_PUBLIC_ASBCP_INTERNAL_BASE_URL;',
      'const browserSecret = "ASBCP_SERVICE_KEY";',
    ].join('\n'));
    writeFixture(root, 'src/messages/en-US.json', '{"settings":{"secret":"ASBCP_SERVICE_KEY"}}\n');

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('public ASBCP browser env');
    expect(text).toContain('ASBCP service key browser/client surface');
    expect(text).toContain('src/messages/en-US.json:active AgentSmith ASBCP consumer paths');
  });
});
