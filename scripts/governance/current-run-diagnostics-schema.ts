export const CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION = '1.0.0' as const;

export const CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES = {
  stage_events: 'stage-events.jsonl',
  performance: 'performance.json',
  skip_decisions: 'skip-decisions.ndjson',
} as const;

export const CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS = [
  'passed',
  'reusable',
  'verdict',
  'claim_id',
  'failure_class',
  'result_status',
  'release_verdict',
  'automated_release_verdict',
] as const;

export type CurrentRunDiagnosticArtifactKind = keyof typeof CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES;
export type CurrentRunDiagnosticForbiddenField = (typeof CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS)[number];

export interface CurrentRunDiagnosticArtifactDefinition {
  kind: CurrentRunDiagnosticArtifactKind;
  file_name: (typeof CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES)[CurrentRunDiagnosticArtifactKind];
  purpose: 'diagnostic_audit';
  participates_in_evidence_completeness: false;
}

export interface CurrentRunDiagnosticsValidationFailure {
  path: string;
  reason: string;
}

export type CurrentRunDiagnosticsValidationResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      failures: readonly CurrentRunDiagnosticsValidationFailure[];
    };

export const CURRENT_RUN_DIAGNOSTICS_ARTIFACTS = [
  {
    kind: 'stage_events',
    file_name: CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES.stage_events,
    purpose: 'diagnostic_audit',
    participates_in_evidence_completeness: false,
  },
  {
    kind: 'performance',
    file_name: CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES.performance,
    purpose: 'diagnostic_audit',
    participates_in_evidence_completeness: false,
  },
  {
    kind: 'skip_decisions',
    file_name: CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES.skip_decisions,
    purpose: 'diagnostic_audit',
    participates_in_evidence_completeness: false,
  },
] as const satisfies readonly CurrentRunDiagnosticArtifactDefinition[];

const FORBIDDEN_FIELD_SET = new Set<string>(CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS);
const STAGE_EVENT_FIELDS = new Set<string>([
  'schema_version',
  'artifact_kind',
  'run_id',
  'gate_id',
  'line_kind',
  'npm_script',
  'ci_job',
  'stage',
  'event',
  'diagnostic_reason_code',
  'stage_failure_reason',
  'stage_log_path',
  'stage_input_digest',
  'stage_artifact_digest',
  'generated_at',
]);
const PERFORMANCE_FIELDS = new Set<string>([
  'schema_version',
  'artifact_kind',
  'run_id',
  'gate_id',
  'line_kind',
  'npm_script',
  'ci_job',
  'stages',
  'generated_at',
]);
const PERFORMANCE_STAGE_FIELDS = new Set<string>([
  'stage',
  'started_at',
  'finished_at',
  'duration_ms',
  'diagnostic_reason_code',
  'stage_failure_reason',
]);
const SKIP_DECISION_FIELDS = new Set<string>([
  'schema_version',
  'artifact_kind',
  'run_id',
  'gate_id',
  'line_kind',
  'target',
  'operation',
  'input_digest',
  'existing_artifact_digest',
  'skip_reason',
  'validator',
  'generated_at',
]);

export function currentRunDiagnosticArtifactParticipatesInEvidenceCompleteness(
  kind: CurrentRunDiagnosticArtifactKind,
): false {
  const definition = CURRENT_RUN_DIAGNOSTICS_ARTIFACTS.find((artifact) => artifact.kind === kind);
  return definition?.participates_in_evidence_completeness ?? false;
}

export function validateCurrentRunDiagnosticArtifactPayload(
  kind: CurrentRunDiagnosticArtifactKind,
  payload: unknown,
): CurrentRunDiagnosticsValidationResult {
  const failures: CurrentRunDiagnosticsValidationFailure[] = [];

  validateForbiddenFields(payload, 'payload', failures);

  if (!isRecord(payload)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          path: 'payload',
          reason: 'diagnostic payload must be an object.',
        },
      ],
    };
  }

  switch (kind) {
    case 'stage_events':
      validateStageEventPayload(payload, failures);
      break;
    case 'performance':
      validatePerformancePayload(payload, failures);
      break;
    case 'skip_decisions':
      validateSkipDecisionPayload(payload, failures);
      break;
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: payload,
  };
}

