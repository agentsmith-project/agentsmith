import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import {
  findCurrentPureCheckIdentityById,
  type CurrentPureCheckId,
} from './current-pure-check-identity-manifest';
import { findRedactionLeaks, redactSensitiveText } from './redaction';

export const PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA = 'agentsmith_pure_check_producer_evidence/v1' as const;
export const PURE_CHECK_PRODUCER_EVIDENCE_DIR_NAME = 'pure-check-producer' as const;
export const PURE_CHECK_PRODUCER_RESULT_FILE_NAME = 'result.json' as const;
export const PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID = 'producer-result' as const;

export type PureCheckProducerArtifactScope = 'repo_root' | 'report_root' | 'evidence_dir';
export type PureCheckProducerArtifactKind = 'file';

export interface PureCheckProducerSummaryDigest {
  digest: string | null;
  summary_length: number;
  redacted: boolean;
}

export interface PureCheckProducerRequiredArtifactInput {
  id: string;
  scope: PureCheckProducerArtifactScope;
  path: string;
  kind?: PureCheckProducerArtifactKind;
}

export interface PureCheckProducerRequiredArtifactRef {
  id: string;
  scope: PureCheckProducerArtifactScope;
  path: string;
  kind: PureCheckProducerArtifactKind;
  digest: string | null;
  size_bytes: number | null;
}

export interface PureCheckProducerEvidenceRecord {
  schema: typeof PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA;
  check_id: CurrentPureCheckId;
  owning_job_id: string;
  gate_id: string;
  command: string;
  npm_script: string | null;
  report_root: string;
  evidence_dir: string;
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  exit_code: number | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  stdout_summary_digest: PureCheckProducerSummaryDigest;
  stderr_summary_digest: PureCheckProducerSummaryDigest;
  required_artifacts: readonly PureCheckProducerRequiredArtifactRef[];
  generated_at: string;
}

export interface PureCheckProducerEvidenceValidationFailure {
  code: string;
  path: string;
  message: string;
}

export type PureCheckProducerEvidenceValidationResult =
  | {
      ok: true;
      value: PureCheckProducerEvidenceRecord;
    }
  | {
      ok: false;
      failures: readonly PureCheckProducerEvidenceValidationFailure[];
    };

export interface PureCheckProducerEvidenceWriteInput {
  repoRoot?: string;
  reportRoot: string;
  checkId: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  generatedAt?: string;
  stdoutSummary?: string | null;
  stderrSummary?: string | null;
  requiredArtifacts?: readonly PureCheckProducerRequiredArtifactInput[];
}

export type PureCheckProducerEvidenceWriteResult =
  | {
      ok: true;
      evidence_dir: string;
      path: string;
      digest: string;
      record: PureCheckProducerEvidenceRecord;
    }
  | {
      ok: false;
      evidence_dir: string;
      path: string;
      failures: readonly PureCheckProducerEvidenceValidationFailure[];
    };

export interface PureCheckProducerEvidenceReadInput {
  repoRoot?: string;
  reportRoot: string;
  checkId: string;
}

export type PureCheckProducerEvidenceReadResult =
  | {
      ok: true;
      path: string;
      digest: string;
      value: PureCheckProducerEvidenceRecord;
    }
  | {
      ok: false;
      path: string;
      failures: readonly PureCheckProducerEvidenceValidationFailure[];
    };

export interface PureCheckProducerEvidenceValidationInput {
  repoRoot?: string;
  reportRoot: string;
  expectedCheckId?: string;
}

interface PureCheckProducerEvidenceInternalValidationInput extends PureCheckProducerEvidenceValidationInput {
  allowMissingSelfArtifact?: boolean;
}

interface PureCheckProducerArtifactRoots {
  repoRoot: string;
  reportRoot: string;
  evidenceDir: string;
}

type UnknownRecord = Record<string, unknown>;

