import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(path.join(rootDir, relativePath), "utf8"),
  ) as unknown;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

const failures: string[] = [];

function requireMatch(content: string, pattern: RegExp, message: string): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function forbidMatch(content: string, pattern: RegExp, message: string): void {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

function requireScript(
  scripts: Record<string, string>,
  name: string,
  expected: string,
): void {
  if (scripts[name] !== expected) {
    failures.push(`package.json ${name} must be "${expected}"`);
  }
}

function forbidScript(scripts: Record<string, string>, name: string): void {
  if (Object.prototype.hasOwnProperty.call(scripts, name)) {
    failures.push(`package.json must not expose legacy script ${name}`);
  }
}

function forbidPath(relativePath: string, message: string): void {
  if (existsSync(path.join(rootDir, relativePath))) {
    failures.push(message);
  }
}

function requirePath(relativePath: string, message: string): void {
  if (!existsSync(path.join(rootDir, relativePath))) {
    failures.push(message);
  }
}

function collectTextFiles(
  relativeDir: string,
  extensions: readonly string[],
): string[] {
  const fullDir = path.join(rootDir, relativeDir);
  if (!existsSync(fullDir)) return [];
  const results: string[] = [];

  for (const entry of readdirSync(fullDir)) {
    const fullPath = path.join(fullDir, entry);
    const relativePath = path
      .relative(rootDir, fullPath)
      .replaceAll(path.sep, "/");
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTextFiles(relativePath, extensions));
      continue;
    }
    if (
      stat.isFile() &&
      extensions.some((extension) => relativePath.endsWith(extension))
    ) {
      results.push(relativePath);
    }
  }

  return results.sort();
}

function uniqueSorted(paths: readonly string[]): string[] {
  return Array.from(new Set(paths)).sort();
}

function forbidRunnerWireMatches(
  filePath: string,
  content: string,
  patterns: readonly (readonly [RegExp, string, string])[],
): void {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [pattern, label, source] of patterns) {
      if (pattern.test(line)) {
        failures.push(
          `${filePath}:${index + 1} must not expose ${label} (${source}): ${line.trim()}`,
        );
      }
    }
  }
}

function isRunnerWireNegativeProofLine(line: string): boolean {
  return /not\.toContain\(|release_check_forbid_pattern/.test(line);
}

function requireRunnerWireNegativeProofMatches(
  filePath: string,
  content: string,
  patterns: readonly (readonly [RegExp, string, string])[],
): void {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [pattern, label, source] of patterns) {
      if (pattern.test(line) && !isRunnerWireNegativeProofLine(line)) {
        failures.push(
          `${filePath}:${index + 1} must keep ${label} (${source}) only in a negative proof line: ${line.trim()}`,
        );
      }
    }
  }
}