function validateStageEventPayload(
  payload: Record<string, unknown>,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  validateAllowedFields(payload, STAGE_EVENT_FIELDS, 'stage event', 'payload', failures);
  validateBasePayload(payload, 'stage_event', failures);
  validateString(payload.run_id, 'payload.run_id', failures);
  validateString(payload.stage, 'payload.stage', failures);
  validateString(payload.event, 'payload.event', failures);
  validateString(payload.generated_at, 'payload.generated_at', failures);

  const diagnosticReason = typeof payload.diagnostic_reason_code === 'string'
    && payload.diagnostic_reason_code.trim().length > 0;
  const failureReason = typeof payload.stage_failure_reason === 'string'
    && payload.stage_failure_reason.trim().length > 0;

  if (!diagnosticReason && !failureReason) {
    failures.push({
      path: 'payload',
      reason: 'stage events must use diagnostic_reason_code or stage_failure_reason.',
    });
  }
}

function validatePerformancePayload(
  payload: Record<string, unknown>,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  validateAllowedFields(payload, PERFORMANCE_FIELDS, 'performance', 'payload', failures);
  validateBasePayload(payload, 'performance', failures);
  validateString(payload.run_id, 'payload.run_id', failures);
  validateString(payload.generated_at, 'payload.generated_at', failures);

  if (!Array.isArray(payload.stages)) {
    failures.push({
      path: 'payload.stages',
      reason: 'performance stages must be an array.',
    });
    return;
  }

  payload.stages.forEach((stage, index) => {
    const path = `payload.stages[${index}]`;
    if (!isRecord(stage)) {
      failures.push({
        path,
        reason: 'performance stage must be an object.',
      });
      return;
    }

    validateAllowedFields(stage, PERFORMANCE_STAGE_FIELDS, 'performance stage', path, failures);
    validateString(stage.stage, `${path}.stage`, failures);
    validateNumber(stage.duration_ms, `${path}.duration_ms`, failures);
    if ('started_at' in stage) {
      validateString(stage.started_at, `${path}.started_at`, failures);
    }
    if ('finished_at' in stage) {
      validateString(stage.finished_at, `${path}.finished_at`, failures);
    }
    if ('diagnostic_reason_code' in stage) {
      validateString(stage.diagnostic_reason_code, `${path}.diagnostic_reason_code`, failures);
    }
    if ('stage_failure_reason' in stage) {
      validateString(stage.stage_failure_reason, `${path}.stage_failure_reason`, failures);
    }
  });
}

function validateSkipDecisionPayload(
  payload: Record<string, unknown>,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  validateAllowedFields(payload, SKIP_DECISION_FIELDS, 'skip decision', 'payload', failures);
  validateBasePayload(payload, 'skip_decision', failures);

  for (const field of [
    'run_id',
    'target',
    'operation',
    'input_digest',
    'existing_artifact_digest',
    'skip_reason',
    'validator',
    'generated_at',
  ] as const) {
    validateString(payload[field], `payload.${field}`, failures);
  }
}

function validateBasePayload(
  payload: Record<string, unknown>,
  artifactKind: 'stage_event' | 'performance' | 'skip_decision',
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  if (payload.schema_version !== CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION) {
    failures.push({
      path: 'payload.schema_version',
      reason: `schema_version must be ${CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION}.`,
    });
  }
  if (payload.artifact_kind !== artifactKind) {
    failures.push({
      path: 'payload.artifact_kind',
      reason: `artifact_kind must be ${artifactKind}.`,
    });
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `unknown ${label} field "${key}"`,
      });
    }
  }
}

function validateForbiddenFields(
  value: unknown,
  path: string,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateForbiddenFields(item, `${path}[${index}]`, failures));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_FIELD_SET.has(key)) {
      failures.push({
        path: childPath,
        reason: `forbidden diagnostic field "${key}"`,
      });
    }
    validateForbiddenFields(nested, childPath, failures);
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      path,
      reason: `${path} must be a non-empty string.`,
    });
  }
}

function validateNumber(
  value: unknown,
  path: string,
  failures: CurrentRunDiagnosticsValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    failures.push({
      path,
      reason: `${path} must be a non-negative number.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