export const TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS = [
  {
    id: 'next-typegen-routes',
    scope: 'repo_root',
    path: '.next/types/routes.d.ts',
    kind: 'file',
  },
  {
    id: 'next-env',
    scope: 'repo_root',
    path: 'next-env.d.ts',
    kind: 'file',
  },
] as const satisfies readonly PureCheckProducerRequiredArtifactInput[];

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TOP_LEVEL_KEYS = [
  'schema',
  'check_id',
  'owning_job_id',
  'gate_id',
  'command',
  'npm_script',
  'report_root',
  'evidence_dir',
  'result_status',
  'failure_class',
  'exit_code',
  'started_at',
  'finished_at',
  'duration_ms',
  'stdout_summary_digest',
  'stderr_summary_digest',
  'required_artifacts',
  'generated_at',
] as const;
const SUMMARY_DIGEST_KEYS = ['digest', 'summary_length', 'redacted'] as const;
const REQUIRED_ARTIFACT_KEYS = ['id', 'scope', 'path', 'kind', 'digest', 'size_bytes'] as const;
const ARTIFACT_SCOPES = ['repo_root', 'report_root', 'evidence_dir'] as const satisfies readonly PureCheckProducerArtifactScope[];
const ARTIFACT_KINDS = ['file'] as const satisfies readonly PureCheckProducerArtifactKind[];

const TOP_LEVEL_KEY_SET = new Set<string>(TOP_LEVEL_KEYS);
const SUMMARY_DIGEST_KEY_SET = new Set<string>(SUMMARY_DIGEST_KEYS);
const REQUIRED_ARTIFACT_KEY_SET = new Set<string>(REQUIRED_ARTIFACT_KEYS);
const STATUS_SET = new Set<string>(CURRENT_GATE_RESULT_STATUSES);
const FAILURE_CLASS_SET = new Set<string>(CURRENT_GATE_RESULT_FAILURE_CLASSES);
const ARTIFACT_SCOPE_SET = new Set<string>(ARTIFACT_SCOPES);
const ARTIFACT_KIND_SET = new Set<string>(ARTIFACT_KINDS);

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushFailure(
  failures: PureCheckProducerEvidenceValidationFailure[],
  code: string,
  path: string,
  message: string,
): void {
  failures.push({ code, path, message });
}

function validateAllowedKeys(
  value: UnknownRecord,
  allowedKeys: ReadonlySet<string>,
  basePath: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      pushFailure(
        failures,
        'unknown_key',
        basePath ? `${basePath}.${key}` : key,
        `Unknown key is not allowed: ${key}.`,
      );
    }
  }
}

function digestIsValid(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function validateDigestOrNull(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (value !== null && !digestIsValid(value)) {
    pushFailure(failures, 'malformed_digest', path, 'Digest must be null or sha256:<64 lowercase hex chars>.');
  }
}

function validateRequiredString(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    pushFailure(failures, 'invalid_type', path, 'Value must be a non-empty string.');
    return undefined;
  }
  return value;
}

function validateNullableString(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    pushFailure(failures, 'invalid_type', path, 'Value must be null or a non-empty string.');
    return undefined;
  }
  return value;
}

function validateIntegerOrNull(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    pushFailure(failures, 'invalid_type', path, 'Value must be null or an integer.');
    return undefined;
  }
  return value;
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    pushFailure(failures, 'invalid_type', path, 'Value must be a non-negative integer.');
    return undefined;
  }
  return value;
}

function parseTimestamp(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    pushFailure(failures, 'invalid_timestamp', path, 'Value must be an ISO timestamp string.');
    return undefined;
  }
  return value;
}

function isCurrentGateResultStatus(value: unknown): value is CurrentGateResultStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

function isCurrentGateResultFailureClass(value: unknown): value is CurrentGateResultFailureClass {
  return typeof value === 'string' && FAILURE_CLASS_SET.has(value);
}

function summarizeOutput(value: string | null | undefined): PureCheckProducerSummaryDigest {
  const original = value ?? '';
  if (original.length === 0) {
    return {
      digest: null,
      summary_length: 0,
      redacted: false,
    };
  }

  const redacted = redactSensitiveText(original);

  return {
    digest: sha256(redacted),
    summary_length: original.length,
    redacted: redacted !== original,
  };
}

function makeSelfArtifactRef(): PureCheckProducerRequiredArtifactRef {
  return {
    id: PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
    scope: 'evidence_dir',
    path: PURE_CHECK_PRODUCER_RESULT_FILE_NAME,
    kind: 'file',
    digest: null,
    size_bytes: null,
  };
}

function expectedEvidenceDir(reportRoot: string, checkId: string): string {
  return join(reportRoot, PURE_CHECK_PRODUCER_EVIDENCE_DIR_NAME, checkId);
}

