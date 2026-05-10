import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { findCurrentGateDefinitionById } from "../current-gate-manifest";
import {
  CURRENT_GATE_RESULT_ADAPTER_KEYS,
  CURRENT_GATE_RESULT_ARTIFACT_NAME,
  CURRENT_GATE_RESULT_TOP_LEVEL_KEYS,
  CURRENT_GATE_RESULT_WRITERS,
  findCurrentGateResultWriter,
} from "../current-gate-result-schema";

type GateResultPayload = {
  gate_id: string;
  status: string;
  failure_class: string;
  evidence_dir: string;
  gate_adapter: {
    npm_script: string | null;
    ci_job: string | null;
  };
};

function gateResultEnv(
  evidenceDir: string,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CURRENT_GATE_RESULT_EVIDENCE_DIR: evidenceDir,
    ...overrides,
  };
  for (const key of [
    "CURRENT_GATE_RESULT_CI_JOB",
    "CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID",
    "GITHUB_JOB",
  ]) {
    if (!(key in overrides)) {
      delete env[key];
    }
  }
  return env;
}

function runWrappedGateResult(input: {
  gateId: string;
  lineKind: string;
  npmScript: string;
  env?: Record<string, string>;
  command?: string;
}): GateResultPayload {
  const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-"));
  const evidenceDir = join(tempRoot, input.gateId, "native");

  execFileSync(
    "bash",
    [
      "scripts/run-current-gate-result-wrapped.sh",
      input.gateId,
      input.lineKind,
      input.npmScript,
      "--",
      "bash",
      "-lc",
      input.command ?? "true",
    ],
    {
      cwd: process.cwd(),
      env: gateResultEnv(evidenceDir, input.env),
      stdio: "pipe",
    },
  );

  return JSON.parse(
    readFileSync(join(evidenceDir, CURRENT_GATE_RESULT_ARTIFACT_NAME), "utf8"),
  ) as GateResultPayload;
}

function runWrappedGateResultExpectFailure(input: {
  gateId: string;
  lineKind: string;
  npmScript: string;
  env?: Record<string, string>;
  command?: string;
}): GateResultPayload {
  const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-"));
  const evidenceDir = join(tempRoot, input.gateId, "native");

  expect(() => execFileSync(
    "bash",
    [
      "scripts/run-current-gate-result-wrapped.sh",
      input.gateId,
      input.lineKind,
      input.npmScript,
      "--",
      "bash",
      "-lc",
      input.command ?? "true",
    ],
    {
      cwd: process.cwd(),
      env: gateResultEnv(evidenceDir, input.env),
      stdio: "pipe",
    },
  )).toThrow();

  return JSON.parse(
    readFileSync(join(evidenceDir, CURRENT_GATE_RESULT_ARTIFACT_NAME), "utf8"),
  ) as GateResultPayload;
}

function seedVisualProducerManifestSource(tempRoot: string, runId: string): string {
  const reviewRoot = join(tempRoot, "visual-baseline-reviews");
  const runRoot = join(reviewRoot, runId);
  mkdirSync(runRoot, { recursive: true });
  const actualCapturePath = join(runRoot, "captured", "workspace-login", "workspace-login.png");
  const actualCapture = Buffer.from(`run-bound actual capture for ${runId}`);
  mkdirSync(join(runRoot, "captured", "workspace-login"), { recursive: true });
  writeFileSync(actualCapturePath, actualCapture);
  writeFileSync(
    join(runRoot, "run-manifest.json"),
    `${JSON.stringify({
      schema: "visual_baseline_run_manifest/v2",
      run_id: runId,
      build: {
        lane: "mock-lane",
        run_id: runId,
        git_sha: "test-git-sha",
        fingerprint: `${runId}:mock-lane:visual`,
        started_at: "2026-04-16T08:00:00.000Z",
      },
      coverage: {
        scope: "full_catalog",
        expected_scenario_ids: ["workspace-login"],
        captured_scenario_ids: ["workspace-login"],
      },
      scenarios: [
        {
          scenario_id: "workspace-login",
          actual_url: "/en-US/workspaces/ws_default/login",
          story_fingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          screenshots: [
            {
              file_name: "workspace-login.png",
              actual_relpath: "captured/workspace-login/workspace-login.png",
              actual_sha256: `sha256:${createHash("sha256").update(actualCapture).digest("hex")}`,
              baseline_sha256: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
            },
          ],
        },
      ],
    }, null, 2)}\n`,
  );
  return reviewRoot;
}

function seededVisualWrapperEnv(runId: string, overrides: Record<string, string> = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-source-"));
  const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
  return {
    CURRENT_GATE_RESULT_RUN_ID: runId,
    VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
    ...overrides,
  };
}