function isAllowedPublicRestNegativeProofLine(
  lines: string[],
  index: number,
): boolean {
  const line = lines[index] ?? "";
  const nearby = lines.slice(index, index + 3).join("\n");
  return (
    /toBeNull\(|not\.to(?:Contain|Match|Equal)|do not add|does not match|not a target alias|negative proof|must not expose|forbid|unsupported|reject/i.test(
      line,
    ) ||
    (/matchProjectsRoute\(/.test(line) && /toBeNull\(/.test(nearby))
  );
}

function forbidActivePublicRestMatches(
  filePath: string,
  content: string,
  patterns: readonly (readonly [RegExp, string, string])[],
): void {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [pattern, label, source] of patterns) {
      if (
        pattern.test(line) &&
        !isAllowedPublicRestNegativeProofLine(lines, index)
      ) {
        failures.push(
          `${filePath}:${index + 1} must not expose ${label} (${source}): ${line.trim()}`,
        );
      }
    }
  }
}

function isAllowedLegacyProductLine(filePath: string, line: string): boolean {
  if (filePath === "docs/contracts/product-terminology.md") {
    return /Removed or restricted|`Notebook`|`Agents`|`Execution target`|not `Execution target`|not `Notebook`|not `Agents`|old term|removed-terms|removed term|negative contract tests|negative-test evidence|negative-contract evidence|breaking allowlists|forbidden or removed|not expose Chat\/Notebook/.test(
      line,
    );
  }
  if (filePath === "docs/contracts/route-gate-test-checklist.md") {
    return /do not add `\/notebook` or `\/agents` aliases/.test(line);
  }
  if (filePath === "docs/contracts/agent-runners-frontend-module-map.md") {
    return /must not expose Chat\/Notebook type selectors/.test(line);
  }
  if (filePath === "docs/contracts/chat-frontend-module-map.md") {
    return /removed `external_agent_id`|negative-contract evidence/.test(line);
  }
  if (filePath === "docs/contracts/agent-execution-protocol.md") {
    return /removed `external_agent_id`|negative-contract evidence|removed view name.*notebook\.task_terminal|notebook\.task_terminal.*negative-contract evidence/.test(
      line,
    );
  }
  if (filePath === "docs/contracts/api-entry-node-module-map.md") {
    return /external_agent_id.*(旧字段|拒收证据|unsupported_field)/.test(line);
  }
  if (filePath === "docs/contracts/backend-storage-architecture-matrix.md") {
    return /packages\/api-entry-node\/src\/notebook-(?:task|trace)/.test(line);
  }
  if (filePath === "docs/user-guides/workspace-isolation-model.md") {
    return /`agents`|`notebook_/.test(line);
  }
  if (filePath === "docs/contracts/specs/openapi-route-kind-map.json") {
    return /"agents"\s*:/.test(line);
  }
  if (filePath === "src/mocks/fixtures/p0.json") {
    return /"agents"\s*:/.test(line);
  }
  if (
    filePath === "src/mocks/handlers/tasks.ts" ||
    filePath === "src/mocks/fixtures/index.ts"
  ) {
    return /['"]\.\.\/(?:fixtures|doc-fixtures)\/notebook['"]|['"]\.\/notebook['"]/.test(
      line,
    );
  }
  if (filePath === "src/mocks/handlers/chat.ts") {
    return /external_agent_id|unsupported_field/.test(line);
  }
  if (
    filePath === "docs/contracts/specs/openapi.yaml" ||
    filePath === "docs/contracts/specs/openapi.json" ||
    filePath === "src/lib/api/types.generated.ts"
  ) {
    return /Legacy fields|Unsupported legacy|runner_runtime|interaction_kind/.test(
      line,
    );
  }
  if (filePath.startsWith("packages/agent-runner/src/")) {
    return /unsupported|reject|not\.toHaveProperty|interaction_kind|chat|notebook|external_agent_id|chat_runner|notebook_runner/.test(
      line,
    );
  }
  return false;
}

function forbidActiveProductSurfaceMatches(
  filePath: string,
  content: string,
  patterns: readonly (readonly [RegExp, string])[],
): void {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (isAllowedLegacyProductLine(filePath, line)) continue;
    for (const [pattern, label] of patterns) {
      if (pattern.test(line)) {
        failures.push(
          `${filePath}:${index + 1} must not expose ${label}: ${line.trim()}`,
        );
      }
    }
  }
}

function isAllowedActiveRuntimeEvidenceLine(
  filePath: string,
  lines: string[],
  index: number,
): boolean {
  if (filePath.startsWith("docs/archive/")) return true;
  if (filePath === "docs/contracts/specs/openapi-breaking-allowlist.json")
    return true;

  const context = lines
    .slice(Math.max(0, index - 12), Math.min(lines.length, index + 10))
    .join("\n");

  if (
    /not\.to(?:Contain|Match|HaveProperty|HaveBeenCalled|Equal)|toBeNull\(|reject|unsupported|invalid_reconnect_payload|release_check_forbid_pattern|negative(?: proof| test| contract)?|forbid|forbidden|removed|retired|must not|should not|do not add|does not match|not a target alias|no longer depends|does not define supported runtime|without\s+(?:legacy\s+)?(?:chat|notebook|internal chat|chat\/notebook)/i.test(
      context,
    )
  ) {
    return true;
  }

  return (
    /(?:cleanup|audit|allowlist|evolution)/i.test(filePath) &&
    /one-shot cleanup|cleanup evidence|assertion evidence|audit evidence|breaking allowlist/i.test(
      context,
    )
  );
}

function forbidActiveRuntimeSurfaceMatches(
  filePath: string,
  content: string,
  patterns: readonly (readonly [RegExp, string, string])[],
): void {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [pattern, label, source] of patterns) {
      if (
        pattern.test(line) &&
        !isAllowedActiveRuntimeEvidenceLine(filePath, lines, index)
      ) {
        failures.push(
          `${filePath}:${index + 1} must not expose ${label} (${source}): ${line.trim()}`,
        );
      }
    }
  }
}

const activeGovernanceDocFiles = [
  "AGENTS.md",
  "DEVELOPMENT.md",
  "docs/README.md",
  "docs/CURRENT_BASELINE.md",
  "docs/troubleshooting-guide-v1.md",
  "docs/engineering/agentsmith-chat-agent-runner-evolution-plan-v1.md",
  "docs/engineering/agent-task-terminal-recovery-and-message-footer-improvement-plan-v1.md",
  "docs/contracts/user-story-contract-v1.md",
] as const;

const activeRuntimeSurfaceFiles = uniqueSorted([
  ...activeGovernanceDocFiles,
  ".github/workflows/integration-e2e.yml",
  "README.md",
  ...collectTextFiles("e2e", [".ts", ".tsx", ".md", ".json"]),
  ...collectTextFiles("packages/api-entry-node/src", [".test.ts"]),
  ...collectTextFiles("packages/contracts/src", [".test.ts"]),
  ...collectTextFiles("scripts", [".sh", ".ts"]).filter(
    (filePath) => !filePath.startsWith("scripts/contracts/"),
  ),
]);

const activeApiEntryRuntimeFiles = collectTextFiles("packages/api-entry-node/src", [
  ".ts",
]).filter(
  (filePath) =>
    !filePath.endsWith(".test.ts") &&
    !filePath.includes("/__integration__/"),
);

const rootPackage = readJson("package.json") as {
  scripts?: Record<string, string>;
};
const scripts = rootPackage.scripts ?? {};
const makefile = readText("Makefile");
const integrationWorkflow = readText(".github/workflows/integration-e2e.yml");
const runnerImageCommon = readText("scripts/lib/runner-image-common.sh");
const buildRunnerImageScript = readText("scripts/build-runner-image.sh");
const appDeployCommon = readText("scripts/app/deploy-common.sh");
const deployCommon = readText("scripts/lib/deploy-common.sh");
const bootstrapCommon = readText("scripts/lib/bootstrap-common.sh");
const presetCommon = readText("scripts/lib/preset-common.sh");
const skillsFastGate = readText("scripts/skills-runtime-fast-gate.sh");
const skillsBackendRealGate = readText(
  "scripts/skills-runtime-backend-real-gate.sh",
);
const backendRealRun = readText("scripts/backend-real-run.sh");
const backendRealSessionWrapper = readText(
  "scripts/run-backend-real-session-shards.sh",
);
const integrationE2eFull = readText("scripts/run-integration-e2e-full.sh");
const integrationRealHelpers = readText("e2e/integration-real-helpers.ts");
const currentCoverageManifest = readText(
  "scripts/governance/current-real-session-coverage-manifest.ts",
);
const impactSelector = readText("scripts/governance/verify-impact-selector.ts");
const backendRealBootstrap = readText("scripts/backend-real-bootstrap.sh");
const buildReliabilitySmoke = readText("scripts/build-reliability-smoke.sh");
const agentTaskBackendRealSpecFiles = [
  "e2e/integration-agent-task-runner.spec.ts",
  "e2e/integration-agent-task-terminal-ux.spec.ts",
] as const;
const afscpBoundaryActiveFiles = [
  "scripts/run-internal-agent-task-real-gate.sh",
  "scripts/lib/internal-backend-real-gate.sh",
  "scripts/run-integration-e2e-full.sh",
  "scripts/run-integration-release-user-story.sh",
  "scripts/run-release-local-precheck.sh",
  "scripts/local-manual/internal-common.sh",
  "scripts/local-manual/start-api.sh",
  "infra/flows/local-manual-internal.env",
  "packages/api-entry-node/src/node-api-deps-factory.ts",
  "infra/deploy/unified/templates/app/config.yaml.tpl",
  "infra/deploy/unified/templates/app/workloads.yaml.tpl",
] as const;
const retiredAfscpBoundaryPatterns = [
  [/INTERNAL_AGENT_JUICEFS/u, "INTERNAL_AGENT_JUICEFS_*"],
  [/JUICEFS_BUCKET_ENDPOINT/u, "JUICEFS_BUCKET_ENDPOINT_*"],
  [/FILE_LIBRARY_GATEWAY/u, "FILE_LIBRARY_GATEWAY_*"],
  [/AGENT_RUNNER_DEVELOPER_JUICEFS/u, "AGENT_RUNNER_DEVELOPER_JUICEFS_*"],
  [/INTEGRATION_CLIENT_JUICEFS/u, "INTEGRATION_CLIENT_JUICEFS_*"],
  [/MBOS_AGENT_JUICEFS_MOUNT/u, "MBOS_AGENT_JUICEFS_MOUNT_*"],
] as const;

const activeTextFiles = [
  ".github/workflows/integration-e2e.yml",
  "AGENTS.md",
  "DEVELOPMENT.md",
  "Makefile",
  "package-lock.json",
  "README.md",
  "docs/README.md",
  "docs/CURRENT_BASELINE.md",
  "docs/ci-integration-troubleshooting.md",
  "docs/agent-task-runner-runbook.md",
  "docs/engineering/agent-task-terminal-recovery-and-message-footer-improvement-plan-v1.md",
  "docs/troubleshooting-guide-v1.md",
  "docs/user-guides/local-runtime-flows.md",
  "infra/deploy/Dockerfile.agentsmith-app-base",
  "infra/deploy/Dockerfile.agentsmith-verify-runner-base",
  "infra/runner/Dockerfile.agent-task-runner",
  "infra/runner/Dockerfile.agent-task-runner-base",
  "scripts/backend-real-bootstrap.sh",
  "scripts/backend-real-run.sh",
  "scripts/build-reliability-smoke.sh",
  "scripts/check-preset-agent-task-file-library.sh",
  "scripts/feishu-real-manual-step.sh",
  "scripts/file-library-real-smoke.sh",
  "scripts/governance-config-audit-effect-smoke.sh",
  "scripts/governance-member-lifecycle-effect-smoke.sh",
  "scripts/governance-member-permission-effect-smoke.sh",
  "scripts/governance-policy-access-effect-smoke.sh",
  "scripts/governance-policy-effect-smoke.sh",
  "scripts/governance-policy-group-access-effect-smoke.sh",
  "scripts/governance-policy-requests-rate-effect-smoke.sh",
  "scripts/governance-policy-spending-effect-smoke.sh",
  "scripts/governance-policy-update-audit-smoke.sh",
  "scripts/governance/current-real-session-coverage-manifest.ts",
  "scripts/governance/current-runtime-line-manifest.ts",
  "scripts/governance/current-workflow-manifest.ts",
  "scripts/governance/check-definitions.ts",
  "scripts/governance/failure-classifier.ts",
  "scripts/governance/verify-impact-selector.ts",
  "scripts/governance/sync-current-runtime-line-docs.ts",
  "scripts/contracts/check-current-gates.ts",
  "scripts/local-manual/internal-common.sh",
  "scripts/local-manual/internal-smoke.sh",
  "scripts/local-manual/internal-up.sh",
  "scripts/local-manual/owner-janitor.ts",
  "scripts/local-manual/seed-agent-task-diagnostics.sh",
  "scripts/local-manual/start-runner.sh",
  "scripts/local-manual/status.sh",
  "scripts/local-manual/up.sh",
  "scripts/local-manual/verify-agent-task-diagnostics.sh",
  "scripts/preprod-capture-baseline.sh",
  "scripts/internal-ownership-backend-real-gate.sh",
  "scripts/lib/runtime-verification.sh",
  "scripts/run-agent-task-runner-dev.sh",
  "scripts/run-internal-agent-task-real-gate.sh",
  "scripts/run-integration-e2e-full.sh",
  "scripts/run-backend-real-session-shards.sh",
  "scripts/sandbox-joint-integration-smoke.sh",
  "scripts/skills-runtime-fast-gate.sh",
  "scripts/skills-runtime-backend-real-gate.sh",
] as const;

const activeRunnerWireFiles = [
  "package.json",
  "Makefile",
  "docs/contracts/agent-execution-protocol.md",
  "docs/contracts/specs/asyncapi.yaml",
  "docs/contracts/specs/asyncapi.json",
  "docs/contracts/specs/agent-execution-ws-supplement.asyncapi.yaml",
  "docs/contracts/specs/agent-execution-ws-supplement.asyncapi.json",
  "packages/api-entry-node/src/agent-execution-service.ts",
  "packages/api-entry-node/src/agent-resource-service.ts",
  "packages/api-entry-node/src/agent-runner-profile.ts",
  "packages/api-entry-node/src/internal-agent-pod-manager.ts",
  "packages/api-entry-node/src/notebook-execution-orchestrator.ts",
  "packages/agent-runner/src/protocol.ts",
  "scripts/local-manual/start-api.sh",
  "scripts/run-integration-e2e-full.sh",
  "scripts/run-integration-release-user-story.sh",
  "scripts/run-release-local-precheck.sh",
] as const;

const runnerWireForbiddenPatterns = [
  [/EXTERNAL_AGENT_/, "formal external agent runtime env", "EXTERNAL_AGENT_"],
  [
    /DOCKER_MANUAL_AGENT_/,
    "formal docker manual agent runtime env",
    "DOCKER_MANUAL_AGENT_",
  ],
  [
    /\/agent-execution\/ws[^\n'"`]*[?&]agent_id=/,
    "legacy runner websocket agent query",
    "/agent-execution/ws.*agent_id=",
  ],
  [
    /\/agent-execution\/ws[^\n'"`]*[?&]session_id=/,
    "legacy runner websocket session query",
    "/agent-execution/ws.*session_id=",
  ],
  [/\bexternal_host\b/, "legacy external host runner mode", "external_host"],
  [/\bhost_external\b/, "legacy host external runner mode", "host_external"],
  [
    /\bagent:test-runner\b/,
    "legacy external agent test runner npm script",
    "agent:test-runner",
  ],
  [
    /\bagent-test-runner\b/,
    "legacy external agent test runner Make target",
    "agent-test-runner",
  ],
] as const;

const runnerWireNegativeProofFiles: readonly string[] = [];

const activePublicRestContractFiles = [
  "packages/api-entry-node/src/projects-route-match.ts",
  "packages/api-entry-node/src/projects-route-match.test.ts",
  "docs/contracts/specs/openapi.yaml",
  "docs/contracts/specs/openapi.json",
  "docs/contracts/specs/openapi-route-kind-map.json",
  "src/lib/api/types.generated.ts",
  "src/lib/api/endpoints/agent-runners.ts",
  "src/lib/api/__tests__/agent-runners-diagnostics.test.ts",
  "src/mocks/handlers/agent-runners.ts",
  "src/mocks/fixtures/agent-runners.ts",
  "e2e/agent-runners.spec.ts",
  "e2e/integration-real-helpers.ts",
  "docs/contracts/agent-runners-frontend-module-map.md",
  "docs/contracts/frontend-backend-gating-matrix.md",
  "docs/contracts/agent-execution-protocol.md",
  "docs/contracts/route-gate-test-checklist.md",
] as const;

const activeTaskPublicApiFiles = [
  "packages/api-entry-node/src/projects-route-match.ts",
  "packages/api-entry-node/src/projects-route-match.test.ts",
  "docs/contracts/specs/openapi.yaml",
  "docs/contracts/specs/openapi.json",
  "docs/contracts/specs/openapi-route-kind-map.json",
  "src/lib/api/types.generated.ts",
  "src/lib/api/endpoints/tasks.ts",
  "src/lib/hooks/use-task.ts",
  "src/lib/types/task.ts",
  "src/mocks/handlers/tasks.ts",
] as const;

const publicRestForbiddenPatterns = [
  [
    /\/api\/v1\/[^\n'"`]*\/agents(?:\b|[/*?{'"`)\]])/,
    "legacy public /agents REST path",
    "/api/v1/.../agents",
  ],
  [
    /\/workspaces\/[^\n'"`]*\/projects\/[^\n'"`]*\/agents(?:\b|[/*?{'"`)\]])/,
    "legacy public /agents REST path",
    "/workspaces/.../projects/.../agents",
  ],
  [
    /\b(?:GET|POST|PATCH|DELETE|POST\/PATCH\/DELETE)\s+\/agents(?:\b|[/*?{'"`)\]])/,
    "legacy public /agents REST path",
    "METHOD /agents",
  ],
] as const;