function expectedEvidencePath(reportRoot: string, checkId: string): string {
  return join(expectedEvidenceDir(reportRoot, checkId), PURE_CHECK_PRODUCER_RESULT_FILE_NAME);
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function isInsidePath(candidate: string, base: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedCandidate = resolve(candidate);
  const pathRelativeToBase = relative(resolvedBase, resolvedCandidate);

  return pathRelativeToBase === ''
    || (!pathRelativeToBase.startsWith('..') && !pathRelativeToBase.includes(`..${sep}`));
}

function artifactBasePath(scope: PureCheckProducerArtifactScope, roots: PureCheckProducerArtifactRoots): string {
  if (scope === 'repo_root') {
    return roots.repoRoot;
  }
  if (scope === 'report_root') {
    return roots.reportRoot;
  }
  return roots.evidenceDir;
}

function resolveArtifactPath(
  artifact: Pick<PureCheckProducerRequiredArtifactRef, 'scope' | 'path'>,
  roots: PureCheckProducerArtifactRoots,
): string | null {
  const pathSegments = artifact.path.split(/[\\/]+/);
  if (artifact.path.startsWith('/') || pathSegments.includes('..')) {
    return null;
  }

  const basePath = artifactBasePath(artifact.scope, roots);
  const absolutePath = resolve(basePath, artifact.path);
  if (!isInsidePath(absolutePath, basePath)) {
    return null;
  }
  return absolutePath;
}

async function buildRequiredArtifactRef(
  artifact: PureCheckProducerRequiredArtifactInput,
  roots: PureCheckProducerArtifactRoots,
  index: number,
): Promise<
  | {
      ok: true;
      value: PureCheckProducerRequiredArtifactRef;
    }
  | {
      ok: false;
      failure: PureCheckProducerEvidenceValidationFailure;
    }
> {
  const ref: PureCheckProducerRequiredArtifactRef = {
    id: artifact.id,
    scope: artifact.scope,
    path: artifact.path,
    kind: artifact.kind ?? 'file',
    digest: null,
    size_bytes: null,
  };
  const artifactPath = resolveArtifactPath(ref, roots);
  if (!artifactPath) {
    return {
      ok: false,
      failure: {
        code: 'scope_leak',
        path: `requiredArtifacts[${index}].path`,
        message: 'Required artifact path must stay within its declared scope.',
      },
    };
  }

  try {
    const artifactStat = await stat(artifactPath);
    if (!artifactStat.isFile()) {
      return {
        ok: false,
        failure: {
          code: 'required_artifact_missing',
          path: `requiredArtifacts[${index}].path`,
          message: 'Required artifact must be an existing file.',
        },
      };
    }
    const content = await readFile(artifactPath);
    return {
      ok: true,
      value: {
        ...ref,
        digest: sha256(content),
        size_bytes: artifactStat.size,
      },
    };
  } catch {
    return {
      ok: false,
      failure: {
        code: 'required_artifact_missing',
        path: `requiredArtifacts[${index}].path`,
        message: 'Required artifact must be an existing file.',
      },
    };
  }
}

async function buildRequiredArtifactRefs(
  inputs: readonly PureCheckProducerRequiredArtifactInput[],
  roots: PureCheckProducerArtifactRoots,
): Promise<
  | {
      ok: true;
      value: readonly PureCheckProducerRequiredArtifactRef[];
    }
  | {
      ok: false;
      failures: readonly PureCheckProducerEvidenceValidationFailure[];
    }
> {
  const refs: PureCheckProducerRequiredArtifactRef[] = [makeSelfArtifactRef()];
  const failures: PureCheckProducerEvidenceValidationFailure[] = [];

  for (const [index, input] of inputs.entries()) {
    const result = await buildRequiredArtifactRef(input, roots, index);
    if (result.ok) {
      refs.push(result.value);
    } else {
      failures.push(result.failure);
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: refs,
  };
}

function recordJson(record: PureCheckProducerEvidenceRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function writePureCheckProducerEvidence(
  input: PureCheckProducerEvidenceWriteInput,
): Promise<PureCheckProducerEvidenceWriteResult> {
  const identity = findCurrentPureCheckIdentityById(input.checkId);
  const evidenceDir = expectedEvidenceDir(input.reportRoot, input.checkId);
  const resultPath = expectedEvidencePath(input.reportRoot, input.checkId);

  if (!identity) {
    return {
      ok: false,
      evidence_dir: evidenceDir,
      path: resultPath,
      failures: [
        {
          code: 'unknown_check_id',
          path: 'check_id',
          message: `Unknown pure check id: ${input.checkId}.`,
        },
      ],
    };
  }

  const repoRoot = input.repoRoot ?? process.cwd();
  const roots: PureCheckProducerArtifactRoots = {
    repoRoot,
    reportRoot: input.reportRoot,
    evidenceDir,
  };
  const artifactResult = await buildRequiredArtifactRefs(input.requiredArtifacts ?? [], roots);
  if (!artifactResult.ok) {
    return {
      ok: false,
      evidence_dir: evidenceDir,
      path: resultPath,
      failures: artifactResult.failures,
    };
  }

  const startedMs = Date.parse(input.startedAt);
  const finishedMs = Date.parse(input.finishedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs) && finishedMs >= startedMs
    ? finishedMs - startedMs
    : 0;
  const record: PureCheckProducerEvidenceRecord = {
    schema: PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
    check_id: identity.check_id,
    owning_job_id: identity.owning_job_id,
    gate_id: identity.owning_gate_id,
    command: identity.command,
    npm_script: identity.npm_script ?? null,
    report_root: input.reportRoot,
    evidence_dir: evidenceDir,
    result_status: input.resultStatus,
    failure_class: input.failureClass,
    exit_code: input.exitCode,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: durationMs,
    stdout_summary_digest: summarizeOutput(input.stdoutSummary),
    stderr_summary_digest: summarizeOutput(input.stderrSummary),
    required_artifacts: artifactResult.value,
    generated_at: input.generatedAt ?? new Date().toISOString(),
  };

  const validation = await validatePureCheckProducerEvidenceInternal(record, {
    repoRoot,
    reportRoot: input.reportRoot,
    expectedCheckId: identity.check_id,
    allowMissingSelfArtifact: true,
  });
  if (!validation.ok) {
    return {
      ok: false,
      evidence_dir: evidenceDir,
      path: resultPath,
      failures: validation.failures,
    };
  }

  await mkdir(evidenceDir, { recursive: true });
  const content = recordJson(record);
  await writeFile(resultPath, content, 'utf8');

  const readBack = await validatePureCheckProducerEvidenceInternal(record, {
    repoRoot,
    reportRoot: input.reportRoot,
    expectedCheckId: identity.check_id,
  });
  if (!readBack.ok) {
    return {
      ok: false,
      evidence_dir: evidenceDir,
      path: resultPath,
      failures: readBack.failures,
    };
  }

  return {
    ok: true,
    evidence_dir: evidenceDir,
    path: resultPath,
    digest: sha256(content),
    record,
  };
}

export async function readPureCheckProducerEvidence(
  input: PureCheckProducerEvidenceReadInput,
): Promise<PureCheckProducerEvidenceReadResult> {
  const resultPath = expectedEvidencePath(input.reportRoot, input.checkId);
  if (!findCurrentPureCheckIdentityById(input.checkId)) {
    return {
      ok: false,
      path: resultPath,
      failures: [
        {
          code: 'unknown_check_id',
          path: 'check_id',
          message: `Unknown pure check id: ${input.checkId}.`,
        },
      ],
    };
  }

  let content: string;

  try {
    content = await readFile(resultPath, 'utf8');
  } catch {
    return {
      ok: false,
      path: resultPath,
      failures: [
        {
          code: 'producer_result_missing',
          path: 'result.json',
          message: 'Pure check producer evidence result.json is missing.',
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      path: resultPath,
      failures: [
        {
          code: 'invalid_json',
          path: 'result.json',
          message: 'Pure check producer evidence result.json must be valid JSON.',
        },
      ],
    };
  }

  const validation = await validatePureCheckProducerEvidence(parsed, {
    repoRoot: input.repoRoot,
    reportRoot: input.reportRoot,
    expectedCheckId: input.checkId,
  });
  if (!validation.ok) {
    return {
      ok: false,
      path: resultPath,
      failures: validation.failures,
    };
  }

  return {
    ok: true,
    path: resultPath,
    digest: sha256(content),
    value: validation.value,
  };
}

export async function validatePureCheckProducerEvidence(
  value: unknown,
  input: PureCheckProducerEvidenceValidationInput,
): Promise<PureCheckProducerEvidenceValidationResult> {
  return validatePureCheckProducerEvidenceInternal(value, input);
}

async function validatePureCheckProducerEvidenceInternal(
  value: unknown,
  input: PureCheckProducerEvidenceInternalValidationInput,
): Promise<PureCheckProducerEvidenceValidationResult> {
  const failures: PureCheckProducerEvidenceValidationFailure[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      failures: [
        {
          code: 'invalid_type',
          path: 'record',
          message: 'Pure check producer evidence must be an object.',
        },
      ],
    };
  }

  validateAllowedKeys(value, TOP_LEVEL_KEY_SET, '', failures);
  validateNoSecretLookingStrings(value, failures);

  if (value.schema !== PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA) {
    pushFailure(
      failures,
      'invalid_schema',
      'schema',
      `schema must be ${PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA}.`,
    );
  }

  const checkId = validateRequiredString(value.check_id, 'check_id', failures);
  const identity = checkId ? findCurrentPureCheckIdentityById(checkId) : undefined;
  if (checkId && !identity) {
    pushFailure(failures, 'unknown_check_id', 'check_id', `Unknown pure check id: ${checkId}.`);
  }
  if (checkId && input.expectedCheckId && checkId !== input.expectedCheckId) {
    pushFailure(
      failures,
      'identity_mismatch',
      'check_id',
      `check_id must match expected pure check id ${input.expectedCheckId}.`,
    );
  }

  const reportRoot = validateRequiredString(value.report_root, 'report_root', failures);
  const evidenceDir = validateRequiredString(value.evidence_dir, 'evidence_dir', failures);
  if (reportRoot && !sameResolvedPath(reportRoot, input.reportRoot)) {
    pushFailure(failures, 'scope_leak', 'report_root', 'report_root must match the reader reportRoot.');
  }
  if (evidenceDir && checkId && !sameResolvedPath(evidenceDir, expectedEvidenceDir(input.reportRoot, checkId))) {
    pushFailure(
      failures,
      'scope_leak',
      'evidence_dir',
      'evidence_dir must resolve to <reportRoot>/pure-check-producer/<check_id>.',
    );
  }

  validateIdentityFields(value, identity, failures);
  validateStatusFields(value, failures);
  validateTimestamps(value, failures);
  validateSummaryDigest(value.stdout_summary_digest, 'stdout_summary_digest', failures);
  validateSummaryDigest(value.stderr_summary_digest, 'stderr_summary_digest', failures);

  if (Array.isArray(value.required_artifacts) && reportRoot && evidenceDir) {
    await validateRequiredArtifacts(
      value.required_artifacts,
      {
        repoRoot: input.repoRoot ?? process.cwd(),
        reportRoot: input.reportRoot,
        evidenceDir,
      },
      failures,
      Boolean(input.allowMissingSelfArtifact),
    );
  } else {
    pushFailure(failures, 'invalid_type', 'required_artifacts', 'required_artifacts must be a non-empty array.');
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: value as unknown as PureCheckProducerEvidenceRecord,
  };
}

function validateNoSecretLookingStrings(
  value: unknown,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  const leaks = findRedactionLeaks(value);
  if (leaks.length > 0) {
    pushFailure(
      failures,
      'secret_looking_string',
      'record',
      'Pure check producer evidence contains secret-looking string material.',
    );
  }
}

function validateIdentityFields(
  value: UnknownRecord,
  identity: ReturnType<typeof findCurrentPureCheckIdentityById>,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  validateRequiredString(value.owning_job_id, 'owning_job_id', failures);
  validateRequiredString(value.gate_id, 'gate_id', failures);
  validateRequiredString(value.command, 'command', failures);
  validateNullableString(value.npm_script, 'npm_script', failures);

  if (!identity) {
    return;
  }

  const expectedNpmScript = identity.npm_script ?? null;
  if (value.owning_job_id !== identity.owning_job_id) {
    pushFailure(failures, 'identity_mismatch', 'owning_job_id', 'owning_job_id must match the pure check identity.');
  }
  if (value.gate_id !== identity.owning_gate_id) {
    pushFailure(failures, 'identity_mismatch', 'gate_id', 'gate_id must match the pure check identity.');
  }
  if (value.command !== identity.command) {
    pushFailure(failures, 'identity_mismatch', 'command', 'command must match the pure check identity.');
  }
  if (value.npm_script !== expectedNpmScript) {
    pushFailure(failures, 'identity_mismatch', 'npm_script', 'npm_script must match the pure check identity.');
  }
}

function validateStatusFields(
  value: UnknownRecord,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  const resultStatus = value.result_status;
  const failureClass = value.failure_class;
  validateIntegerOrNull(value.exit_code, 'exit_code', failures);

  if (!isCurrentGateResultStatus(resultStatus)) {
    pushFailure(failures, 'invalid_status', 'result_status', 'result_status must be passed or failed.');
  }
  if (!isCurrentGateResultFailureClass(failureClass)) {
    pushFailure(failures, 'invalid_failure_class', 'failure_class', 'failure_class is not recognized.');
  }
  if (!isCurrentGateResultStatus(resultStatus) || !isCurrentGateResultFailureClass(failureClass)) {
    return;
  }
  if (resultStatus === 'passed' && failureClass !== 'none') {
    pushFailure(
      failures,
      'status_failure_class_mismatch',
      'failure_class',
      'passed results must use failure_class none.',
    );
  }
  if (resultStatus === 'failed' && failureClass === 'none') {
    pushFailure(
      failures,
      'status_failure_class_mismatch',
      'failure_class',
      'failed results must use a non-none failure_class.',
    );
  }
}

function validateTimestamps(
  value: UnknownRecord,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  const startedAt = parseTimestamp(value.started_at, 'started_at', failures);
  const finishedAt = parseTimestamp(value.finished_at, 'finished_at', failures);
  parseTimestamp(value.generated_at, 'generated_at', failures);
  const durationMs = validateNonNegativeInteger(value.duration_ms, 'duration_ms', failures);

  if (!startedAt || !finishedAt || typeof durationMs !== 'number') {
    return;
  }

  const expectedDurationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  if (expectedDurationMs < 0) {
    pushFailure(failures, 'invalid_timestamp', 'finished_at', 'finished_at must be at or after started_at.');
    return;
  }
  if (durationMs !== expectedDurationMs) {
    pushFailure(failures, 'duration_mismatch', 'duration_ms', 'duration_ms must match finished_at - started_at.');
  }
}

function validateSummaryDigest(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, 'invalid_type', path, 'Summary digest must be an object.');
    return;
  }

  validateAllowedKeys(value, SUMMARY_DIGEST_KEY_SET, path, failures);
  validateDigestOrNull(value.digest, `${path}.digest`, failures);
  validateNonNegativeInteger(value.summary_length, `${path}.summary_length`, failures);
  if (typeof value.redacted !== 'boolean') {
    pushFailure(failures, 'invalid_type', `${path}.redacted`, 'redacted must be a boolean.');
  }
}

async function validateRequiredArtifacts(
  artifacts: readonly unknown[],
  roots: PureCheckProducerArtifactRoots,
  failures: PureCheckProducerEvidenceValidationFailure[],
  allowMissingSelfArtifact: boolean,
): Promise<void> {
  if (artifacts.length === 0) {
    pushFailure(failures, 'invalid_type', 'required_artifacts', 'required_artifacts must be non-empty.');
    return;
  }

  const seenIds = new Set<string>();
  let hasSelfArtifact = false;

  for (const [index, artifact] of artifacts.entries()) {
    if (!isRecord(artifact)) {
      pushFailure(failures, 'invalid_type', `required_artifacts[${index}]`, 'Required artifact must be an object.');
      continue;
    }

    validateAllowedKeys(artifact, REQUIRED_ARTIFACT_KEY_SET, `required_artifacts[${index}]`, failures);
    const ref = validateRequiredArtifactShape(artifact, index, seenIds, failures);
    if (!ref) {
      continue;
    }

    const isSelfArtifact = ref.id === PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID
      && ref.scope === 'evidence_dir'
      && ref.path === PURE_CHECK_PRODUCER_RESULT_FILE_NAME
      && ref.kind === 'file';
    hasSelfArtifact = hasSelfArtifact || isSelfArtifact;

    await validateRequiredArtifactFile(ref, roots, failures, index, allowMissingSelfArtifact && isSelfArtifact);
  }

  if (!hasSelfArtifact) {
    pushFailure(
      failures,
      'producer_result_artifact_missing',
      'required_artifacts',
      'required_artifacts must include the current producer result.json artifact.',
    );
  }
}

function validateRequiredArtifactShape(
  artifact: UnknownRecord,
  index: number,
  seenIds: Set<string>,
  failures: PureCheckProducerEvidenceValidationFailure[],
): PureCheckProducerRequiredArtifactRef | null {
  const id = validateRequiredString(artifact.id, `required_artifacts[${index}].id`, failures);
  const scope = validateRequiredString(artifact.scope, `required_artifacts[${index}].scope`, failures);
  const path = validateRequiredString(artifact.path, `required_artifacts[${index}].path`, failures);
  const kind = validateRequiredString(artifact.kind, `required_artifacts[${index}].kind`, failures);
  validateDigestOrNull(artifact.digest, `required_artifacts[${index}].digest`, failures);
  validateIntegerOrNull(artifact.size_bytes, `required_artifacts[${index}].size_bytes`, failures);

  if (id && !STABLE_ID_PATTERN.test(id)) {
    pushFailure(failures, 'invalid_artifact_id', `required_artifacts[${index}].id`, 'Artifact id must be stable kebab-case.');
  }
  if (id && seenIds.has(id)) {
    pushFailure(failures, 'duplicate_artifact_id', `required_artifacts[${index}].id`, `Duplicate artifact id: ${id}.`);
  }
  if (id) {
    seenIds.add(id);
  }
  if (scope && !ARTIFACT_SCOPE_SET.has(scope)) {
    pushFailure(failures, 'scope_leak', `required_artifacts[${index}].scope`, 'Required artifact scope is not allowed.');
  }
  if (kind && !ARTIFACT_KIND_SET.has(kind)) {
    pushFailure(failures, 'invalid_type', `required_artifacts[${index}].kind`, 'Required artifact kind must be file.');
  }

  if (
    !id
    || !scope
    || !path
    || !kind
    || !ARTIFACT_SCOPE_SET.has(scope)
    || !ARTIFACT_KIND_SET.has(kind)
    || (artifact.digest !== null && !digestIsValid(artifact.digest))
    || (artifact.size_bytes !== null && (typeof artifact.size_bytes !== 'number' || !Number.isInteger(artifact.size_bytes)))
  ) {
    return null;
  }

  return {
    id,
    scope: scope as PureCheckProducerArtifactScope,
    path,
    kind: kind as PureCheckProducerArtifactKind,
    digest: artifact.digest,
    size_bytes: artifact.size_bytes,
  };
}

async function validateRequiredArtifactFile(
  artifact: PureCheckProducerRequiredArtifactRef,
  roots: PureCheckProducerArtifactRoots,
  failures: PureCheckProducerEvidenceValidationFailure[],
  index: number,
  allowMissing: boolean,
): Promise<void> {
  const artifactPath = resolveArtifactPath(artifact, roots);
  if (!artifactPath) {
    pushFailure(
      failures,
      'scope_leak',
      `required_artifacts[${index}].path`,
      'Required artifact path must stay within its declared scope.',
    );
    return;
  }

  let artifactContent: Buffer;
  let artifactSize: number;
  try {
    const artifactStat = await stat(artifactPath);
    if (!artifactStat.isFile()) {
      if (!allowMissing) {
        pushFailure(
          failures,
          'required_artifact_missing',
          `required_artifacts[${index}].path`,
          'Required artifact must be an existing file.',
        );
      }
      return;
    }
    artifactContent = await readFile(artifactPath);
    artifactSize = artifactStat.size;
  } catch {
    if (!allowMissing) {
      pushFailure(
        failures,
        'required_artifact_missing',
        `required_artifacts[${index}].path`,
        'Required artifact must be an existing file.',
      );
    }
    return;
  }

  if (artifact.digest !== null && artifact.digest !== sha256(artifactContent)) {
    pushFailure(
      failures,
      'required_artifact_digest_mismatch',
      `required_artifacts[${index}].digest`,
      'Required artifact digest does not match file content.',
    );
  }
  if (artifact.size_bytes !== null && artifact.size_bytes !== artifactSize) {
    pushFailure(
      failures,
      'required_artifact_size_mismatch',
      `required_artifacts[${index}].size_bytes`,
      'Required artifact size does not match file size.',
    );
  }
}
