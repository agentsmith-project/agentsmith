import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkAsbcpImageOnly, collectAsbcpImageOnlyFiles } from './check-asbcp-image-only';

const historicalMigrationPlanPath = 'docs/engineering/agentsmith-sandbox-control-plane-release-independence-plan-v1.md';

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
  writeFixture(root, 'docs/contracts/product-terminology.md', 'ASBCP is a developer/operator deployment term only.\n');
  writeFixture(root, 'docs/contracts/unified-deploy-contract.md', 'ASBCP is a deployment/internal backend dependency, not a product-facing route.\n');
  writeFixture(root, 'docs/contracts/agent-task-frontend-module-map.md', 'Agent task pages describe the task execution environment.\n');
  writeFixture(root, 'docs/UXUI/00-设计系统/状态与文案规范-v1.md', '用户侧错误文案使用任务执行环境。\n');
  writeFixture(root, 'docs/user-guides/alert-center.md', 'Alert Center describes task execution environment incidents.\n');
  writeFixture(root, 'docs/user-guides/unified-deploy-operations.md', 'Pinned internal component image adoption points to the unified deploy contract.\n');
  writeFixture(root, 'e2e/integration-internal-sandbox-reclaim.spec.ts', 'if (!process.env.ASBCP_INTERNAL_BASE_URL) throw new Error("missing_ASBCP_INTERNAL_BASE_URL");\n');
  writeFixture(root, 'e2e/integration-real-helpers.ts', 'export function deleteInternalWorkloadViaAsbcp() { return process.env.ASBCP_SERVICE_KEY; }\n');
  writeFixture(root, 'src/app/api/internal/asbcp/route.ts', 'const base = process.env.ASBCP_INTERNAL_BASE_URL;\n');
  writeFixture(root, 'src/components/agent-tasks/TaskPage.tsx', 'export const label = "Task execution environment is server managed";\n');
  writeFixture(root, 'src/messages/en-US.json', '{"agent_tasks":{"execution_environment":"Task execution environment"}}\n');
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
      'const env = "SANDBOX_MANAGER_IMAGE SANDBOX_SERVICE_KEY SANDBOX_SOURCE_DIR";',
      'const sourceArg = "--sandbox-source-dir";',
      'const modulePath = "github.com/sandbox/manager";',
    ].join('\n'));
    writeFixture(root, 'infra/deploy/unified/templates/app/workloads.yaml.tpl', [
      'name: agentsmith-sandbox-manager',
      'mountPath: /etc/asbcp/config.yaml',
      'legacyMountPath: /etc/sandbox-manager/manager-config.yaml',
    ].join('\n'));
    writeFixture(root, 'Makefile', 'SANDBOX_MANAGER_URL ?= http://127.0.0.1:28080\n');
    writeFixture(root, 'docs/contracts/unified-deploy-contract.md', 'sandbox-manager is active.\n');
    writeFixture(root, 'docs/user-guides/alert-center.md', 'Use sandbox-manager in active operations.\n');
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
    expect(text).toContain('legacy ASBCP source dir env');
    expect(text).toContain('legacy ASBCP source dir flag');
    expect(text).toContain('legacy ASBCP module path');
    expect(text).toContain('legacy ASBCP Kubernetes identity');
    expect(text).toContain('legacy ASBCP manager command alias');
    expect(text).toContain('legacy ASBCP config path');
    expect(text).toContain('legacy ASBCP manager config path');
    expect(text).toContain('Makefile:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/contracts/unified-deploy-contract.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/user-guides/alert-center.md:active AgentSmith ASBCP consumer paths');
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

  it('rejects legacy sandbox control plane manager source paths and env prefix', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/check-local-kind-images.ts', [
      'const directManagerPath = "cmd/manager";',
      'const relativeManagerPath = "./cmd/manager";',
      'const directCleanerPath = "cmd/cleaner";',
      'const legacyApiPath = "/v1/sandboxes";',
      'const legacyEnv = "SANDBOX_CONTROL_PLANE_IMAGE";',
      'const camelName = "sandboxControlPlane SandboxControlPlane";',
      'const snakeName = "sandbox_control_plane";',
    ].join('\n'));
    writeFixture(root, 'scripts/unified-deploy/check-render.ts', [
      'const display = "sandbox manager";',
      'const title = "Sandbox Manager";',
      'const snake = "sandbox_manager";',
      'const camel = "sandboxManager SandboxManager";',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('legacy ASBCP manager source command path');
    expect(text).toContain('legacy ASBCP cleaner source command path');
    expect(text).toContain('legacy ASBCP sandboxes API path');
    expect(text).toContain('legacy ASBCP sandbox control plane env prefix');
    expect(text).toContain('legacy ASBCP sandbox control plane symbol');
    expect(text).toContain('legacy ASBCP manager display name');
    expect(text).toContain('legacy ASBCP component snake name');
    expect(text).toContain('legacy ASBCP manager camel name');
    expect(text).toContain('scripts/unified-deploy/check-local-kind-images.ts:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('scripts/unified-deploy/check-render.ts:active AgentSmith ASBCP consumer paths');
    expect(text).not.toContain('mbos/agentsmith-sandbox-control-plane');
  });

  it('keeps the SANDBOX_CONTROL_PLANE ban scoped away from hyphenated service names', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/check-local-kind-images.ts', [
      'const canonicalService = "agentsmith-sandbox-control-plane";',
      'const localShorthand = "sandbox-control-plane";',
      'const localKindRepo = "mbos/agentsmith-sandbox-control-plane";',
    ].join('\n'));

    expect(checkAsbcpImageOnly({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('scans the exact historical migration plan while allowing its migration note residue', () => {
    const root = fixtureRoot();
    writeFixture(root, historicalMigrationPlanPath, [
      'Historical/reference migration note for ../mbos-sandbox-v1 and sandbox-manager clean cut.',
      'Old examples include SANDBOX_MANAGER_IMAGE, SANDBOX_SERVICE_KEY, /etc/sandbox-manager/manager-config.yaml, and cmd/manager.',
      'User-facing copy must not expose ASBCP, control plane, workload lifecycle, sandbox, or sandbox workload terminology.',
    ].join('\n'));

    expect(collectAsbcpImageOnlyFiles({ rootDir: root })).toContain(historicalMigrationPlanPath);
    expect(checkAsbcpImageOnly({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects legacy terms in the historical migration plan when its historical marker is removed', () => {
    const root = fixtureRoot();
    writeFixture(root, historicalMigrationPlanPath, [
      'Active migration guidance for ../mbos-sandbox-v1 and sandbox-manager rollout.',
      'Use SANDBOX_MANAGER_IMAGE and /etc/sandbox-manager/manager-config.yaml for current operations.',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain(`${historicalMigrationPlanPath}:active AgentSmith ASBCP consumer paths`);
    expect(text).toContain('sibling ASBCP source path');
    expect(text).toContain('legacy ASBCP component name');
    expect(text).toContain('legacy ASBCP env prefix');
  });

  it('rejects bare sandbox terminology in user-facing surfaces without blocking hyphenated operational identifiers', () => {
    const root = fixtureRoot();
    writeFixture(root, 'docs/user-guides/unified-deploy-operations.md', [
      'kubectl --context kind-agentsmith delete namespace agentsmith-sandbox --ignore-not-found=true',
    ].join('\n'));

    expect(checkAsbcpImageOnly({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });

    writeFixture(root, 'docs/user-guides/alert-center.md', 'The sandbox is unavailable.\n');

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('user-facing sandbox terminology');
    expect(text).toContain('docs/user-guides/alert-center.md:active AgentSmith ASBCP consumer paths');
  });

  it('keeps ASBCP adoption details out of user guides', () => {
    const root = fixtureRoot();
    writeFixture(root, 'docs/user-guides/unified-deploy-operations.md', [
      'ASBCP is an internal backend service for deployment operators.',
      'Use the agentsmith-sandbox-control-plane Kubernetes service during rollout diagnostics.',
      'The operator evidence can include ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0@sha256:abcdef1234567890.',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('user-facing ASBCP term');
    expect(text).toContain('user-facing ASBCP image reference');
    expect(text).toContain('user-facing image digest');
    expect(text).toContain('docs/user-guides/unified-deploy-operations.md:active AgentSmith ASBCP consumer paths');
  });

  it('rejects legacy ASBCP names in active file paths while preserving negative fixtures', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/sandbox-manager-image.lock', 'image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0\n');
    writeFixture(root, 'infra/deploy/unified/templates/app/sandbox-manager-pv-rbac.yaml.tpl', 'kind: Role\n');
    writeFixture(root, 'scripts/unified-deploy/local-kind-images.test.ts', [
      'const legacyEnv = "SANDBOX_SOURCE_DIR";',
      'const legacyArg = "--sandbox-source-dir";',
      'const legacyModule = "github.com/sandbox/manager";',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('scripts/unified-deploy/sandbox-manager-image.lock:active AgentSmith ASBCP consumer file paths');
    expect(text).toContain('infra/deploy/unified/templates/app/sandbox-manager-pv-rbac.yaml.tpl:active AgentSmith ASBCP consumer file paths');
    expect(text).not.toContain('scripts/unified-deploy/local-kind-images.test.ts');
  });

  it('allows legacy residue negative evidence only at the exact path with an explicit reason marker', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/asbcp-legacy-residue-negative-evidence.ts', [
      'export const OLD_ID = "agentsmith-sandbox-manager"; // allow-asbcp-legacy-residue-negative-evidence',
      'export const OLD_COMPONENT = "sandbox-manager"; // allow-asbcp-legacy-residue-negative-evidence',
      'export const OLD_CHECKSUM = "checksum-sandbox-manager"; // allow-asbcp-legacy-residue-negative-evidence',
      'export const OLD_COMPONENT_SNAKE = "sandbox_manager"; // allow-asbcp-legacy-residue-negative-evidence',
    ].join('\n'));

    expect(checkAsbcpImageOnly({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects legacy residue old names at the exact path when the reason marker is missing', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/asbcp-legacy-residue-negative-evidence.ts', [
      'export const OLD_ID = "agentsmith-sandbox-manager";',
      'export const OLD_COMPONENT = "sandbox-manager";',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('scripts/unified-deploy/asbcp-legacy-residue-negative-evidence.ts:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('legacy ASBCP Kubernetes identity');
    expect(text).toContain('legacy ASBCP component name');
  });

  it('rejects legacy residue reason markers outside the exact negative-evidence path', () => {
    const root = fixtureRoot();
    writeFixture(root, 'scripts/unified-deploy/check-local-kind-images.ts', [
      'const oldId = "agentsmith-sandbox-manager"; // allow-asbcp-legacy-residue-negative-evidence',
      'const oldComponent = "sandbox-manager"; // allow-asbcp-legacy-residue-negative-evidence',
      'const oldSnake = "sandbox_manager"; // allow-asbcp-legacy-residue-negative-evidence',
    ].join('\n'));

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('scripts/unified-deploy/check-local-kind-images.ts:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('legacy ASBCP Kubernetes identity');
    expect(text).toContain('legacy ASBCP component name');
    expect(text).toContain('legacy ASBCP component snake name');
  });

  it('rejects user-facing ASBCP/internal key and engineering terminology leakage', () => {
    const root = fixtureRoot();
    writeFixture(root, 'docs/user-guides/alert-center.md', [
      'ASBCP is unavailable.',
      'ASBCP_INTERNAL_BASE_URL is not configured.',
      'ASBCP_SERVICE_KEY is missing.',
      'ASBCP_IMAGE points to ghcr.io/example/app:v1@sha256:abcdef1234567890.',
      'The control plane is restarting.',
      'The workload lifecycle failed.',
      'The sandbox workload failed with an internal URL.',
    ].join('\n'));
    writeFixture(root, 'docs/contracts/agent-task-frontend-module-map.md', [
      'Show ASBCP status on the task page.',
      'Expose ghcr.io/example/app:v1@sha256:abcdef1234567890 for debugging.',
    ].join('\n'));
    writeFixture(root, 'docs/UXUI/00-设计系统/状态与文案规范-v1.md', [
      '错误文案展示 ASBCP_INTERNAL_BASE_URL。',
      '失败原因包含 internal URL。',
    ].join('\n'));
    writeFixture(root, 'src/components/agent-tasks/TaskPage.tsx', [
      'export const title = "ASBCP status";',
      'export const details = "The control plane cannot complete workload lifecycle checks";',
    ].join('\n'));
    writeFixture(root, 'src/messages/en-US.json', '{"agent_tasks":{"asbcp":"ASBCP_SERVICE_KEY missing in control plane"}}\n');

    const text = checkAsbcpImageOnly({ rootDir: root }).failures
      .map((failure) => `${failure.path}:${failure.message}`)
      .join('\n');

    expect(text).toContain('user-facing ASBCP term');
    expect(text).toContain('user-facing ASBCP internal base URL');
    expect(text).toContain('user-facing ASBCP service key');
    expect(text).toContain('user-facing ASBCP image input');
    expect(text).toContain('user-facing ASBCP image reference');
    expect(text).toContain('user-facing image digest');
    expect(text).toContain('user-facing control plane terminology');
    expect(text).toContain('user-facing workload lifecycle terminology');
    expect(text).toContain('user-facing sandbox workload terminology');
    expect(text).toContain('user-facing internal URL terminology');
    expect(text).toContain('docs/user-guides/alert-center.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/contracts/agent-task-frontend-module-map.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('docs/UXUI/00-设计系统/状态与文案规范-v1.md:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('src/components/agent-tasks/TaskPage.tsx:active AgentSmith ASBCP consumer paths');
    expect(text).toContain('src/messages/en-US.json:active AgentSmith ASBCP consumer paths');
    expect(text).not.toContain('docs/contracts/unified-deploy-contract.md:active AgentSmith ASBCP consumer paths');
  });
});