describe("current gate result schema", () => {
  it("registers the real backend-real gate writers by gate_id and line_kind", () => {
    expect(CURRENT_GATE_RESULT_WRITERS).toEqual([
      { gate_id: "lane-backend-real-core", line_kind: "backend_real" },
      { gate_id: "lane-backend-real-release", line_kind: "release_backend_real" },
      { gate_id: "lane-visual", line_kind: "visual" },
      { gate_id: "lane-unified-deploy-substrate", line_kind: "unified_deploy_substrate" },
      { gate_id: "lane-unified-deploy-local-kind-images", line_kind: "unified_deploy_local_kind_images" },
      { gate_id: "lane-unified-deploy-local-kind", line_kind: "unified_deploy_local_kind" },
      { gate_id: "lane-unified-deploy-product-flows", line_kind: "unified_deploy_product_flows" },
      { gate_id: "gate-release-full", line_kind: "release_full_verdict" },
    ]);
  });

  it("resolves each writer by gate_id", () => {
    for (const writer of CURRENT_GATE_RESULT_WRITERS) {
      expect(findCurrentGateResultWriter(writer.gate_id)).toEqual(writer);
    }
  });

  it("routes standalone release evidence lanes through the canonical result wrapper", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    for (const scriptName of [
      "lane:visual",
      "lane:unified-deploy:substrate",
      "lane:unified-deploy:local-kind:images",
      "lane:unified-deploy:local-kind",
      "lane:unified-deploy:product-flows",
    ]) {
      expect(packageJson.scripts[scriptName]).toContain("scripts/run-current-gate-result-wrapped.sh");
    }
  });

  it("the standalone result wrapper writes a native result for a wrapped lane command", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-source-"));
    const runId = "run-wrapper-result";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    expect(payload).toMatchObject({
      gate_id: "lane-visual",
      status: "passed",
      failure_class: "none",
    });
  });

  it("passes CURRENT_GATE_RESULT_RUN_ID through as MOCK_RUN_ID when lane-visual does not receive one explicitly", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-mock-run-id-"));
    const runId = "run-wrapper-mock-run-id";
    const reviewRoot = join(tempRoot, "visual-baseline-reviews");
    const sourceManifestPath = join(reviewRoot, runId, "run-manifest.json");
    const producerManifest = {
      schema: "visual_baseline_run_manifest/v2",
      run_id: runId,
      build: {
        lane: "mock-lane",
        run_id: runId,
        git_sha: "test-git-sha",
        fingerprint: `${runId}:mock-lane:visual`,
        started_at: "2026-04-16T08:00:00.000Z",
      },
      coverage: {
        scope: "full_catalog",
        expected_scenario_ids: ["workspace-login"],
        captured_scenario_ids: ["workspace-login"],
      },
      scenarios: [
        {
          scenario_id: "workspace-login",
          actual_url: "/en-US/workspaces/ws_default/login",
          story_fingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          screenshots: [
            {
              file_name: "workspace-login.png",
              actual_relpath: "captured/workspace-login/workspace-login.png",
              actual_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
              baseline_sha256: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
            },
          ],
        },
      ],
    };
    const writeProducerManifestCommand = [
      "node --input-type=module -e",
      JSON.stringify([
        'import { createHash } from "node:crypto";',
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'const runId = process.env.MOCK_RUN_ID?.trim();',
        'const reviewRoot = process.env.VISUAL_BASELINE_REVIEW_ROOT?.trim();',
        'if (!runId || !reviewRoot) throw new Error("missing visual producer context");',
        "const runRoot = join(reviewRoot, runId);",
        "mkdirSync(runRoot, { recursive: true });",
        'const actualRelPath = "captured/workspace-login/workspace-login.png";',
        'const actualCapture = Buffer.from("run-bound actual capture for " + runId);',
        'mkdirSync(join(runRoot, "captured", "workspace-login"), { recursive: true });',
        'writeFileSync(join(runRoot, actualRelPath), actualCapture);',
        `const manifest = ${JSON.stringify(producerManifest)};`,
        'manifest.scenarios[0].screenshots[0].actual_sha256 = "sha256:" + createHash("sha256").update(actualCapture).digest("hex");',
        'writeFileSync(join(runRoot, "run-manifest.json"), JSON.stringify(manifest, null, 2) + "\\n");',
      ].join(" ")),
    ].join(" ");

    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
      command: writeProducerManifestCommand,
    });

    const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8")) as unknown;
    const copiedManifest = JSON.parse(
      readFileSync(join(payload.evidence_dir, "run-manifest.json"), "utf8"),
    ) as unknown;

    expect(sourceManifest).toEqual(copiedManifest);
  });

  it("treats wrapped visual native results as incomplete until evidence_dir/run-manifest.json exists", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-source-"));
    const runId = "run-wrapper-incomplete";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    expect(existsSync(join(payload.evidence_dir, "run-manifest.json"))).toBe(true);
  });

  it("copies run-manifest actual captures into the standalone lane-visual evidence_dir", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-source-"));
    const runId = "run-wrapper-captured-artifacts";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    expect(
      existsSync(join(payload.evidence_dir, "captured", "workspace-login", "workspace-login.png")),
    ).toBe(true);
    expect(
      readFileSync(join(payload.evidence_dir, "captured", "workspace-login", "workspace-login.png"), "utf8"),
    ).toBe(`run-bound actual capture for ${runId}`);
  });

  it("expects lane-visual to emit a machine-readable run-manifest.json bound to the current visual build", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-source-"));
    const runId = "run-wrapper-manifest";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    const manifest = JSON.parse(
      readFileSync(join(payload.evidence_dir, "run-manifest.json"), "utf8"),
    ) as {
      schema?: string;
      build?: Record<string, unknown>;
      scenarios?: unknown[];
    };

    expect(manifest).toMatchObject({
      schema: expect.any(String),
      build: {
        lane: expect.any(String),
        run_id: expect.any(String),
        git_sha: expect.any(String),
        fingerprint: expect.any(String),
        started_at: expect.any(String),
      },
      coverage: {
        scope: expect.any(String),
        expected_scenario_ids: expect.any(Array),
        captured_scenario_ids: expect.any(Array),
      },
    });
    expect(Array.isArray(manifest.scenarios)).toBe(true);
    expect(manifest.scenarios?.length).toBeGreaterThan(0);
  });

  it("fails closed when lane-visual wrapped execution has no producer-owned run-manifest source", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-missing-source-"));

    const payload = runWrappedGateResultExpectFailure({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: "run-wrapper-missing",
        VISUAL_BASELINE_REVIEW_ROOT: join(tempRoot, "missing-review-root"),
      },
    });

    expect(payload).toMatchObject({
      gate_id: "lane-visual",
      status: "failed",
      failure_class: "evidence_missing",
    });
  });

  it("fails closed when release-grade lane-visual evidence declares partial coverage", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-partial-coverage-"));
    const runId = "run-wrapper-partial-coverage";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const manifestPath = join(reviewRoot, runId, "run-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      coverage: Record<string, unknown>;
    };
    manifest.coverage = {
      scope: "partial_catalog",
      expected_scenario_ids: ["workspace-login", "access-guide"],
      captured_scenario_ids: ["workspace-login"],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const payload = runWrappedGateResultExpectFailure({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        RELEASE_CAMPAIGN_ROOT: join(tempRoot, "campaign-root"),
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    expect(payload).toMatchObject({
      gate_id: "lane-visual",
      status: "failed",
      failure_class: "evidence_missing",
    });
  });

  it("fails closed when standalone lane-visual evidence declares partial coverage", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-wrapper-standalone-partial-coverage-"));
    const runId = "run-wrapper-standalone-partial-coverage";
    const reviewRoot = seedVisualProducerManifestSource(tempRoot, runId);
    const manifestPath = join(reviewRoot, runId, "run-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      coverage: Record<string, unknown>;
    };
    manifest.coverage = {
      scope: "partial_catalog",
      expected_scenario_ids: ["workspace-login", "access-guide"],
      captured_scenario_ids: ["workspace-login"],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const payload = runWrappedGateResultExpectFailure({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_RUN_ID: runId,
        VISUAL_BASELINE_REVIEW_ROOT: reviewRoot,
      },
    });

    expect(payload).toMatchObject({
      gate_id: "lane-visual",
      status: "failed",
      failure_class: "evidence_missing",
    });
  });

  it("prefers explicit CURRENT_GATE_RESULT_CI_JOB over manifest and GitHub job names", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: seededVisualWrapperEnv("run-wrapper-explicit-ci-job", {
        CURRENT_GATE_RESULT_CI_JOB: "manual-review-job",
        GITHUB_JOB: "github-visual-job",
      }),
    });

    expect(payload.gate_adapter.ci_job).toBe("manual-review-job");
  });

  it("uses the current gate manifest ciJob when no explicit job is provided", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: seededVisualWrapperEnv("run-wrapper-manifest-ci-job"),
    });

    expect(payload.gate_adapter.ci_job).toBe("lane-visual");
  });

  it("keeps manifest ciJob ahead of the campaign step fallback", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: seededVisualWrapperEnv("run-wrapper-step-fallback", {
        CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID: "lane-visual",
      }),
    });

    expect(payload.gate_adapter.ci_job).toBe("lane-visual");
  });

  it("allows campaign launchers to explicitly bind a native result to the campaign step", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: seededVisualWrapperEnv("run-wrapper-campaign-ci-job", {
        CURRENT_GATE_RESULT_CI_JOB: "campaign:lane-visual",
      }),
    });

    expect(payload.gate_adapter.ci_job).toBe("campaign:lane-visual");
  });

  it("uses the GitHub job name for wrapped writers that do not define a manifest ciJob", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-unified-deploy-substrate",
      lineKind: "unified_deploy_substrate",
      npmScript: "lane:unified-deploy:substrate",
      env: {
        GITHUB_JOB: "unified-deploy-substrate-ci",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("unified-deploy-substrate-ci");
  });

  it("uses a deterministic local job fallback outside CI", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-unified-deploy-substrate",
      lineKind: "unified_deploy_substrate",
      npmScript: "lane:unified-deploy:substrate",
    });

    expect(payload.gate_adapter.ci_job).toBe("local");
  });

  it.each([
    {
      gateId: "lane-unified-deploy-substrate",
      lineKind: "unified_deploy_substrate",
      npmScript: "lane:unified-deploy:substrate",
    },
    {
      gateId: "lane-unified-deploy-local-kind-images",
      lineKind: "unified_deploy_local_kind_images",
      npmScript: "lane:unified-deploy:local-kind:images",
    },
    {
      gateId: "lane-unified-deploy-local-kind",
      lineKind: "unified_deploy_local_kind",
      npmScript: "lane:unified-deploy:local-kind",
    },
  ])("classifies failed infrastructure deploy lane %s as infra setup failure", (input) => {
    const payload = runWrappedGateResultExpectFailure({
      ...input,
      command: "exit 42",
    });

    expect(payload.status).toBe("failed");
    expect(payload.failure_class).toBe("infra_setup_failure");
  });

  it("uses campaign:<step-id> when a campaign step invokes a native gate writer", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-unified-deploy-substrate",
      lineKind: "unified_deploy_substrate",
      npmScript: "lane:unified-deploy:substrate",
      env: {
        CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID: "lane-unified-deploy-substrate",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("campaign:lane-unified-deploy-substrate");
  });

  it.each(CURRENT_GATE_RESULT_WRITERS)(
    "writes canonical snake_case result.json into <evidence_dir>/%s",
    (writer) => {
      const definition = findCurrentGateDefinitionById(writer.gate_id);
      if (!definition) {
        throw new Error(`Missing gate definition for ${writer.gate_id}`);
      }

      const tempRoot = mkdtempSync(join(tmpdir(), "current-gate-result-schema-"));
      const evidenceDir = join(tempRoot, writer.gate_id, "evidence");
      const outputPath = join(evidenceDir, CURRENT_GATE_RESULT_ARTIFACT_NAME);

      execFileSync(
        "bash",
        [
          "-lc",
          [
            `source "${resolve("scripts/lib/runtime-verification.sh")}"`,
            `gate_evidence_init "${evidenceDir}" "${writer.line_kind}"`,
            `gate_record_success "${evidenceDir}" "${writer.line_kind}"`,
          ].join("; "),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CURRENT_GATE_RESULT_GATE_ID: writer.gate_id,
            CURRENT_GATE_RESULT_LINE_KIND: writer.line_kind,
            CURRENT_GATE_RESULT_NPM_SCRIPT: definition.npmScript,
            ...(definition.ciJob
              ? { CURRENT_GATE_RESULT_CI_JOB: definition.ciJob }
              : {}),
          },
          stdio: "pipe",
        },
      );

      expect(existsSync(outputPath)).toBe(true);

      const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
        gate_adapter: Record<string, unknown>;
        gate_id: string;
        line_kind: string;
        status: string;
        failure_class: string;
        evidence_dir: string;
      };

      expect(Object.keys(payload)).toEqual([...CURRENT_GATE_RESULT_TOP_LEVEL_KEYS]);
      expect(Object.keys(payload.gate_adapter)).toEqual([
        ...CURRENT_GATE_RESULT_ADAPTER_KEYS,
      ]);
      expect(payload.gate_id).toBe(writer.gate_id);
      expect(payload.line_kind).toBe(writer.line_kind);
      expect(payload.status).toBe("passed");
      expect(payload.failure_class).toBe("none");
      expect(payload.evidence_dir).toBe(evidenceDir);
      expect(payload).not.toHaveProperty("gateId");
      expect(payload).not.toHaveProperty("failureClass");
      expect(payload).not.toHaveProperty("generatedAt");
      expect(payload.gate_adapter).not.toHaveProperty("npmScript");
      expect(payload.gate_adapter).not.toHaveProperty("ciJob");
    },
  );
});
