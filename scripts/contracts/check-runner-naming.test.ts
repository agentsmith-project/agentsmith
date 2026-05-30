import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("check-runner-naming contract", () => {
  const agentTaskSpecs = [
    "e2e/integration-agent-task-runner.spec.ts",
    "e2e/integration-agent-task-terminal-ux.spec.ts",
  ] as const;

  it("passes against the active runner naming and docs set", () => {
    const tsxCli = path.join(process.cwd(), "node_modules", ".bin", "tsx");

    expect(() =>
      execFileSync(tsxCli, ["scripts/contracts/check-runner-naming.ts"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("keeps agent-task backend-real specs native instead of wrapping legacy notebook/chat specs", () => {
    for (const specPath of agentTaskSpecs) {
      const source = readFileSync(path.join(process.cwd(), specPath), "utf8");

      expect(
        source,
        `${specPath} must not import legacy integration specs`,
      ).not.toMatch(
        /import\s+['"]\.\/integration-(?:notebook|chat)[^'"]*\.spec['"]/,
      );
      expect(
        source,
        `${specPath} must not use the legacy external runner helper`,
      ).not.toContain("createExternalRunnerAgentBundle");
      expect(
        source,
        `${specPath} must not keep legacy notebook/chat trace metadata`,
      ).not.toMatch(
        /suite:\s*['"]integration-(?:notebook|chat)|specFile:\s*['"]e2e\/integration-(?:notebook|chat)/,
      );
      expect(
        source,
        `${specPath} must not keep old notebook/codex/external test titles`,
      ).not.toMatch(
        /real notebook codex runner|@lane-real notebook|notebook terminal workspace UX walkthrough|external agent/i,
      );
    }
  });

  it("covers active product surfaces that previously leaked retired entry names", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    for (const expectedSurface of [
      "docs/contracts/product-terminology.md",
      "AGENTS.md",
      "DEVELOPMENT.md",
      "docs/README.md",
      "docs/CURRENT_BASELINE.md",
      "docs/troubleshooting-guide-v1.md",
      "docs/engineering/agentsmith-chat-agent-runner-evolution-plan-v1.md",
      "docs/engineering/agent-task-terminal-recovery-and-message-footer-improvement-plan-v1.md",
      "docs/contracts/api-entry-node-module-map.md",
      "docs/contracts/frontend-backend-gating-matrix.md",
      "docs/contracts/frontend-token-interaction-contract.md",
      "docs/contracts/auth-permission-model.md",
      "docs/contracts/route-gate-test-checklist.md",
      "docs/contracts/backend-storage-architecture-matrix.md",
      "docs/contracts/frontend-resource-policy-governance-v1.md",
      "docs/contracts/user-story-contract-v1.md",
      "docs/user-guides",
      "src/messages/en-US.json",
      "src/messages/zh-CN.json",
      "src/components/app-shell",
      "src/components/files/files-page/FilesHeaderActions.tsx",
      "src/mocks/index.ts",
      "src/mocks/handlers",
      "src/mocks/fixtures",
      "src/lib/routes/project-route-policy-manifest.ts",
      "docs/contracts/specs/openapi.yaml",
      "docs/contracts/specs/asyncapi.yaml",
      "docs/contracts/specs/agent-execution-ws-supplement.asyncapi.yaml",
      "docs/contracts/specs/openapi-route-kind-map.json",
      "src/lib/api/types.generated.ts",
      "packages/api-entry-node/src/projects-route-match.ts",
      "packages/api-entry-node/src/projects-route-match.test.ts",
      "src/lib/api/endpoints/agent-runners.ts",
      "src/lib/api/endpoints/tasks.ts",
      "src/lib/hooks/use-task.ts",
      "src/lib/types/task.ts",
      "src/mocks/handlers/agent-runners.ts",
      "src/mocks/handlers/tasks.ts",
      "e2e/agent-runners.spec.ts",
      "e2e/integration-real-helpers.ts",
      "packages/agent-runner-contract/src/index.ts",
      "packages/agent-runner-contract/src/protocol.ts",
      "packages/agent-runner-contract/src/runner-spec.ts",
      "docs/contracts/unified-deploy-contract.md",
      "docs/agent-task-runner-runbook.md",
      "package-lock.json",
      "infra/runner/Dockerfile.agent-task-runner",
      "infra/deploy/Dockerfile.agentsmith-app-base",
      "e2e/stories/backend-real",
      'collectTextFiles("e2e"',
      'collectTextFiles("packages/api-entry-node/src"',
      'collectTextFiles("scripts"',
      "activeRuntimeSurfaceFiles",
      "e2e/generated/story-specs.generated.json",
      "docs/contracts/juicefs-file-libraries-architecture.md",
      "docs/user-guides/file-library-local-mount.md",
      "e2e/integration-files-mount-sync.spec.ts",
      "scripts/juicefs-orphan-preflight.ts",
      "scripts/file-library-mount-sync-smoke.sh",
      "packages/api-entry-node/src/file-library-gateway-client.ts",
      "packages/api-entry-node/src/file-library-gateway-manager.ts",
      "packages/api-entry-node/src/file-library-gateway-ownership.ts",
      "packages/api-entry-node/src/file-library-gateway-ownership.test.ts",
      "packages/api-entry-node/src/file-library-gateway-paths.ts",
      "packages/api-entry-node/src/file-library-orchestrator.ts",
      "packages/api-entry-node/src/file-library-runtime.ts",
      "packages/api-entry-node/src/file-library-runtime.test.ts",
      "src/components/files/files-page/DesktopAccessDialog.tsx",
      "src/components/files/files-page/LibraryAccessDialog.tsx",
      "src/lib/hooks/use-file-libraries-v2.ts",
      "src/lib/hooks/__tests__/use-file-libraries-v2.test.tsx",
      "activeApiEntryRuntimeFiles",
      "retiredDesktopAuthRuntimePatterns",
      "/api/v1/desktop/auth",
      "/api/v1/me/desktop",
      "dsk_",
    ]) {
      expect(
        checkerSource,
        `${expectedSurface} must be part of active naming scan`,
      ).toContain(expectedSurface);
    }
  });

  it("keeps backend-real story evidence on current Agent Task and Agent Runner surfaces", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    for (const expectedPattern of [
      "/notebook",
      "notebook__",
      "/agents",
      "agents__create-btn",
      "chat/notebook",
      "internal-external-chat-notebook-proxy-matrix",
      "external-agent",
      "internal\\/external",
      "external_create",
    ]) {
      expect(
        checkerSource,
        `${expectedPattern} must be covered in backend-real story scan`,
      ).toContain(expectedPattern);
    }
  });

  it("scans runner wire, deploy env, and package command leaks without broad legacy allowlists", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    for (const expectedPattern of [
      "EXTERNAL_AGENT_",
      "DOCKER_MANUAL_AGENT_",
      "/agent-execution/ws.*agent_id=",
      "/agent-execution/ws.*session_id=",
      "external_host",
      "host_external",
      "agent:test-runner",
      "agent-test-runner",
      "packages/notebook-codex-runner",
      "packages/api-entry-node/src/agent-runner-profile.ts",
      "packages/api-entry-node/src/notebook-execution-orchestrator.ts",
      "scripts/run-release-local-precheck.sh",
      "legacy active runtime /notebook route",
      "legacy active runtime /agents route",
      "legacy active runtime task messages REST path",
      "legacy active runtime external runner env/mode",
      "legacy active runtime chat/notebook runner spec",
      "notebook.task_terminal",
    ]) {
      expect(
        checkerSource,
        `${expectedPattern} must be covered by runner naming scan`,
      ).toContain(expectedPattern);
    }

    for (const forbiddenAllowlistSurface of [
      "StructuredAllowlistEntry",
      "structuredRunnerNamingAllowlist",
      "isStructuredAllowlisted",
      "forbidStructuredMatches",
    ]) {
      expect(
        checkerSource,
        `${forbiddenAllowlistSurface} must not remain in runner wire gate`,
      ).not.toContain(forbiddenAllowlistSurface);
    }

    expect(
      checkerSource,
      "legacy literals must be restricted to negative proof files",
    ).toContain("runnerWireNegativeProofFiles");
    expect(
      checkerSource,
      "negative proof lines must be recognized explicitly",
    ).toContain("isRunnerWireNegativeProofLine");
  });

  it("forbids provider-bound runner skill and projection names in the focused runner/projection slice", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    for (const expectedSurface of [
      "providerNeutralRunnerProjectionFiles",
      "providerBoundRunnerProjectionRetiredFiles",
      "providerBoundRunnerProjectionPatterns",
      "forbidRunnerPathMatches",
      "package.json",
      "packages/agent-task-runner/builtin-skills",
      "packages/agent-task-runner/src",
      "packages/agent-runner-contract/src",
      "packages/api-entry-node/src/internal-agent-pod-manager.ts",
      "packages/api-entry-node/src/internal-agent-pod-manager.test.ts",
      "packages/api-entry-node/src/notebook-execution-orchestrator.ts",
      "packages/api-entry-node/src/notebook-execution-orchestrator.test.ts",
      "e2e/integration-agent-task-runner.spec.ts",
      "e2e/integration-real-helpers.ts",
      "scripts/feishu-real-credential-gate.sh",
      "scripts/governance/__tests__/current-real-session-coverage-manifest.test.ts",
      "scripts/governance/current-real-session-coverage-manifest.ts",
      "scripts/governance/current-resource-lock-manifest.ts",
      "scripts/internal-backend-real-gate-runtime.test.ts",
      "scripts/skills-runtime-fast-gate.sh",
      "scripts/run-internal-agent-task-real-gate.sh",
      "scripts/run-integration-e2e-full.sh",
      "scripts/run-integration-e2e-full.test.ts",
      "Makefile",
    ]) {
      expect(checkerSource).toContain(expectedSurface);
    }

    for (const forbiddenProviderBoundName of [
      "feishu-docs",
      "jira-ops",
      "feishu-managed-user",
      "jira-auth",
      "credentials.jira",
      "feishu_mcp_endpoint",
      "feishu-real-credential-gate",
      "test:feishu:real:credential",
    ]) {
      expect(checkerSource).toContain(forbiddenProviderBoundName);
    }
  });

  it("forbids the legacy agent-runner compatibility shim as an active workspace package", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    expect(checkerSource).toContain('"packages/agent-runner"');
    expect(checkerSource).toContain("legacy @mbos/agent-runner compatibility shim");
    expect(checkerSource).toContain('"infra/runner/Dockerfile.chat-llm-runner"');
    expect(checkerSource).toContain('"infra/runner/Dockerfile.notebook-codex-runner"');
    expect(checkerSource).not.toContain('"packages/agent-runner/src/index.ts"');
    expect(checkerSource).not.toContain('"packages/agent-runner/src/protocol.ts"');
    expect(checkerSource).not.toContain('"packages/agent-runner/src/runner-spec.ts"');
  });

  it("downgrades monorepo runner startup entries to transition-only diagnostics", () => {
    const root = process.cwd();
    const checkerSource = readFileSync(
      path.join(root, "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );
    const protocol = readFileSync(
      path.join(root, "docs/contracts/agent-execution-protocol.md"),
      "utf8",
    );
    const development = readFileSync(path.join(root, "DEVELOPMENT.md"), "utf8");

    expect(
      existsSync(path.join(root, "scripts/run-agent-task-runner-dev.sh")),
      "the isolated formal dev-direct helper must be removed",
    ).toBe(false);
    expect(checkerSource).not.toContain("scripts/run-agent-task-runner-dev.sh");
    expect(checkerSource).not.toMatch(
      /requireScript\(\s*scripts,\s*"agent:task-runner"/,
    );
    expect(checkerSource).not.toMatch(
      /requirePath\(\s*"packages\/agent-task-runner\/package\.json"/,
    );
    expect(checkerSource).not.toContain("Makefile must expose agent-task-runner");
    expect(checkerSource).not.toContain(
      "Makefile agent-task-runner must use package.json agent:task-runner",
    );
    expect(checkerSource).toContain("runnerTransitionOnlyActiveFiles");
    expect(checkerSource).toContain("formal dev-direct path");
    expect(checkerSource).toContain(
      "requireRunnerTransitionOnlyDiagnosticConsistency",
    );
    expect(checkerSource).toContain(
      "transition-only diagnostic consistency",
    );
    expect(checkerSource).toContain("runnerTransitionDiagnosticReferenceFiles");
    expect(checkerSource).toContain('scripts["agent:task-runner"]');
    expect(checkerSource).toContain("/^agent-task-runner:/m");
    expect(checkerSource).toContain("$(NPM) run agent:task-runner");
    expect(protocol).not.toMatch(
      /Reference implementation:[\s\S]{0,160}@mbos\/agent-task-runner/,
    );
    expect(protocol).toMatch(
      /@mbos\/agent-task-runner[\s\S]{0,160}transition-only local diagnostic/,
    );
    expect(development).toMatch(
      /agent:task-runner[\s\S]{0,220}transition-only diagnostic[\s\S]{0,220}release proof/,
    );
  });

  it("keeps e2e helper and diagnostic command aliases on Agent Task runner names", () => {
    const root = process.cwd();
    const helperSource = readFileSync(
      path.join(root, "e2e/integration-real-helpers.ts"),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const makefile = readFileSync(path.join(root, "Makefile"), "utf8");
    const agentTaskSmokeGate = readFileSync(
      path.join(root, "scripts/agent-task-real-smoke-gate.sh"),
      "utf8",
    );
    const backendRealRun = readFileSync(
      path.join(root, "scripts/backend-real-run.sh"),
      "utf8",
    );
    const checkCurrentGates = readFileSync(
      path.join(root, "scripts/contracts/check-current-gates.ts"),
      "utf8",
    );
    const currentCoverageManifest = readFileSync(
      path.join(
        root,
        "scripts/governance/current-real-session-coverage-manifest.ts",
      ),
      "utf8",
    );
    const integrationE2eFull = readFileSync(
      path.join(root, "scripts/run-integration-e2e-full.sh"),
      "utf8",
    );
    const scripts = packageJson.scripts ?? {};

    expect(helperSource).toContain("createAgentTaskRunnerBundleViaApi");
    expect(helperSource).not.toContain("createExternalRunnerAgentBundle");
    expect(helperSource).not.toMatch(
      /\binteraction_kind\b|external_agent_id|mode:\s*['"]external['"]|\bhost_external\b|\bdocker_external\b/,
    );
    expect(helperSource).not.toMatch(
      /\/chat\/sessions[\s\S]{0,240}external_agent_id/,
    );

    expect(scripts["test:e2e:integration:agent-task:with-api"]).toBe(
      "bash scripts/run-integration-e2e-with-api.sh e2e/integration-agent-task-runner.spec.ts --grep-invert docker",
    );
    expect(scripts).not.toHaveProperty("test:e2e:integration:agents");
    expect(scripts).not.toHaveProperty("test:e2e:integration:agents:with-api");
    expect(JSON.stringify(scripts)).not.toMatch(
      /integration-agent-task-external\.spec\.ts|integration-agents-external\.spec\.ts|integration-notebook-[\w-]+\.spec\.ts/,
    );
    expect(makefile).not.toMatch(/^e2e-int-agent(?::|-local-api:|-auto:)/m);
    expect(makefile).not.toMatch(
      /integration-agent-task-external\.spec\.ts|integration-agents-external\.spec\.ts|integration-notebook-[\w-]+\.spec\.ts/,
    );
    expect(integrationE2eFull).toContain(
      'RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"',
    );
    expect(integrationE2eFull).not.toMatch(
      /\bexternal_host\b|\bhost_external\b/,
    );
    for (const [surfaceName, surface] of [
      ["agent-task-real-smoke-gate.sh", agentTaskSmokeGate],
      ["backend-real-run.sh", backendRealRun],
      ["check-current-gates.ts", checkCurrentGates],
      ["current-real-session-coverage-manifest.ts", currentCoverageManifest],
    ] as const) {
      expect(
        surface,
        `${surfaceName} must not target retired Notebook backend-real specs`,
      ).not.toMatch(
        /integration-system-notebook-default\.spec\.ts|integration-internal-notebook-workspace\.spec\.ts/,
      );
    }
    expect(agentTaskSmokeGate).toMatch(/run-internal-agent-task-real-gate\.sh/);
    expect(
      existsSync(
        path.join(root, "e2e/integration-agent-task-external.spec.ts"),
      ),
    ).toBe(false);
  });

  it("removes Notebook/Agents i18n namespaces and legacy MSW notebook handlers from active surfaces", () => {
    const root = process.cwd();
    const en = JSON.parse(
      readFileSync(path.join(root, "src/messages/en-US.json"), "utf8"),
    ) as Record<string, unknown>;
    const zh = JSON.parse(
      readFileSync(path.join(root, "src/messages/zh-CN.json"), "utf8"),
    ) as Record<string, unknown>;
    const mswIndex = readFileSync(
      path.join(root, "src/mocks/index.ts"),
      "utf8",
    );
    const p0 = JSON.parse(
      readFileSync(path.join(root, "src/mocks/fixtures/p0.json"), "utf8"),
    ) as {
      agents?: Array<{ name?: string; description?: string }>;
    };

    for (const [locale, messages] of [
      ["en-US", en],
      ["zh-CN", zh],
    ] as const) {
      expect(
        messages,
        `${locale} must not keep the retired notebook namespace`,
      ).not.toHaveProperty("notebook");
      expect(
        messages,
        `${locale} must not keep the retired agents namespace`,
      ).not.toHaveProperty("agents");
      expect(
        messages.nav,
        `${locale} nav must not expose Notebook`,
      ).not.toHaveProperty("notebook");
      expect(
        messages.nav,
        `${locale} nav must not expose Agents`,
      ).not.toHaveProperty("agents");
      expect(
        messages.nav,
        `${locale} nav must expose Agent tasks`,
      ).toHaveProperty("agent_tasks");
      expect(
        messages.nav,
        `${locale} nav must expose Agent Runners`,
      ).toHaveProperty("agent_runners");
    }

    expect(mswIndex).not.toContain("notebookHandlers");
    expect(mswIndex).not.toContain("./handlers/notebook");
    expect(existsSync(path.join(root, "src/mocks/handlers/notebook.ts"))).toBe(
      false,
    );

    for (const runner of p0.agents ?? []) {
      expect(`${runner.name ?? ""} ${runner.description ?? ""}`).not.toMatch(
        /\bSupport Agent\b|\bResearch Agent\b/,
      );
      expect(`${runner.name ?? ""} ${runner.description ?? ""}`).toMatch(
        /\bRunner\b|\bAgent task\b/,
      );
    }
  });

  it("forbids active public REST /agents outside negative proof lines", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    expect(checkerSource).toContain("activePublicRestContractFiles");
    expect(checkerSource).toContain("isAllowedPublicRestNegativeProofLine");
    expect(checkerSource).toContain("/agent-runners");
    expect(checkerSource).toContain("legacy public /agents REST path");
    expect(checkerSource).not.toContain(
      'return /"agents"\\s*:|\\/agents/.test(line);',
    );
  });

  it("keeps legacy terms only as removed/negative evidence, not compatibility guidance", () => {
    const root = process.cwd();
    const checkerSource = readFileSync(
      path.join(root, "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );
    const terminology = readFileSync(
      path.join(root, "docs/contracts/product-terminology.md"),
      "utf8",
    );
    const protocol = readFileSync(
      path.join(root, "docs/contracts/agent-execution-protocol.md"),
      "utf8",
    );
    const userGuideIndex = readFileSync(
      path.join(root, "docs/user-guides/README.md"),
      "utf8",
    );

    expect(terminology).not.toMatch(
      /compatibility requires it|Historical or migration\/audit/,
    );
    expect(terminology).toMatch(
      /Old route paths, payload fields, terminal views, and public API names may appear only in breaking allowlists, negative contract tests, or one-shot cleanup\/assertion evidence/,
    );
    expect(protocol).not.toContain("Risk Register (Notebook Codex v1)");
    expect(protocol).toMatch(
      /notebook\.task_terminal[\s\S]{0,120}negative-contract evidence/,
    );
    expect(userGuideIndex).not.toContain("notebook-codex-runbook.md");
    expect(
      existsSync(path.join(root, "docs/agent-task-runner-runbook.md")),
    ).toBe(true);
    expect(existsSync(path.join(root, "docs/notebook-codex-runbook.md"))).toBe(
      false,
    );
    expect(
      existsSync(
        path.join(
          root,
          "docs/engineering/agent-task-terminal-recovery-and-message-footer-improvement-plan-v1.md",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(
          root,
          "docs/engineering/notebook-terminal-recovery-and-message-footer-improvement-plan-v1.md",
        ),
      ),
    ).toBe(false);
    expect(checkerSource).not.toContain(
      "Risk Register \\(Notebook Codex v1\\)",
    );
    expect(checkerSource).not.toContain("notebook-codex-runbook\\.md");
    expect(checkerSource).not.toContain("Historical|migration");
  });

  it("forbids legacy public Agent Task messages and role agent wire vocabulary", () => {
    const checkerSource = readFileSync(
      path.join(process.cwd(), "scripts/contracts/check-runner-naming.ts"),
      "utf8",
    );

    expect(checkerSource).toContain("activeTaskPublicApiFiles");
    expect(checkerSource).toContain("legacy public task messages REST path");
    expect(checkerSource).toContain("legacy public task role agent vocabulary");
    expect(checkerSource).toContain("/tasks/{taskId}/activity");
    expect(checkerSource).toContain("/tasks/{taskId}/runs");
  });
});