const taskPublicApiForbiddenPatterns = [
  [
    /\/tasks\/\{taskId\}\/messages|\/tasks\/[^'"\n`]*\/messages/,
    "legacy public task messages REST path",
    "/tasks/{taskId}/messages",
  ],
  [
    /\btaskMessages\b|\bTaskMessage\b|\bSendMessageRequest\b|\buseTaskMessages\b|\buseSendMessage\b|\blistMessages\b|\bsendMessage\b/,
    "legacy public task messages adapter name",
    "TaskMessage/useTaskMessages/sendMessage",
  ],
  [
    /role:\s*['"]agent['"]|\brole\b[^;\n]*\bagent\b/,
    "legacy public task role agent vocabulary",
    "role: agent",
  ],
] as const;

const canonicalPublicRestPathFiles = new Set<string>([
  "packages/api-entry-node/src/projects-route-match.ts",
  "packages/api-entry-node/src/projects-route-match.test.ts",
  "docs/contracts/specs/openapi.yaml",
  "docs/contracts/specs/openapi.json",
  "docs/contracts/specs/openapi-route-kind-map.json",
  "src/lib/api/types.generated.ts",
  "src/lib/api/endpoints/agent-runners.ts",
  "src/lib/api/__tests__/agent-runners-diagnostics.test.ts",
  "src/mocks/handlers/agent-runners.ts",
  "e2e/agent-runners.spec.ts",
  "e2e/integration-real-helpers.ts",
  "docs/contracts/agent-runners-frontend-module-map.md",
  "docs/contracts/frontend-backend-gating-matrix.md",
  "docs/contracts/agent-execution-protocol.md",
]);

const canonicalTaskPublicApiPathFiles = new Set<string>([
  "packages/api-entry-node/src/projects-route-match.ts",
  "packages/api-entry-node/src/projects-route-match.test.ts",
  "docs/contracts/specs/openapi.yaml",
  "docs/contracts/specs/openapi.json",
  "docs/contracts/specs/openapi-route-kind-map.json",
  "src/lib/api/types.generated.ts",
  "src/lib/api/endpoints/tasks.ts",
  "src/mocks/handlers/tasks.ts",
]);

const activeProductContractFiles = [
  "docs/contracts/README.md",
  "docs/contracts/API_GUIDE.md",
  "docs/contracts/api-entry-node-module-map.md",
  "docs/contracts/product-terminology.md",
  "docs/contracts/auth-permission-model.md",
  "docs/contracts/frontend-token-interaction-contract.md",
  "docs/contracts/frontend-backend-gating-matrix.md",
  "docs/contracts/route-gate-test-checklist.md",
  "docs/contracts/chat-frontend-module-map.md",
  "docs/contracts/agent-task-frontend-module-map.md",
  "docs/contracts/agent-runners-frontend-module-map.md",
  "docs/contracts/agent-execution-protocol.md",
  "docs/contracts/backend-storage-architecture-matrix.md",
  "docs/contracts/frontend-resource-policy-governance-v1.md",
  "docs/contracts/unified-deploy-contract.md",
  "docs/contracts/user-story-contract-v1.md",
] as const;

const activeProductSurfaceFiles = [
  ...activeProductContractFiles,
  ...collectTextFiles("docs/user-guides", [".md"]),
  "src/messages/en-US.json",
  "src/messages/zh-CN.json",
  ...collectTextFiles("src/components/app-shell", [".ts", ".tsx"]),
  "src/components/layout/ProjectModuleHeader.tsx",
  "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/_components/ChatHeaderActions.tsx",
  "src/components/files/files-page/FilesHeaderActions.tsx",
  "src/components/endpoints/endpoints-page/EndpointsHeaderActions.tsx",
  "src/mocks/index.ts",
  ...collectTextFiles("src/mocks/handlers", [".ts"]),
  ...collectTextFiles("src/mocks/doc-fixtures", [".ts"]),
  ...collectTextFiles("src/mocks/fixtures", [".ts", ".json"]),
  "src/lib/routes/project-route-policy-manifest.ts",
  "src/lib/constants/permissions.ts",
  "docs/contracts/specs/openapi.yaml",
  "docs/contracts/specs/openapi.json",
  "docs/contracts/specs/asyncapi.yaml",
  "docs/contracts/specs/asyncapi.json",
  "docs/contracts/specs/openapi-route-kind-map.json",
  "src/lib/api/types.generated.ts",
  "packages/agent-runner/src/index.ts",
  "packages/agent-runner/src/protocol.ts",
  "packages/agent-runner/src/runner-spec.ts",
  "infra/deploy/unified/deployment.manifest.json",
] as const;

const backendRealStorySurfaceFiles = [
  ...collectTextFiles("e2e/stories/backend-real", [".story.md"]),
  "e2e/generated/story-specs.generated.json",
] as const;

const activeForbiddenPatterns = [
  [
    /agent:notebook-runner|agent:chat-runner/,
    "legacy runner package script alias",
  ],
  [/test:(?:chat|notebook):runner/, "legacy chat/notebook runner npm gate"],
  [
    /test:e2e:integration:notebook(?:[:\w-]*)?/,
    "legacy notebook integration npm gate",
  ],
  [/test:notebook:/, "legacy notebook npm gate"],
  [
    /test:internal:backend-real:notebook/,
    "legacy internal notebook backend-real gate",
  ],
  [/test:agents:backend-real:runner/, "legacy agents backend-real runner gate"],
  [/notebook-agent(?:-|:)/, "legacy notebook-agent command surface"],
  [
    /e2e-int-notebook-agent/,
    "legacy notebook-agent Makefile integration target",
  ],
  [
    /chat-runtime-(?:fast|backend-real)-gate/,
    "legacy chat runtime gate script",
  ],
  [
    /packages\/notebook-codex-runner/,
    "active dependency on notebook-codex-runner package path",
  ],
  [/packages\/chat-llm-runner/, "active dependency on chat-llm-runner package"],
  [
    /integration-chat-llm-runner\.spec\.ts/,
    "legacy chat runner integration spec",
  ],
  [
    /integration-agents-external\.spec\.ts/,
    "legacy external agents integration spec",
  ],
  [
    /integration-notebook-codex-runner\.spec\.ts/,
    "legacy notebook runner integration spec",
  ],
  [
    /integration-notebook-external\.spec\.ts/,
    "legacy notebook external integration spec",
  ],
  [
    /integration-notebook-terminal-ux\.spec\.ts/,
    "legacy notebook terminal UX integration spec",
  ],
  [
    /integration-system-notebook-default\.spec\.ts/,
    "legacy system-to-notebook backend-real spec",
  ],
  [
    /integration-internal-notebook-workspace\.spec\.ts/,
    "legacy internal notebook workspace backend-real spec",
  ],
  [/notebook-terminal-[\w-]+\.sh/, "legacy notebook terminal gate script"],
  [/notebook-real-smoke-gate\.sh/, "legacy notebook real smoke gate"],
  [/notebook-agent-refresh-token\.js/, "legacy notebook agent token helper"],
  [
    /MBOS_RUNNER_MODE="\$\{MBOS_RUNNER_MODE:-host_external\}"/,
    "legacy host_external runner mode default",
  ],
  [/host_external/, "legacy host_external runner mode"],
  [
    /PRESET_EXTERNAL_AGENT_NAME|PRESET_INTERNAL_AGENT_NAME/,
    "legacy preset agent name env key",
  ],
  [/local-manual-seed-notebook/, "legacy local-manual notebook seed target"],
  [
    /seed-notebook-demo\.sh|verify-notebook-demo\.sh/,
    "legacy notebook demo helper script",
  ],
  [
    /run-internal-notebook-real-gate\.sh/,
    "legacy internal notebook backend-real gate script",
  ],
  [/scripts\/run-external-runner-dev\.sh/, "legacy external runner dev script"],
  [
    /check-preset-external-file-library/,
    "legacy preset external file-library helper",
  ],
  [/external runner/i, "legacy external runner wording"],
] as const;

const activeProductForbiddenPatterns = [
  [/\bNotebook\b|\bnotebook\b/, "retired Notebook product entry"],
  [/\bOpen Agents\b|\bAgents\b/, "retired Agents product entry"],
  [
    /"notebook"\s*:|notebookHandlers|handlers\/notebook|\/notebook\b/,
    "retired notebook route/i18n/MSW surface",
  ],
  [
    /"agents"\s*:|navLabelKey: 'agents'|\/agents\/page\.tsx/,
    "retired agents route/i18n surface",
  ],
  [
    /Execution target|execution target/,
    "retired Chat Execution target wording",
  ],
  [
    /external runner|External Runner|host_external/,
    "retired external runner wording",
  ],
  [
    /external agent|external agents|External agents|internal agent|internal agents|Internal Agents/,
    "retired external/internal agent product wording",
  ],
  [
    /project:agent:(?:use|manage|public)|project:terminal:use/,
    "retired agent/terminal permission token",
  ],
  [
    /Chat Agent|Notebook Agent|chat runner|notebook runner|chat_runner|notebook_runner/,
    "retired chat/notebook runner concept",
  ],
  [/external_agent_id/, "retired Chat external agent binding"],
  [
    /compatibility requires it|backward compatibility|compatible while moving toward/i,
    "legacy compatibility bridge wording",
  ],
] as const;

const backendRealStoryForbiddenPatterns = [
  [/\/notebook(?:\/|$|[?#$'"`)}\],])/, "retired backend-real Notebook route"],
  [/notebook__/, "retired backend-real Notebook test id"],
  [/\/agents(?:\/|$|[?#$'"`)}\],])/, "retired backend-real Agents route"],
  [/agents__create-btn|agents__heading/, "retired backend-real Agents test id"],
  [
    /chat\/notebook|chat-notebook|internal-external-chat-notebook-proxy-matrix/,
    "retired backend-real chat/notebook matrix story",
  ],
  [
    /external-agent|external agent|internal agent|internal\/external|external\/internal/,
    "retired backend-real external/internal compatibility wording",
  ],
  [
    /external_create|external_reuse|internal_create|internal_reuse/,
    "retired backend-real external/internal compatibility runtime key",
  ],
] as const;

const activeRuntimeSurfaceForbiddenPatterns = [
  [
    /\/notebook(?:\/|$|[?#$'"`)}\],])/,
    "legacy active runtime /notebook route",
    "/notebook",
  ],
  [
    /\/agents(?:\/|$|[?#$'"`)}\],])/,
    "legacy active runtime /agents route",
    "/agents",
  ],
  [
    /\/tasks\/\{taskId\}\/messages|\/tasks\/[^'"\n`]*\/messages/,
    "legacy active runtime task messages REST path",
    "/tasks/{taskId}/messages",
  ],
  [
    /\bEXTERNAL_AGENT_[A-Z0-9_]*\b|PRESET_EXTERNAL_AGENT_NAME|PRESET_INTERNAL_AGENT_NAME|AGENTSMITH_RUNNER_IMAGE|runner-runtime\.env|\bexternal_host\b|\bhost_external\b|\bdocker_external\b|[Ee]xternal[-_ ][Rr]unner\b/,
    "legacy active runtime external runner env/mode",
    "external runner env",
  ],
  [
    /chat-llm-runner|notebook-codex-runner|integration-chat-llm-runner\.spec\.ts|integration-notebook-[\w-]+\.spec\.ts|test:(?:chat|notebook):runner|agent:(?:chat|notebook)-runner|\b(?:chat|notebook)[ -](?:llm|codex)?[ -]?runner\b/i,
    "legacy active runtime chat/notebook runner spec",
    "chat/notebook runner spec",
  ],
  [
    /notebook\.task_terminal/,
    "removed notebook terminal view",
    "notebook.task_terminal",
  ],
  [
    /external_agent_id/,
    "legacy active runtime external agent binding field",
    "external_agent_id",
  ],
] as const;

const retiredDesktopAuthRuntimePatterns = [
  [
    /\/api\/v1\/desktop\/auth/u,
    "retired desktop auth API path",
    "/api/v1/desktop/auth",
  ],
  [
    /\/api\/v1\/me\/desktop/u,
    "retired me desktop API path",
    "/api/v1/me/desktop",
  ],
  [/\bdsk_/u, "retired desktop bearer prefix", "dsk_"],
] as const;

requireScript(
  scripts,
  "agent:task-runner",
  "npm run dev -w @mbos/agent-task-runner",
);
requireScript(
  scripts,
  "test:agent-task:runner:fast",
  "bash scripts/skills-runtime-fast-gate.sh",
);
requireScript(
  scripts,
  "test:agent-task:runner:backend-real",
  "bash scripts/skills-runtime-backend-real-gate.sh",
);
requireScript(
  scripts,
  "test:agent-task:backend-real:runner",
  "bash scripts/run-backend-real-session-shards.sh",
);
requireScript(
  scripts,
  "test:agent-task:backend-real:smoke",
  "bash scripts/agent-task-real-smoke-gate.sh",
);
requireScript(
  scripts,
  "test:agent-task:backend-real:terminal",
  "bash scripts/agent-task-terminal-real-smoke.sh",
);
requireScript(
  scripts,
  "test:agent-task:backend-real:terminal:internal",
  "bash scripts/agent-task-terminal-internal-real-smoke.sh",
);
requireScript(
  scripts,
  "test:agent-task:backend-real:terminal:matrix",
  "bash scripts/agent-task-terminal-matrix-real-gate.sh",
);
requireScript(
  scripts,
  "test:agent-task:release:strict",
  "npm run test:agent-task:backend-real:terminal:matrix && npm run test:e2e:integration:agent-task:terminal:ux",
);
requireScript(
  scripts,
  "test:internal:backend-real:agent-task-workspace",
  "bash scripts/run-internal-agent-task-real-gate.sh",
);
requireScript(
  scripts,
  "test:e2e:integration:agent-task",
  "playwright test --config playwright.config.integration.ts e2e/integration-agent-task-runner.spec.ts --project=chromium --workers=1 --grep-invert docker",
);
requireScript(
  scripts,
  "test:e2e:integration:agent-task:terminal:ux",
  "bash scripts/agent-task-terminal-ux-real-gate.sh",
);
requireScript(
  scripts,
  "test:e2e:integration:agent-task:with-api",
  "bash scripts/run-integration-e2e-with-api.sh e2e/integration-agent-task-runner.spec.ts --grep-invert docker",
);

for (const legacyScript of [
  "agent:notebook-runner",
  "agent:chat-runner",
  "agent:external:dev",
  "test:notebook:runner:fast",
  "test:notebook:runner:backend-real",
  "test:chat:runner:fast",
  "test:chat:runner:backend-real",
  "test:e2e:integration:agents:chat",
  "test:e2e:integration:agents",
  "test:e2e:integration:agents:with-api",
  "test:e2e:integration:notebook:docker",
  "test:agents:backend-real:runner",
  "test:e2e:integration:notebook",
  "test:e2e:integration:notebook:terminal:ux",
  "test:e2e:integration:notebook-external:with-api",
  "test:notebook:backend-real:smoke",
  "test:notebook:backend-real:terminal",
  "test:notebook:backend-real:terminal:internal",
  "test:notebook:backend-real:terminal:matrix",
  "test:notebook:release:strict",
  "test:internal:backend-real:notebook-workspace",
]) {
  forbidScript(scripts, legacyScript);
}

requireMatch(
  makefile,
  /^agent-task-runner:/m,
  "Makefile must expose agent-task-runner",
);
requireMatch(
  makefile,
  /\$\(NPM\) run agent:task-runner/,
  "Makefile agent-task-runner must use package.json agent:task-runner",
);
forbidMatch(
  makefile,
  /^notebook-runner:/m,
  "Makefile must not expose notebook-runner",
);
forbidMatch(makefile, /^chat-runner:/m, "Makefile must not expose chat-runner");
forbidMatch(
  makefile,
  /^e2e-int-agent(?::|-local-api:|-auto:)/m,
  "Makefile must not expose retired e2e-int-agent aliases",
);
forbidMatch(
  makefile,
  /agent:notebook-runner|agent:chat-runner/,
  "Makefile must not invoke legacy runner scripts",
);
forbidMatch(
  makefile,
  /notebook-agent(?:-|:)/,
  "Makefile must not expose notebook-agent targets",
);
forbidMatch(
  makefile,
  /e2e-int-notebook-agent/,
  "Makefile must not expose notebook-agent integration targets",
);
forbidMatch(
  makefile,
  /MBOS_RUNNER_MODE="\$\{MBOS_RUNNER_MODE:-host_external\}"/,
  "Makefile must not default to host_external runner mode",
);

requireMatch(
  runnerImageCommon,
  /agent-task/,
  "runner-image-common.sh must support the agent-task runner kind",
);
requireMatch(
  runnerImageCommon,
  /agentsmith-agent-task-runner-base/,
  "runner image defaults must use agentsmith-agent-task-runner-base",
);
requireMatch(
  runnerImageCommon,
  /agentsmith-agent-task-runner/,
  "runner image defaults must use agentsmith-agent-task-runner",
);
requirePath(
  "packages/agent-task-runner/package.json",
  "packages must expose the Agent Task runner package at packages/agent-task-runner",
);
forbidPath(
  "packages/notebook-codex-runner",
  "packages must not keep legacy notebook-codex-runner path",
);
forbidPath(
  "infra/runner/Dockerfile.chat-llm-runner",
  "infra/runner must not keep legacy chat runner Dockerfile",
);
forbidPath(
  "infra/runner/Dockerfile.chat-llm-runner-base",
  "infra/runner must not keep legacy chat runner base Dockerfile",
);
forbidPath(
  "infra/runner/Dockerfile.notebook-codex-runner",
  "infra/runner must not keep legacy notebook runner Dockerfile",
);
forbidPath(
  "infra/runner/Dockerfile.notebook-codex-runner-base",
  "infra/runner must not keep legacy notebook runner base Dockerfile",
);
forbidPath(
  "scripts/check-preset-external-file-library.sh",
  "scripts must not keep legacy preset external file-library helper",
);
forbidPath(
  "scripts/juicefs-orphan-preflight.ts",
  "scripts must not keep retired file-library JuiceFS orphan preflight",
);
forbidPath(
  "scripts/juicefs-orphan-preflight.test.ts",
  "scripts must not keep retired file-library JuiceFS orphan preflight tests",
);
forbidPath(
  "scripts/file-library-mount-sync-smoke.sh",
  "scripts must not keep retired file-library mount-sync smoke gate",
);
forbidPath(
  "docs/contracts/juicefs-file-libraries-architecture.md",
  "docs/contracts must not reintroduce retired raw JuiceFS file-library architecture",
);
forbidPath(
  "docs/user-guides/file-library-local-mount.md",
  "docs/user-guides must not reintroduce raw JuiceFS local mount guidance",
);
forbidPath(
  "e2e/integration-files-mount-sync.spec.ts",
  "e2e must not keep retired file-library mount-sync spec",
);
forbidPath(
  "packages/api-entry-node/src/file-library-gateway-client.ts",
  "api-entry-node must not keep retired file-library gateway client",
);
forbidPath(
  "packages/api-entry-node/src/file-library-gateway-manager.ts",
  "api-entry-node must not keep retired file-library gateway manager",
);
forbidPath(
  "packages/api-entry-node/src/file-library-gateway-ownership.ts",
  "api-entry-node must not keep retired file-library gateway ownership helper",
);
forbidPath(
  "packages/api-entry-node/src/file-library-gateway-ownership.test.ts",
  "api-entry-node must not keep retired file-library gateway ownership tests",
);
forbidPath(
  "packages/api-entry-node/src/file-library-gateway-paths.ts",
  "api-entry-node must not keep retired file-library gateway path helper",
);
forbidPath(
  "packages/api-entry-node/src/file-library-orchestrator.ts",
  "api-entry-node must not keep retired file-library orchestrator",
);
forbidPath(
  "packages/api-entry-node/src/file-library-runtime.ts",
  "api-entry-node must not keep retired file-library runtime",
);
forbidPath(
  "packages/api-entry-node/src/file-library-runtime.test.ts",
  "api-entry-node must not keep retired file-library runtime tests",
);
forbidPath(
  "src/components/files/files-page/DesktopAccessDialog.tsx",
  "Files UI must not keep retired desktop access dialog",
);
forbidPath(
  "src/components/files/files-page/LibraryAccessDialog.tsx",
  "Files UI must not keep retired library access dialog",
);
forbidPath(
  "src/lib/hooks/use-file-libraries-v2.ts",
  "frontend hooks must not keep retired file libraries v2 hook",
);
forbidPath(
  "src/lib/hooks/__tests__/use-file-libraries-v2.test.tsx",
  "frontend hooks must not keep retired file libraries v2 hook tests",
);
forbidPath(
  "e2e/integration-agent-task-external.spec.ts",
  "e2e must not keep Agent Task wrappers around legacy external/notebook specs",
);
for (const filePath of afscpBoundaryActiveFiles) {
  const content = readText(filePath);
  for (const [pattern, label] of retiredAfscpBoundaryPatterns) {
    forbidMatch(
      content,
      pattern,
      `${filePath} must use AFSCP/substrate naming instead of retired ${label}`,
    );
  }
}
requireMatch(
  buildRunnerImageScript,
  /usage: scripts\/build-runner-image\.sh <agent-task>/,
  "build-runner-image.sh usage must expose only the agent-task runner kind",
);

for (const [filePath, content] of [
  ["scripts/app/deploy-common.sh", appDeployCommon],
  ["scripts/lib/deploy-common.sh", deployCommon],
  ["scripts/lib/bootstrap-common.sh", bootstrapCommon],
  ["scripts/lib/preset-common.sh", presetCommon],
  ["scripts/backend-real-run.sh", backendRealRun],
  ["scripts/run-backend-real-session-shards.sh", backendRealSessionWrapper],
  ["scripts/run-integration-e2e-full.sh", integrationE2eFull],
] as const) {
  forbidMatch(
    content,
    /runner-runtime\.env/,
    `${filePath} must not use runner-runtime.env`,
  );
  forbidMatch(
    content,
    /AGENTSMITH_RUNNER_IMAGE/,
    `${filePath} must not use AGENTSMITH_RUNNER_IMAGE`,
  );
  forbidMatch(
    content,
    /agentsmith_runner_image|agentsmith_chat_runner_image|agentsmith_notebook_runner_image/,
    `${filePath} must not use legacy runner VERSION keys`,
  );
  forbidMatch(
    content,
    /PRESET_EXTERNAL_AGENT_NAME|PRESET_INTERNAL_AGENT_NAME/,
    `${filePath} must not use legacy preset agent names`,
  );
  forbidMatch(
    content,
    /external-runner/,
    `${filePath} must not manage an external-runner service`,
  );
}

requireMatch(
  deployCommon,
  /AGENTSMITH_AGENT_TASK_RUNNER_IMAGE=\$\{agent_task_runner_image\}/,
  "compose env must expose AGENTSMITH_AGENT_TASK_RUNNER_IMAGE",
);
requireMatch(
  bootstrapCommon,
  /agentsmith_agent_task_runner_image/,
  "bootstrap must read agentsmith_agent_task_runner_image",
);
requireMatch(
  backendRealRun,
  /test:agent-task:backend-real:runner/,
  "backend-real-run.sh must invoke the agent-task backend-real runner session",
);
forbidMatch(
  backendRealBootstrap,
  /notebook-agent/,
  "backend-real-bootstrap.sh must not invoke notebook-agent helpers",
);
forbidMatch(
  buildReliabilitySmoke,
  /notebook-external|test:e2e:integration:notebook/,
  "build-reliability-smoke.sh must not invoke notebook integration gates",
);
requireMatch(
  backendRealSessionWrapper,
  /--session agent-task-backend-real-runner/,
  "backend-real session wrapper must target agent-task-backend-real-runner",
);
requireMatch(
  integrationE2eFull,
  /run_playwright_shard "agent-task-runner" "e2e\/integration-agent-task-runner\.spec\.ts" --grep-invert docker/,
  "integration session must run the focused agent-task runner shard",
);
forbidMatch(
  integrationE2eFull,
  /\b(chat-runner|notebook-runner|notebook-docker|agents-backend-real-runner|chat-backend-real-runner)\b/,
  "integration session must not expose legacy chat/notebook runner shard names",
);
forbidMatch(
  integrationE2eFull,
  /integration-chat-llm-runner\.spec\.ts|integration-notebook-codex-runner\.spec\.ts/,
  "integration session must not call legacy runner spec filenames",
);
requireMatch(
  integrationE2eFull,
  /RUNTIME_RUNNER_MODES="\$\{RUNTIME_RUNNER_MODES:-managed_runner\}"/,
  "integration session must default to managed Agent Task runner mode",
);
forbidMatch(
  integrationE2eFull,
  /\bexternal_host\b|\bhost_external\b/,
  "integration session must not default to legacy external runner modes",
);

for (const [filePath, content] of [
  [".github/workflows/integration-e2e.yml", integrationWorkflow],
  [
    "scripts/governance/current-real-session-coverage-manifest.ts",
    currentCoverageManifest,
  ],
  ["scripts/governance/verify-impact-selector.ts", impactSelector],
  ["scripts/skills-runtime-fast-gate.sh", skillsFastGate],
  ["scripts/skills-runtime-backend-real-gate.sh", skillsBackendRealGate],
] as const) {
  forbidMatch(
    content,
    /test:(chat|notebook):runner/,
    `${filePath} must not recommend legacy runner npm gates`,
  );
  forbidMatch(
    content,
    /agent:(chat|notebook)-runner/,
    `${filePath} must not recommend legacy runner npm scripts`,
  );
}

for (const filePath of agentTaskBackendRealSpecFiles) {
  const content = readText(filePath);
  forbidMatch(
    content,
    /import\s+['"]\.\/integration-(?:notebook|chat)[^'"]*\.spec['"]/,
    `${filePath} must be native Agent Task coverage instead of importing legacy notebook/chat specs`,
  );
  forbidMatch(
    content,
    /createExternalRunnerAgentBundle/,
    `${filePath} must not create legacy external runner bundles`,
  );
  forbidMatch(
    content,
    /suite:\s*['"]integration-(?:notebook|chat)|specFile:\s*['"]e2e\/integration-(?:notebook|chat)/,
    `${filePath} must not keep legacy notebook/chat trace metadata`,
  );
  forbidMatch(
    content,
    /real notebook codex runner|@lane-real notebook|notebook terminal workspace UX walkthrough|external agent/i,
    `${filePath} must not keep old notebook/codex/external test titles`,
  );
}

requireMatch(
  currentCoverageManifest,
  /test:agent-task:runner:backend-real/,
  "current real session coverage must include test:agent-task:runner:backend-real",
);
requireMatch(
  currentCoverageManifest,
  /test:e2e:integration:agent-task/,
  "current real session coverage must include test:e2e:integration:agent-task",
);
forbidMatch(
  currentCoverageManifest,
  /test:notebook:|integration-chat-llm-runner\.spec\.ts|integration-notebook-codex-runner\.spec\.ts|integration-notebook-terminal-ux\.spec\.ts|scripts\/chat-runtime-|scripts\/notebook-/,
  "current real session coverage must not model legacy notebook/chat runner gates",
);
requireMatch(
  impactSelector,
  /test:agent-task:runner:fast/,
  "impact selector must recommend test:agent-task:runner:fast for runner/context focused diagnostics",
);
requireMatch(
  impactSelector,
  /test:agent-task:runner:backend-real/,
  "impact selector must recommend test:agent-task:runner:backend-real for runner/context backend-real diagnostics",
);
requireMatch(
  integrationWorkflow,
  /agent-task/,
  "integration-e2e workflow must expose the agent-task suite",
);

requireMatch(
  integrationRealHelpers,
  /createAgentTaskRunnerBundleViaApi/,
  "integration-real-helpers.ts must expose the canonical Agent Task runner bundle helper",
);
forbidMatch(
  integrationRealHelpers,
  /createExternalRunnerAgentBundle/,
  "integration-real-helpers.ts must not expose legacy external runner bundle helper aliases",
);
forbidMatch(
  integrationRealHelpers,
  /\binteraction_kind\b|external_agent_id|mode:\s*['"]external['"]|\bhost_external\b|\bdocker_external\b/,
  "integration-real-helpers.ts must not create legacy runner/chat binding payloads",
);
forbidMatch(
  integrationRealHelpers,
  /\/chat\/sessions[\s\S]{0,240}external_agent_id/,
  "integration-real-helpers.ts must not create Chat sessions with legacy external agent bindings",
);

for (const filePath of activeRunnerWireFiles) {
  const content = readText(filePath);
  forbidRunnerWireMatches(filePath, content, runnerWireForbiddenPatterns);
}

for (const filePath of runnerWireNegativeProofFiles) {
  const content = readText(filePath);
  requireRunnerWireNegativeProofMatches(
    filePath,
    content,
    runnerWireForbiddenPatterns,
  );
}

for (const filePath of activePublicRestContractFiles) {
  const content = readText(filePath);
  if (canonicalPublicRestPathFiles.has(filePath)) {
    requireMatch(
      content,
      /agent-runners/,
      `${filePath} must expose canonical /agent-runners REST path`,
    );
  }
  forbidActivePublicRestMatches(filePath, content, publicRestForbiddenPatterns);
}

for (const filePath of activeTaskPublicApiFiles) {
  const content = readText(filePath);
  if (canonicalTaskPublicApiPathFiles.has(filePath)) {
    requireMatch(
      content,
      /activity/,
      `${filePath} must expose canonical /tasks/{taskId}/activity Agent Task API vocabulary`,
    );
    requireMatch(
      content,
      /runs/,
      `${filePath} must expose canonical /tasks/{taskId}/runs Agent Task API vocabulary`,
    );
  }
  if (filePath === "src/lib/hooks/use-task.ts") {
    requireMatch(
      content,
      /useTaskActivity/,
      `${filePath} must expose canonical useTaskActivity Agent Task hook vocabulary`,
    );
    requireMatch(
      content,
      /useStartTaskRun/,
      `${filePath} must expose canonical useStartTaskRun Agent Task hook vocabulary`,
    );
  }
  forbidActivePublicRestMatches(
    filePath,
    content,
    taskPublicApiForbiddenPatterns,
  );
}

for (const filePath of activeTextFiles) {
  const content = readText(filePath);
  for (const [pattern, label] of activeForbiddenPatterns) {
    forbidMatch(content, pattern, `${filePath} must not expose ${label}`);
  }
}

for (const filePath of activeProductSurfaceFiles) {
  const content = readText(filePath);
  forbidActiveProductSurfaceMatches(
    filePath,
    content,
    activeProductForbiddenPatterns,
  );
}

for (const filePath of activeRuntimeSurfaceFiles) {
  const content = readText(filePath);
  forbidActiveRuntimeSurfaceMatches(
    filePath,
    content,
    activeRuntimeSurfaceForbiddenPatterns,
  );
}

for (const filePath of activeApiEntryRuntimeFiles) {
  const content = readText(filePath);
  for (const [pattern, label, source] of retiredDesktopAuthRuntimePatterns) {
    forbidMatch(
      content,
      pattern,
      `${filePath} must not expose ${label} (${source})`,
    );
  }
}

for (const filePath of backendRealStorySurfaceFiles) {
  const content = readText(filePath);
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [pattern, label] of backendRealStoryForbiddenPatterns) {
      if (pattern.test(line)) {
        failures.push(
          `${filePath}:${index + 1} must not expose ${label}: ${line.trim()}`,
        );
      }
    }
  }
}

forbidPath(
  "docs/contracts/notebook-frontend-module-map.md",
  "docs/contracts must not keep the retired Notebook frontend module map",
);
forbidPath(
  "docs/engineering/notebook-terminal-recovery-and-message-footer-improvement-plan-v1.md",
  "docs/engineering must not keep the retired Notebook terminal recovery plan as an active document",
);
forbidPath(
  "src/mocks/handlers/notebook.ts",
  "MSW must not keep the retired notebook handler surface",
);

const agentRunnerPublicSdk = readText("packages/agent-runner/src/index.ts");
forbidMatch(
  agentRunnerPublicSdk,
  /ChatExecutionContext|NotebookExecutionContext|CHAT_RUNNER_SPEC|NOTEBOOK_RUNNER_SPEC|AgentInteractionKind/,
  "Agent Runner public SDK must not export retired chat/notebook concepts",
);

if (failures.length > 0) {
  console.error("[contracts] runner naming check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[contracts] runner naming check passed");
