export const CURRENT_GATE_RESULT_SCHEMA_VERSION = "1.0.0" as const;
export const CURRENT_GATE_RESULT_ARTIFACT_NAME = "result.json" as const;

export const CURRENT_GATE_RESULT_TOP_LEVEL_KEYS = [
  "schema_version",
  "gate_id",
  "gate_adapter",
  "status",
  "failure_class",
  "stage",
  "line_kind",
  "evidence_dir",
  "summary",
  "generated_at",
] as const;

export const CURRENT_GATE_RESULT_ADAPTER_KEYS = ["npm_script", "ci_job"] as const;

export const CURRENT_GATE_RESULT_FAILURE_CLASSES = [
  "none",
  "product_regression",
  "infra_setup_failure",
  "environment_conflict",
  "contract_drift",
  "evidence_missing",
] as const;

export const CURRENT_GATE_RESULT_STATUSES = ["passed", "failed"] as const;

export type CurrentGateResultTopLevelKey =
  (typeof CURRENT_GATE_RESULT_TOP_LEVEL_KEYS)[number];

export type CurrentGateResultAdapterKey =
  (typeof CURRENT_GATE_RESULT_ADAPTER_KEYS)[number];

export type CurrentGateResultFailureClass =
  (typeof CURRENT_GATE_RESULT_FAILURE_CLASSES)[number];

export type CurrentGateResultStatus =
  (typeof CURRENT_GATE_RESULT_STATUSES)[number];

export interface CurrentGateResultCanonicalAdapter {
  npm_script: string | null;
  ci_job: string | null;
}

export interface CurrentGateResultCanonicalRecord {
  schema_version: string;
  gate_id: string;
  gate_adapter: CurrentGateResultCanonicalAdapter;
  status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  stage: string;
  line_kind: string;
  evidence_dir: string;
  summary: string;
  generated_at: string;
}

export interface CurrentGateResultWriter {
  gate_id: string;
  line_kind: string;
}

export const CURRENT_GATE_RESULT_WRITERS = [
  {
    gate_id: "lane-backend-real-core",
    line_kind: "backend_real",
  },
  {
    gate_id: "lane-backend-real-release",
    line_kind: "release_backend_real",
  },
] as const satisfies readonly CurrentGateResultWriter[];

export function findCurrentGateResultWriter(gateId: string) {
  return CURRENT_GATE_RESULT_WRITERS.find((writer) => writer.gate_id === gateId);
}

export function resolveCurrentGateResultPath(evidenceDir: string): string {
  return `${evidenceDir.replace(/\/$/, "")}/${CURRENT_GATE_RESULT_ARTIFACT_NAME}`;
}
