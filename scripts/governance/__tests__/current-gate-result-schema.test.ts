import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
      "true",
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

describe("current gate result schema", () => {
  it("registers the real backend-real gate writers by gate_id and line_kind", () => {
    expect(CURRENT_GATE_RESULT_WRITERS).toEqual([
      { gate_id: "lane-backend-real-core", line_kind: "backend_real" },
      { gate_id: "lane-backend-real-release", line_kind: "release_backend_real" },
      { gate_id: "lane-visual", line_kind: "visual" },
      { gate_id: "lane-demo-rehearsal", line_kind: "demo_rehearsal" },
      { gate_id: "lane-cluster-rehearsal", line_kind: "cluster_rehearsal" },
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
      "lane:demo-rehearsal",
      "lane:cluster-rehearsal",
    ]) {
      expect(packageJson.scripts[scriptName]).toContain("scripts/run-current-gate-result-wrapped.sh");
    }
  });

  it("the standalone result wrapper writes a native result for a wrapped lane command", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
    });

    expect(payload).toMatchObject({
      gate_id: "lane-visual",
      status: "passed",
      failure_class: "none",
    });
  });

  it("treats wrapped visual native results as incomplete until evidence_dir/run-manifest.json exists", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
    });

    expect(existsSync(join(payload.evidence_dir, "run-manifest.json"))).toBe(true);
  });

  it("expects lane-visual to emit a machine-readable run-manifest.json bound to the current visual build", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
    });

    const manifest = JSON.parse(
      readFileSync(join(payload.evidence_dir, "run-manifest.json"), "utf8"),
    ) as {
      schema?: string;
      build?: Record<string, unknown>;
      scenarios?: unknown[];
    };

    expect(manifest).toMatchObject({
      schema: "visual_baseline_run_manifest/v1",
      build: {
        lane: expect.any(String),
        run_id: expect.any(String),
        git_sha: expect.any(String),
        fingerprint: expect.any(String),
        started_at: expect.any(String),
      },
    });
    expect(Array.isArray(manifest.scenarios)).toBe(true);
    expect(manifest.scenarios?.length).toBeGreaterThan(0);
  });

  it("prefers explicit CURRENT_GATE_RESULT_CI_JOB over manifest and GitHub job names", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_CI_JOB: "manual-review-job",
        GITHUB_JOB: "github-visual-job",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("manual-review-job");
  });

  it("uses the current gate manifest ciJob when no explicit job is provided", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
    });

    expect(payload.gate_adapter.ci_job).toBe("lane-visual");
  });

  it("keeps manifest ciJob ahead of the campaign step fallback", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID: "lane-visual",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("lane-visual");
  });

  it("allows campaign launchers to explicitly bind a native result to the campaign step", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-visual",
      lineKind: "visual",
      npmScript: "lane:visual",
      env: {
        CURRENT_GATE_RESULT_CI_JOB: "campaign:lane-visual",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("campaign:lane-visual");
  });

  it("uses the GitHub job name for wrapped writers that do not define a manifest ciJob", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-demo-rehearsal",
      lineKind: "demo_rehearsal",
      npmScript: "lane:demo-rehearsal",
      env: {
        GITHUB_JOB: "demo-rehearsal-ci",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("demo-rehearsal-ci");
  });

  it("uses a deterministic local job fallback outside CI", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-demo-rehearsal",
      lineKind: "demo_rehearsal",
      npmScript: "lane:demo-rehearsal",
    });

    expect(payload.gate_adapter.ci_job).toBe("local");
  });

  it("uses campaign:<step-id> when a campaign step invokes a native gate writer", () => {
    const payload = runWrappedGateResult({
      gateId: "lane-demo-rehearsal",
      lineKind: "demo_rehearsal",
      npmScript: "lane:demo-rehearsal",
      env: {
        CURRENT_GATE_RESULT_CAMPAIGN_STEP_ID: "lane-demo-rehearsal",
      },
    });

    expect(payload.gate_adapter.ci_job).toBe("campaign:lane-demo-rehearsal");
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
