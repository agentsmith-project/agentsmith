import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { findCurrentGateDefinitionById } from "../governance/current-gate-manifest";
import {
  CURRENT_GATE_RESULT_ADAPTER_KEYS,
  CURRENT_GATE_RESULT_ARTIFACT_NAME,
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  CURRENT_GATE_RESULT_TOP_LEVEL_KEYS,
  CURRENT_GATE_RESULT_WRITERS,
} from "../governance/current-gate-result-schema";

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJsonFile(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function extractFirstJsonCodeBlock(markdown: string): JsonRecord {
  const match = markdown.match(/```json\s*([\s\S]*?)```/);
  assert(match, "Expected at least one ```json code block in the result schema contract.");
  return JSON.parse(match[1]) as JsonRecord;
}

function assertExactKeys(
  label: string,
  actual: string[],
  expected: readonly string[],
): void {
  assert(
    JSON.stringify(actual) === JSON.stringify([...expected]),
    `${label} keys mismatch.\nExpected: ${JSON.stringify([...expected])}\nActual: ${JSON.stringify(actual)}`,
  );
}

function assertNoCamelCaseKeys(label: string, payload: JsonRecord): void {
  const keysToCheck = [payload, payload.gate_adapter as JsonRecord];
  for (const record of keysToCheck) {
    for (const key of Object.keys(record)) {
      assert(!/[A-Z]/.test(key), `${label} contains camelCase key: ${key}`);
    }
  }
}

function generateRuntimeResult(gateId: string, evidenceDir: string): JsonRecord {
  const definition = findCurrentGateDefinitionById(gateId);
  assert(definition, `Unknown gate id in writer registry: ${gateId}`);
  const lineKind = findWriterLineKind(gateId);

  execFileSync(
    "bash",
    [
      "-lc",
      [
        `source "${resolve("scripts/lib/runtime-verification.sh")}"`,
        `gate_evidence_init "${evidenceDir}" "${lineKind}"`,
        `gate_record_success "${evidenceDir}" "${lineKind}"`,
      ].join("; "),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CURRENT_GATE_RESULT_GATE_ID: gateId,
        CURRENT_GATE_RESULT_LINE_KIND: lineKind,
        CURRENT_GATE_RESULT_NPM_SCRIPT: definition.npmScript,
        ...(definition.ciJob ? { CURRENT_GATE_RESULT_CI_JOB: definition.ciJob } : {}),
      },
      stdio: "pipe",
    },
  );

  const resultPath = join(evidenceDir, CURRENT_GATE_RESULT_ARTIFACT_NAME);
  assert(existsSync(resultPath), `Expected runtime writer to create ${resultPath}`);
  return parseJsonFile(resultPath);
}

function findWriterLineKind(gateId: string): string {
  const writer = CURRENT_GATE_RESULT_WRITERS.find((candidate) => candidate.gate_id === gateId);
  assert(writer, `Missing writer registration for gate id ${gateId}`);
  return writer.line_kind;
}

function main(): void {
  assert(CURRENT_GATE_RESULT_WRITERS.length > 0, "Expected at least one gate result writer.");

  const contractMarkdown = readFileSync(
    resolve("docs/contracts/current-gate-result-schema-contract.md"),
    "utf8",
  );
  assert(
    contractMarkdown.includes("<evidence_dir>/result.json"),
    "Current gate result schema contract must define <evidence_dir>/result.json as the canonical result path.",
  );
  assert(
    contractMarkdown.includes("CURRENT_GATE_RESULT_CI_JOB")
      && contractMarkdown.includes("GITHUB_JOB")
      && contractMarkdown.includes("campaign:<step-id>")
      && contractMarkdown.includes("local"),
    "Current gate result schema contract must define ci_job resolution precedence and local/campaign fallbacks.",
  );

  const docPayload = extractFirstJsonCodeBlock(contractMarkdown);
  const docAdapter = docPayload.gate_adapter as JsonRecord;

  assert(docAdapter && typeof docAdapter === "object", "Doc sample is missing gate_adapter.");
  assertExactKeys(
    "Doc sample top-level",
    Object.keys(docPayload),
    CURRENT_GATE_RESULT_TOP_LEVEL_KEYS,
  );
  assertExactKeys(
    "Doc sample gate_adapter",
    Object.keys(docAdapter),
    CURRENT_GATE_RESULT_ADAPTER_KEYS,
  );
  assertNoCamelCaseKeys("Doc sample", docPayload);
  assert(
    typeof docPayload.failure_class === "string"
      && CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(docPayload.failure_class as typeof CURRENT_GATE_RESULT_FAILURE_CLASSES[number]),
    `Doc sample has invalid failure_class: ${String(docPayload.failure_class)}`,
  );
  assert(
    typeof docPayload.status === "string"
      && CURRENT_GATE_RESULT_STATUSES.includes(docPayload.status as typeof CURRENT_GATE_RESULT_STATUSES[number]),
    `Doc sample has invalid status: ${String(docPayload.status)}`,
  );

  for (const writer of CURRENT_GATE_RESULT_WRITERS) {
    const gateDefinition = findCurrentGateDefinitionById(writer.gate_id);
    assert(gateDefinition, `Writer references unknown gate id: ${writer.gate_id}`);

    const tempRoot = mkdtempSync(join(tmpdir(), "check-current-gate-results-"));
    const evidenceDir = join(tempRoot, writer.gate_id, "evidence");
    const runtimePayload = generateRuntimeResult(writer.gate_id, evidenceDir);
    const runtimeAdapter = runtimePayload.gate_adapter as JsonRecord;

    assert(runtimeAdapter && typeof runtimeAdapter === "object", "Runtime sample is missing gate_adapter.");
    assertExactKeys(
      `Runtime sample top-level for ${writer.gate_id}`,
      Object.keys(runtimePayload),
      CURRENT_GATE_RESULT_TOP_LEVEL_KEYS,
    );
    assertExactKeys(
      `Runtime sample gate_adapter for ${writer.gate_id}`,
      Object.keys(runtimeAdapter),
      CURRENT_GATE_RESULT_ADAPTER_KEYS,
    );
    assertNoCamelCaseKeys(`Runtime sample for ${writer.gate_id}`, runtimePayload);
    assert(
      runtimePayload.gate_id === writer.gate_id,
      `Runtime sample gate_id mismatch for ${writer.gate_id}.`,
    );
    assert(
      runtimePayload.line_kind === writer.line_kind,
      `Runtime sample line_kind mismatch for ${writer.gate_id}.`,
    );
    assert(
      runtimePayload.evidence_dir === evidenceDir,
      `Runtime sample evidence_dir mismatch for ${writer.gate_id}.`,
    );
    assert(
      runtimePayload.failure_class === "none",
      `Runtime sample failure_class must be none for ${writer.gate_id}.`,
    );
    assert(
      runtimePayload.status === "passed",
      `Runtime sample status must be passed for ${writer.gate_id}.`,
    );
  }
}

main();
