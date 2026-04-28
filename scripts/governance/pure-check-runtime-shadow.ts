import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  validateCurrentEvidenceClaim,
  type CurrentEvidenceClaimRecord,
  type CurrentEvidenceClaimScope,
  type CurrentEvidenceClaimValidationFailure,
  type CurrentEvidenceClaimValidationPurpose,
} from './current-evidence-claim-schema';
import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import { findCurrentJobMetadataById } from './current-job-metadata-manifest';
import {
  CURRENT_PURE_CHECK_IDENTITY_MANIFEST,
  type CurrentPureCheckId,
  type CurrentPureCheckIdentity,
  type CurrentPureCheckInputDigestRule,
} from './current-pure-check-identity-manifest';
import {
  PURE_CHECK_PRODUCER_EVIDENCE_DIR_NAME,
  PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
  PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
  PURE_CHECK_PRODUCER_RESULT_FILE_NAME,
  TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS,
  type PureCheckProducerArtifactScope,
  type PureCheckProducerEvidenceRecord,
  type PureCheckProducerEvidenceValidationFailure,
  type PureCheckProducerRequiredArtifactRef,
} from './pure-check-producer-evidence';

export const PURE_CHECK_RUNTIME_SHADOW_SCHEMA = 'pure-check-runtime-shadow.v1' as const;
export const EVIDENCE_CLAIMS_JSONL_NAME = 'evidence-claims.jsonl' as const;
export const STABLE_PURE_CHECK_CLAIMS_JSONL_PATH = 'artifacts/governance-claim-store/pure-checks.jsonl' as const;

export type PureCheckRuntimeShadowClaimScope =
  Extract<CurrentEvidenceClaimScope, 'debug' | 'pr'>;

export interface PureCheckRuntimeShadowReason {
  code: string;
  path?: string;
  path_glob?: string;
  artifact_ref_id?: string;
  toolchain_input?: string;
  message: string;
}

export interface PureCheckInputDigestAuditFile {
  path: string;
  size_bytes: number;
  sha256: string;
}

export interface PureCheckInputDigestAuditToolchain {
  name: string;
  value_digest: string | null;
}

export interface PureCheckInputDigestAudit {
  schema: typeof PURE_CHECK_RUNTIME_SHADOW_SCHEMA;
  check_id: string;
  input_digest_rule_id: string;
  git_sha: string;
  path_globs: readonly string[];
  matched_files: readonly PureCheckInputDigestAuditFile[];
  toolchain_inputs: readonly PureCheckInputDigestAuditToolchain[];
  reasons: readonly PureCheckRuntimeShadowReason[];
}

export interface PureCheckInputDigestResult {
  input_digest: string;
  audit: PureCheckInputDigestAudit;
}

export interface PureCheckInputDigestInput {
  repoRoot: string;
  identity: CurrentPureCheckIdentity;
  inputDigestRule: CurrentPureCheckInputDigestRule;
  gitSha: string;
  toolchainIdentity: Readonly<Record<string, string | null | undefined>>;
}

export type PureCheckArtifactRefKind = 'file' | 'directory';

export interface PureCheckArtifactRef {
  id: string;
  path: string;
  kind?: PureCheckArtifactRefKind;
  required?: boolean;
}

export interface PureCheckArtifactDigestAuditFile {
  artifact_ref_id: string;
  path: string;
  size_bytes: number;
  sha256: string;
}

export interface PureCheckArtifactDigestAudit {
  schema: typeof PURE_CHECK_RUNTIME_SHADOW_SCHEMA;
  command_digest: string;
  required_artifacts_complete: boolean;
  artifacts: readonly PureCheckArtifactDigestAuditFile[];
  reasons: readonly PureCheckRuntimeShadowReason[];
}

export interface PureCheckArtifactDigestResult {
  artifact_digest: string;
  audit: PureCheckArtifactDigestAudit;
}

export interface PureCheckArtifactDigestInput {
  repoRoot: string;
  command: string;
  artifactRefs: readonly PureCheckArtifactRef[];
}

export interface PureCheckResultDigestInput {
  command: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  exitCode: number | null;
  stdoutSummary?: string | null;
  stderrSummary?: string | null;
}

export interface PureCheckResultDigestRedaction {
  field: 'command' | 'stdout_summary' | 'stderr_summary';
  reason: 'secret_like_value_redacted';
}

export interface PureCheckResultDigestAudit {
  schema: typeof PURE_CHECK_RUNTIME_SHADOW_SCHEMA;
  command_digest: string;
  stdout_summary_digest: string | null;
  stderr_summary_digest: string | null;
  redactions: readonly PureCheckResultDigestRedaction[];
}

export interface PureCheckResultDigestResult {
  result_digest: string;
  audit: PureCheckResultDigestAudit;
}

export interface EvidenceClaimJsonlReadInput {
  runRoot: string;
  validationPurpose?: CurrentEvidenceClaimValidationPurpose;
}

export interface EvidenceClaimJsonlWriteInput extends EvidenceClaimJsonlReadInput {
  claim: CurrentEvidenceClaimRecord;
}

export interface StablePureCheckClaimJsonlReadInput {
  repoRoot: string;
  validationPurpose?: CurrentEvidenceClaimValidationPurpose;
}

export interface StablePureCheckClaimJsonlWriteInput extends StablePureCheckClaimJsonlReadInput {
  claim: CurrentEvidenceClaimRecord;
}

export interface EvidenceClaimJsonlValidationFailure {
  line: number;
  code: string;
  message: string;
  path?: string;
  validation_failures?: readonly CurrentEvidenceClaimValidationFailure[];
}

export type EvidenceClaimJsonlReadResult =
  | {
      ok: true;
      claims: readonly CurrentEvidenceClaimRecord[];
    }
  | {
      ok: false;
      failures: readonly EvidenceClaimJsonlValidationFailure[];
    };

export type EvidenceClaimJsonlWriteResult =
  | {
      ok: true;
      path: string;
      claim_digest: string;
    }
  | {
      ok: false;
      path: string;
      failures: readonly EvidenceClaimJsonlValidationFailure[];
    };

export interface BuildPureCheckRuntimeShadowClaimInput {
  identity: CurrentPureCheckIdentity;
  scope?: PureCheckRuntimeShadowClaimScope;
  evidenceDir: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  inputDigest: string;
  artifactDigest: string;
  artifactAudit?: PureCheckArtifactDigestAudit;
  resultDigest: string;
  gitSha: string;
  generatedAt: string;
  producerOrigin: string;
  subject?: string;
  secretProfileDigest?: string | null;
}

export type BuildPureCheckRuntimeShadowClaimResult =
  | {
      ok: true;
      value: CurrentEvidenceClaimRecord;
    }
  | {
      ok: false;
      failures: readonly CurrentEvidenceClaimValidationFailure[];
    };

export interface PureCheckRuntimeShadowVerifyEvaluation {
  check_id: CurrentPureCheckId;
  decision: 'reuse_allowed' | 'shadow_only' | 'rerun_required';
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  script_results: readonly PureCheckVerifyScriptAuditResult[];
  reason_codes: readonly string[];
  claim_store_read: boolean;
  claim_store_write: boolean;
  claim_count: number;
  valid_count: number;
  invalid_count: number;
  audit_digests: {
    input: string;
    artifact: string;
    result: string;
    claim?: string;
  };
}

export interface PureCheckRuntimeShadowVerifyRunResult {
  evaluations: readonly PureCheckRuntimeShadowVerifyEvaluation[];
  run_claim_store_path: string;
  stable_claim_store_path: string;
}

export interface PureCheckVerifyScriptExecution {
  script: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  exitCode: number | null;
  stdoutSummary?: string | null;
  stderrSummary?: string | null;
}

export interface PureCheckVerifyScriptAuditResult {
  script: string;
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
}

export interface EvaluatePureCheckRuntimeShadowForVerifyRunSyncInput {
  repoRoot: string;
  reportRoot: string;
  executedScripts: readonly string[];
  scriptExecutions?: readonly PureCheckVerifyScriptExecution[];
  generatedAt: string;
  gitSha: string;
  toolchainIdentity?: Readonly<Record<string, string | null | undefined>>;
  scope?: PureCheckRuntimeShadowClaimScope;
}

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

interface NormalizedRootPath {
  absolute: string;
}

interface MatchedFile {
  path: string;
  absolute_path: string;
}

interface PureCheckProducerEvidenceRuntimeReadSuccess {
  ok: true;
  path: string;
  digest: string;
  value: PureCheckProducerEvidenceRecord;
}

interface PureCheckProducerEvidenceRuntimeReadFailure {
  ok: false;
  path: string;
  failures: readonly PureCheckProducerEvidenceValidationFailure[];
}

type PureCheckProducerEvidenceRuntimeReadResult =
  | PureCheckProducerEvidenceRuntimeReadSuccess
  | PureCheckProducerEvidenceRuntimeReadFailure;

const SECRET_REDACTION_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(api_key\s*=\s*)[^\s]+/gi,
  /\b(access_token\s*=\s*)[^\s]+/gi,
  /\b(refresh_token\s*=\s*)[^\s]+/gi,
  /\b(oauth_token\s*=\s*)[^\s]+/gi,
  /\b(client_secret\s*=\s*)[^\s]+/gi,
  /\b(password\s*=\s*)[^\s]+/gi,
  /\b(ticket\s*=\s*)[^\s]+/gi,
  /managed_credentials\.[A-Za-z0-9_.-]+/gi,
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/gi,
] as const;

const VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS = [
  'contracts',
  'openapi-contract',
  'openapi-generated',
  'lint',
  'typecheck',
] as const satisfies readonly CurrentPureCheckId[];

const PURE_CHECK_IDS_BY_VERIFY_SCRIPT = new Map<string, readonly CurrentPureCheckId[]>([
  ['verify:quick', VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS],
  ['verify:default', VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS],
]);

const INPUT_DIGEST_INCOMPLETE_REASON_CODES = new Set([
  'input_digest_rule_mismatch',
  'toolchain_input_missing',
]);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PRODUCER_REQUIRED_ARTIFACT_SCOPES = new Set<PureCheckProducerArtifactScope>([
  'repo_root',
  'report_root',
  'evidence_dir',
]);
const PRODUCER_TOP_LEVEL_KEYS = new Set([
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
]);
const PRODUCER_SUMMARY_DIGEST_KEYS = new Set(['digest', 'summary_length', 'redacted']);
const PRODUCER_REQUIRED_ARTIFACT_KEYS = new Set(['id', 'scope', 'path', 'kind', 'digest', 'size_bytes']);
const CURRENT_GATE_RESULT_STATUS_SET = new Set<string>(CURRENT_GATE_RESULT_STATUSES);
const CURRENT_GATE_RESULT_FAILURE_CLASS_SET = new Set<string>(CURRENT_GATE_RESULT_FAILURE_CLASSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Cannot stable stringify value of type ${typeof value}.`);
}

function digestJson(value: JsonValue): string {
  return sha256(stableStringify(value));
}

function normalizeRoot(root: string): NormalizedRootPath {
  return {
    absolute: resolve(root),
  };
}

function normalizeSlashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function normalizeRelativePath(value: string): string {
  const normalized = posix.normalize(normalizeSlashPath(value)).replace(/^\.\//, '');
  if (normalized === '.') {
    return '';
  }
  return normalized.replace(/\/+$/, '');
}

function toRelativeInsideRoot(root: NormalizedRootPath, absolutePath: string): string | null {
  const relativePath = normalizeSlashPath(relative(root.absolute, absolutePath));
  if (
    relativePath.length === 0
    || relativePath === '..'
    || relativePath.startsWith('../')
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    return null;
  }
  return normalizeRelativePath(relativePath);
}

function resolveInsideRoot(root: NormalizedRootPath, candidatePath: string): {
  absolute_path: string;
  relative_path: string | null;
} {
  const absolutePath = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root.absolute, candidatePath);
  const relativePath = toRelativeInsideRoot(root, absolutePath);
  return {
    absolute_path: absolutePath,
    relative_path: relativePath,
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => normalizeRelativePath(value)))]
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function reason(args: {
  code: string;
  message: string;
  path?: string;
  path_glob?: string;
  artifact_ref_id?: string;
  toolchain_input?: string;
}): PureCheckRuntimeShadowReason {
  return args;
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  const normalizedGlob = normalizeRelativePath(glob);

  for (let index = 0; index < normalizedGlob.length; index += 1) {
    const char = normalizedGlob[index];
    const nextChar = normalizedGlob[index + 1];

    if (char === '*') {
      if (nextChar === '*') {
        const charAfterGlobstar = normalizedGlob[index + 2];
        if (charAfterGlobstar === '/') {
          pattern += '(?:.*/)?';
          index += 2;
        } else {
          pattern += '.*';
          index += 1;
        }
        continue;
      }
      pattern += '[^/]*';
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      continue;
    }

    pattern += escapeRegexLiteral(char ?? '');
  }

  pattern += '$';
  return new RegExp(pattern);
}

function globStaticPrefix(glob: string): string {
  const normalizedGlob = normalizeRelativePath(glob);
  const wildcardIndex = normalizedGlob.search(/[*?]/);
  if (wildcardIndex === -1) {
    return normalizedGlob;
  }

  const prefixBeforeWildcard = normalizedGlob.slice(0, wildcardIndex);
  const slashIndex = prefixBeforeWildcard.lastIndexOf('/');
  if (slashIndex === -1) {
    return '';
  }
  return prefixBeforeWildcard.slice(0, slashIndex);
}

async function statIfExists(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function walkFiles(root: NormalizedRootPath, relativeStart: string): Promise<readonly MatchedFile[]> {
  const startPath = relativeStart.length > 0
    ? resolveInsideRoot(root, relativeStart)
    : { absolute_path: root.absolute, relative_path: '' };
  if (startPath.relative_path === null) {
    return [];
  }

  const startStat = await statIfExists(startPath.absolute_path);
  if (!startStat) {
    return [];
  }
  if (startStat.isFile()) {
    return [{
      path: startPath.relative_path,
      absolute_path: startPath.absolute_path,
    }];
  }
  if (!startStat.isDirectory()) {
    return [];
  }

  const files: MatchedFile[] = [];
  const entries = await readdir(startPath.absolute_path, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    const absolutePath = join(startPath.absolute_path, entry.name);
    const relativePath = toRelativeInsideRoot(root, absolutePath);
    if (relativePath === null) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push({
        path: relativePath,
        absolute_path: absolutePath,
      });
    }
  }

  return files;
}

async function matchGlob(root: NormalizedRootPath, pathGlob: string): Promise<{
  files: readonly MatchedFile[];
  directory_paths: readonly string[];
}> {
  const normalizedGlob = normalizeRelativePath(pathGlob);
  const hasWildcard = /[*?]/.test(normalizedGlob);
  const regex = globToRegExp(normalizedGlob);
  const staticPrefix = globStaticPrefix(normalizedGlob);
  const prefixResolution = resolveInsideRoot(root, staticPrefix);

  if (prefixResolution.relative_path === null) {
    return {
      files: [],
      directory_paths: [],
    };
  }

  if (!hasWildcard) {
    const exact = resolveInsideRoot(root, normalizedGlob);
    if (exact.relative_path === null) {
      return {
        files: [],
        directory_paths: [],
      };
    }
    const exactStat = await statIfExists(exact.absolute_path);
    if (!exactStat) {
      return {
        files: [],
        directory_paths: [],
      };
    }
    if (exactStat.isFile()) {
      return {
        files: [{
          path: exact.relative_path,
          absolute_path: exact.absolute_path,
        }],
        directory_paths: [],
      };
    }
    if (exactStat.isDirectory()) {
      return {
        files: [],
        directory_paths: [exact.relative_path],
      };
    }
    return {
      files: [],
      directory_paths: [],
    };
  }

  const files = (await walkFiles(root, prefixResolution.relative_path))
    .filter((file) => regex.test(file.path));

  return {
    files,
    directory_paths: [],
  };
}

function redactedValue(value: string): {
  value: string;
  redacted: boolean;
} {
  let redacted = false;
  let nextValue = value;

  for (const pattern of SECRET_REDACTION_PATTERNS) {
    nextValue = nextValue.replace(pattern, (match: string, prefix: string | undefined) => {
      redacted = true;
      if (prefix && match.startsWith(prefix)) {
        return `${prefix}<redacted>`;
      }
      if (/^Bearer\s+/i.test(match)) {
        return 'Bearer <redacted>';
      }
      if (/^managed_credentials\./i.test(match)) {
        return 'managed_credentials.<redacted>';
      }
      if (match.includes('sk-')) {
        return match.replace(/sk-[A-Za-z0-9_-]+/i, 'sk-<redacted>');
      }
      return '<redacted>';
    });
  }

  return {
    value: nextValue,
    redacted,
  };
}

function summarizeForDigest(
  field: PureCheckResultDigestRedaction['field'],
  value: string | null | undefined,
): {
  sanitized: string | null;
  digest: string | null;
  redaction: PureCheckResultDigestRedaction | null;
} {
  if (value === null || value === undefined) {
    return {
      sanitized: null,
      digest: null,
      redaction: null,
    };
  }
  const redacted = redactedValue(value);
  return {
    sanitized: redacted.value,
    digest: sha256(redacted.value),
    redaction: redacted.redacted
      ? {
          field,
          reason: 'secret_like_value_redacted',
        }
      : null,
  };
}

async function fileAuditEntry(path: string, absolutePath: string): Promise<PureCheckInputDigestAuditFile> {
  const content = await readFile(absolutePath);
  return {
    path,
    size_bytes: content.byteLength,
    sha256: sha256(content),
  };
}

async function artifactAuditEntry(
  artifactRefId: string,
  path: string,
  absolutePath: string,
): Promise<PureCheckArtifactDigestAuditFile> {
  const content = await readFile(absolutePath);
  return {
    artifact_ref_id: artifactRefId,
    path,
    size_bytes: content.byteLength,
    sha256: sha256(content),
  };
}

export async function computePureCheckInputDigest(
  input: PureCheckInputDigestInput,
): Promise<PureCheckInputDigestResult> {
  const root = normalizeRoot(input.repoRoot);
  const reasons: PureCheckRuntimeShadowReason[] = [];
  const filesByPath = new Map<string, MatchedFile>();
  const normalizedPathGlobs = uniqueSorted(input.identity.path_globs);

  if (input.identity.input_digest_rule_id !== input.inputDigestRule.id) {
    reasons.push(reason({
      code: 'input_digest_rule_mismatch',
      message: 'Pure check identity input_digest_rule_id does not match the supplied digest rule.',
    }));
  }

  for (const pathGlob of normalizedPathGlobs) {
    const match = await matchGlob(root, pathGlob);
    for (const directoryPath of match.directory_paths) {
      reasons.push(reason({
        code: 'directory_ignored',
        path: directoryPath,
        path_glob: pathGlob,
        message: 'Directory matched a pure check path glob and was ignored; only file content is digested.',
      }));
    }
    if (match.files.length === 0 && match.directory_paths.length === 0) {
      reasons.push(reason({
        code: 'path_glob_missing',
        path_glob: pathGlob,
        message: 'Pure check path glob did not match any files.',
      }));
    }
    for (const file of match.files) {
      filesByPath.set(file.path, file);
    }
  }

  const matchedFiles = await Promise.all(
    [...filesByPath.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => fileAuditEntry(file.path, file.absolute_path)),
  );

  const toolchainInputs = [...new Set(input.inputDigestRule.toolchain_inputs)]
    .sort((left, right) => left.localeCompare(right))
    .map((name): PureCheckInputDigestAuditToolchain => {
      const value = input.toolchainIdentity[name];
      if (typeof value !== 'string' || value.length === 0) {
        reasons.push(reason({
          code: 'toolchain_input_missing',
          toolchain_input: name,
          message: 'Declared pure check toolchain input did not have a supplied identity value.',
        }));
        return {
          name,
          value_digest: null,
        };
      }
      return {
        name,
        value_digest: sha256(value),
      };
    });

  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    check_id: input.identity.check_id,
    git_sha: input.gitSha,
    input_digest_rule: {
      id: input.inputDigestRule.id,
      material_policy: input.inputDigestRule.material_policy,
      toolchain_inputs: toolchainInputs.map((entry) => ({
        name: entry.name,
        value_digest: entry.value_digest,
      })),
    },
    path_globs: normalizedPathGlobs,
    files: matchedFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
    })),
    audit_reason_codes: reasons.map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
  };

  return {
    input_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      check_id: input.identity.check_id,
      input_digest_rule_id: input.inputDigestRule.id,
      git_sha: input.gitSha,
      path_globs: normalizedPathGlobs,
      matched_files: matchedFiles,
      toolchain_inputs: toolchainInputs,
      reasons,
    },
  };
}

async function artifactFilesForRef(
  root: NormalizedRootPath,
  artifactRef: PureCheckArtifactRef,
  reasons: PureCheckRuntimeShadowReason[],
): Promise<readonly PureCheckArtifactDigestAuditFile[]> {
  const normalizedPath = normalizeRelativePath(artifactRef.path);
  const required = artifactRef.required === true;
  const resolvedRef = resolveInsideRoot(root, normalizedPath);
  if (resolvedRef.relative_path === null) {
    reasons.push(reason({
      code: required ? 'required_artifact_path_outside_root' : 'artifact_path_outside_root',
      artifact_ref_id: artifactRef.id,
      path: normalizedPath,
      message: 'Artifact reference path resolves outside the supplied root and was not read.',
    }));
    return [];
  }

  const refStat = await statIfExists(resolvedRef.absolute_path);
  if (!refStat) {
    reasons.push(reason({
      code: required ? 'required_artifact_missing' : 'artifact_missing',
      artifact_ref_id: artifactRef.id,
      path: normalizedPath,
      message: 'Artifact reference path does not exist.',
    }));
    return [];
  }

  if (artifactRef.kind === 'file' && !refStat.isFile()) {
    reasons.push(reason({
      code: required ? 'required_artifact_kind_mismatch' : 'artifact_kind_mismatch',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference expected a file but did not resolve to a file.',
    }));
    return [];
  }

  if (artifactRef.kind === 'directory' && !refStat.isDirectory()) {
    reasons.push(reason({
      code: required ? 'required_artifact_kind_mismatch' : 'artifact_kind_mismatch',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference expected a directory but did not resolve to a directory.',
    }));
    return [];
  }

  if (refStat.isFile()) {
    return [await artifactAuditEntry(
      artifactRef.id,
      resolvedRef.relative_path,
      resolvedRef.absolute_path,
    )];
  }

  if (!refStat.isDirectory()) {
    reasons.push(reason({
      code: required ? 'required_artifact_not_file_or_directory' : 'artifact_not_file_or_directory',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference is neither a regular file nor a directory.',
    }));
    return [];
  }

  const walkedFiles = await walkFiles(root, resolvedRef.relative_path);
  if (walkedFiles.length === 0) {
    reasons.push(reason({
      code: required ? 'required_artifact_directory_empty' : 'artifact_directory_empty',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact directory exists but does not contain files.',
    }));
    return [];
  }

  return Promise.all(
    walkedFiles
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => artifactAuditEntry(artifactRef.id, file.path, file.absolute_path)),
  );
}

export async function computePureCheckArtifactDigest(
  input: PureCheckArtifactDigestInput,
): Promise<PureCheckArtifactDigestResult> {
  const root = normalizeRoot(input.repoRoot);
  const reasons: PureCheckRuntimeShadowReason[] = [];
  const command = summarizeForDigest('command', input.command);
  const artifactsByKey = new Map<string, PureCheckArtifactDigestAuditFile>();
  const refs = [...input.artifactRefs].sort((left, right) => {
    const idComparison = left.id.localeCompare(right.id);
    return idComparison === 0
      ? normalizeRelativePath(left.path).localeCompare(normalizeRelativePath(right.path))
      : idComparison;
  });

  if (command.redaction) {
    reasons.push(reason({
      code: 'command_secret_like_value_redacted',
      message: 'Command contained a secret-looking value and was redacted before digesting.',
    }));
  }

  for (const artifactRef of refs) {
    const files = await artifactFilesForRef(root, artifactRef, reasons);
    for (const file of files) {
      artifactsByKey.set(`${file.artifact_ref_id}:${file.path}`, file);
    }
  }

  const artifacts = [...artifactsByKey.values()]
    .sort((left, right) => {
      const refComparison = left.artifact_ref_id.localeCompare(right.artifact_ref_id);
      return refComparison === 0 ? left.path.localeCompare(right.path) : refComparison;
    });
  const requiredArtifactsComplete = !reasons.some((entry) => entry.code.startsWith('required_artifact_'));

  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    command_digest: command.digest,
    required_artifacts_complete: requiredArtifactsComplete,
    artifacts: artifacts.map((artifact) => ({
      artifact_ref_id: artifact.artifact_ref_id,
      path: artifact.path,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
    })),
    audit_reason_codes: reasons.map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
  };

  return {
    artifact_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      command_digest: command.digest ?? sha256(''),
      required_artifacts_complete: requiredArtifactsComplete,
      artifacts,
      reasons,
    },
  };
}

export function computePureCheckResultDigest(
  input: PureCheckResultDigestInput,
): PureCheckResultDigestResult {
  const command = summarizeForDigest('command', input.command);
  const stdoutSummary = summarizeForDigest('stdout_summary', input.stdoutSummary);
  const stderrSummary = summarizeForDigest('stderr_summary', input.stderrSummary);
  const redactions = [command.redaction, stdoutSummary.redaction, stderrSummary.redaction]
    .filter((entry): entry is PureCheckResultDigestRedaction => entry !== null);
  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    command: command.sanitized,
    result_status: input.resultStatus,
    failure_class: input.failureClass,
    exit_code: input.exitCode,
    stdout_summary: stdoutSummary.sanitized,
    stderr_summary: stderrSummary.sanitized,
  };

  return {
    result_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      command_digest: command.digest ?? sha256(''),
      stdout_summary_digest: stdoutSummary.digest,
      stderr_summary_digest: stderrSummary.digest,
      redactions,
    },
  };
}

export function computeEvidenceClaimDigest(claim: CurrentEvidenceClaimRecord): string {
  return digestJson({
    schema: 'current-evidence-claim-record-digest.v1',
    claim: claim as unknown as JsonValue,
  });
}

function evidenceClaimsJsonlPath(runRoot: string): string {
  return join(runRoot, EVIDENCE_CLAIMS_JSONL_NAME);
}

function stablePureCheckClaimsJsonlPath(repoRoot: string): string {
  return join(repoRoot, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH);
}

function validationPurposeOrRecord(
  purpose: CurrentEvidenceClaimValidationPurpose | undefined,
): CurrentEvidenceClaimValidationPurpose {
  return purpose ?? 'record';
}

async function readEvidenceClaimJsonlPath(
  path: string,
  validationPurpose: CurrentEvidenceClaimValidationPurpose | undefined,
): Promise<EvidenceClaimJsonlReadResult> {
  let content: string;

  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: true,
        claims: [],
      };
    }
    throw error;
  }

  const claims: CurrentEvidenceClaimRecord[] = [];
  const failures: EvidenceClaimJsonlValidationFailure[] = [];
  const lines = content.split(/\r?\n/);
  const purpose = validationPurposeOrRecord(validationPurpose);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNumber = index + 1;
    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      failures.push({
        line: lineNumber,
        code: 'invalid_json',
        message: 'Evidence claim JSONL line is not valid JSON.',
        path,
      });
      return;
    }

    const validation = validateCurrentEvidenceClaim(parsed, { purpose });
    if (!validation.ok) {
      failures.push({
        line: lineNumber,
        code: 'claim_validation_failed',
        message: 'Evidence claim JSONL line failed current evidence claim schema validation.',
        path,
        validation_failures: validation.failures,
      });
      return;
    }

    claims.push(validation.value);
  });

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    claims,
  };
}

async function appendEvidenceClaimJsonlPath(args: {
  path: string;
  claim: CurrentEvidenceClaimRecord;
  validationPurpose?: CurrentEvidenceClaimValidationPurpose;
}): Promise<EvidenceClaimJsonlWriteResult> {
  const purpose = validationPurposeOrRecord(args.validationPurpose);
  const validation = validateCurrentEvidenceClaim(args.claim, { purpose });

  if (!validation.ok) {
    return {
      ok: false,
      path: args.path,
      failures: [{
        line: 0,
        code: 'claim_validation_failed',
        message: 'Evidence claim was not written because it failed current evidence claim schema validation.',
        path: args.path,
        validation_failures: validation.failures,
      }],
    };
  }

  await mkdir(dirname(args.path), { recursive: true });
  await appendFile(args.path, `${stableStringify(validation.value)}\n`, 'utf8');

  return {
    ok: true,
    path: args.path,
    claim_digest: computeEvidenceClaimDigest(validation.value),
  };
}

export async function readEvidenceClaimJsonlStore(
  input: EvidenceClaimJsonlReadInput,
): Promise<EvidenceClaimJsonlReadResult> {
  return readEvidenceClaimJsonlPath(evidenceClaimsJsonlPath(input.runRoot), input.validationPurpose);
}

export async function appendEvidenceClaimJsonl(
  input: EvidenceClaimJsonlWriteInput,
): Promise<EvidenceClaimJsonlWriteResult> {
  return appendEvidenceClaimJsonlPath({
    path: evidenceClaimsJsonlPath(input.runRoot),
    claim: input.claim,
    validationPurpose: input.validationPurpose,
  });
}

export async function readStablePureCheckClaimJsonlStore(
  input: StablePureCheckClaimJsonlReadInput,
): Promise<EvidenceClaimJsonlReadResult> {
  return readEvidenceClaimJsonlPath(stablePureCheckClaimsJsonlPath(input.repoRoot), input.validationPurpose);
}

export async function appendStablePureCheckClaimJsonl(
  input: StablePureCheckClaimJsonlWriteInput,
): Promise<EvidenceClaimJsonlWriteResult> {
  return appendEvidenceClaimJsonlPath({
    path: stablePureCheckClaimsJsonlPath(input.repoRoot),
    claim: input.claim,
    validationPurpose: input.validationPurpose,
  });
}

function statIfExistsSyncSafe(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function walkFilesSync(root: NormalizedRootPath, relativeStart: string): readonly MatchedFile[] {
  const startPath = relativeStart.length > 0
    ? resolveInsideRoot(root, relativeStart)
    : { absolute_path: root.absolute, relative_path: '' };
  if (startPath.relative_path === null) {
    return [];
  }

  const startStat = statIfExistsSyncSafe(startPath.absolute_path);
  if (!startStat) {
    return [];
  }
  if (startStat.isFile()) {
    return [{
      path: startPath.relative_path,
      absolute_path: startPath.absolute_path,
    }];
  }
  if (!startStat.isDirectory()) {
    return [];
  }

  const files: MatchedFile[] = [];
  const entries = readdirSync(startPath.absolute_path, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    const absolutePath = join(startPath.absolute_path, entry.name);
    const relativePath = toRelativeInsideRoot(root, absolutePath);
    if (relativePath === null) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFilesSync(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push({
        path: relativePath,
        absolute_path: absolutePath,
      });
    }
  }

  return files;
}

function matchGlobSync(root: NormalizedRootPath, pathGlob: string): {
  files: readonly MatchedFile[];
  directory_paths: readonly string[];
} {
  const normalizedGlob = normalizeRelativePath(pathGlob);
  const hasWildcard = /[*?]/.test(normalizedGlob);
  const regex = globToRegExp(normalizedGlob);
  const staticPrefix = globStaticPrefix(normalizedGlob);
  const prefixResolution = resolveInsideRoot(root, staticPrefix);

  if (prefixResolution.relative_path === null) {
    return {
      files: [],
      directory_paths: [],
    };
  }

  if (!hasWildcard) {
    const exact = resolveInsideRoot(root, normalizedGlob);
    if (exact.relative_path === null) {
      return {
        files: [],
        directory_paths: [],
      };
    }
    const exactStat = statIfExistsSyncSafe(exact.absolute_path);
    if (!exactStat) {
      return {
        files: [],
        directory_paths: [],
      };
    }
    if (exactStat.isFile()) {
      return {
        files: [{
          path: exact.relative_path,
          absolute_path: exact.absolute_path,
        }],
        directory_paths: [],
      };
    }
    if (exactStat.isDirectory()) {
      return {
        files: [],
        directory_paths: [exact.relative_path],
      };
    }
    return {
      files: [],
      directory_paths: [],
    };
  }

  const files = walkFilesSync(root, prefixResolution.relative_path)
    .filter((file) => regex.test(file.path));

  return {
    files,
    directory_paths: [],
  };
}

function fileAuditEntrySync(path: string, absolutePath: string): PureCheckInputDigestAuditFile {
  const content = readFileSync(absolutePath);
  return {
    path,
    size_bytes: content.byteLength,
    sha256: sha256(content),
  };
}

function artifactAuditEntrySync(
  artifactRefId: string,
  path: string,
  absolutePath: string,
): PureCheckArtifactDigestAuditFile {
  const content = readFileSync(absolutePath);
  return {
    artifact_ref_id: artifactRefId,
    path,
    size_bytes: content.byteLength,
    sha256: sha256(content),
  };
}

export function computePureCheckInputDigestSync(
  input: PureCheckInputDigestInput,
): PureCheckInputDigestResult {
  const root = normalizeRoot(input.repoRoot);
  const reasons: PureCheckRuntimeShadowReason[] = [];
  const filesByPath = new Map<string, MatchedFile>();
  const normalizedPathGlobs = uniqueSorted(input.identity.path_globs);

  if (input.identity.input_digest_rule_id !== input.inputDigestRule.id) {
    reasons.push(reason({
      code: 'input_digest_rule_mismatch',
      message: 'Pure check identity input_digest_rule_id does not match the supplied digest rule.',
    }));
  }

  for (const pathGlob of normalizedPathGlobs) {
    const match = matchGlobSync(root, pathGlob);
    for (const directoryPath of match.directory_paths) {
      reasons.push(reason({
        code: 'directory_ignored',
        path: directoryPath,
        path_glob: pathGlob,
        message: 'Directory matched a pure check path glob and was ignored; only file content is digested.',
      }));
    }
    if (match.files.length === 0 && match.directory_paths.length === 0) {
      reasons.push(reason({
        code: 'path_glob_missing',
        path_glob: pathGlob,
        message: 'Pure check path glob did not match any files.',
      }));
    }
    for (const file of match.files) {
      filesByPath.set(file.path, file);
    }
  }

  const matchedFiles = [...filesByPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => fileAuditEntrySync(file.path, file.absolute_path));

  const toolchainInputs = [...new Set(input.inputDigestRule.toolchain_inputs)]
    .sort((left, right) => left.localeCompare(right))
    .map((name): PureCheckInputDigestAuditToolchain => {
      const value = input.toolchainIdentity[name];
      if (typeof value !== 'string' || value.length === 0) {
        reasons.push(reason({
          code: 'toolchain_input_missing',
          toolchain_input: name,
          message: 'Declared pure check toolchain input did not have a supplied identity value.',
        }));
        return {
          name,
          value_digest: null,
        };
      }
      return {
        name,
        value_digest: sha256(value),
      };
    });

  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    check_id: input.identity.check_id,
    git_sha: input.gitSha,
    input_digest_rule: {
      id: input.inputDigestRule.id,
      material_policy: input.inputDigestRule.material_policy,
      toolchain_inputs: toolchainInputs.map((entry) => ({
        name: entry.name,
        value_digest: entry.value_digest,
      })),
    },
    path_globs: normalizedPathGlobs,
    files: matchedFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
    })),
    audit_reason_codes: reasons.map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
  };

  return {
    input_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      check_id: input.identity.check_id,
      input_digest_rule_id: input.inputDigestRule.id,
      git_sha: input.gitSha,
      path_globs: normalizedPathGlobs,
      matched_files: matchedFiles,
      toolchain_inputs: toolchainInputs,
      reasons,
    },
  };
}

function artifactFilesForRefSync(
  root: NormalizedRootPath,
  artifactRef: PureCheckArtifactRef,
  reasons: PureCheckRuntimeShadowReason[],
): readonly PureCheckArtifactDigestAuditFile[] {
  const normalizedPath = normalizeRelativePath(artifactRef.path);
  const required = artifactRef.required === true;
  const resolvedRef = resolveInsideRoot(root, normalizedPath);
  if (resolvedRef.relative_path === null) {
    reasons.push(reason({
      code: required ? 'required_artifact_path_outside_root' : 'artifact_path_outside_root',
      artifact_ref_id: artifactRef.id,
      path: normalizedPath,
      message: 'Artifact reference path resolves outside the supplied root and was not read.',
    }));
    return [];
  }

  const refStat = statIfExistsSyncSafe(resolvedRef.absolute_path);
  if (!refStat) {
    reasons.push(reason({
      code: required ? 'required_artifact_missing' : 'artifact_missing',
      artifact_ref_id: artifactRef.id,
      path: normalizedPath,
      message: 'Artifact reference path does not exist.',
    }));
    return [];
  }

  if (artifactRef.kind === 'file' && !refStat.isFile()) {
    reasons.push(reason({
      code: required ? 'required_artifact_kind_mismatch' : 'artifact_kind_mismatch',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference expected a file but did not resolve to a file.',
    }));
    return [];
  }

  if (artifactRef.kind === 'directory' && !refStat.isDirectory()) {
    reasons.push(reason({
      code: required ? 'required_artifact_kind_mismatch' : 'artifact_kind_mismatch',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference expected a directory but did not resolve to a directory.',
    }));
    return [];
  }

  if (refStat.isFile()) {
    return [artifactAuditEntrySync(
      artifactRef.id,
      resolvedRef.relative_path,
      resolvedRef.absolute_path,
    )];
  }

  if (!refStat.isDirectory()) {
    reasons.push(reason({
      code: required ? 'required_artifact_not_file_or_directory' : 'artifact_not_file_or_directory',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact reference is neither a regular file nor a directory.',
    }));
    return [];
  }

  const walkedFiles = walkFilesSync(root, resolvedRef.relative_path);
  if (walkedFiles.length === 0) {
    reasons.push(reason({
      code: required ? 'required_artifact_directory_empty' : 'artifact_directory_empty',
      artifact_ref_id: artifactRef.id,
      path: resolvedRef.relative_path,
      message: 'Artifact directory exists but does not contain files.',
    }));
    return [];
  }

  return walkedFiles
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => artifactAuditEntrySync(artifactRef.id, file.path, file.absolute_path));
}

export function computePureCheckArtifactDigestSync(
  input: PureCheckArtifactDigestInput,
): PureCheckArtifactDigestResult {
  const root = normalizeRoot(input.repoRoot);
  const reasons: PureCheckRuntimeShadowReason[] = [];
  const command = summarizeForDigest('command', input.command);
  const artifactsByKey = new Map<string, PureCheckArtifactDigestAuditFile>();
  const refs = [...input.artifactRefs].sort((left, right) => {
    const idComparison = left.id.localeCompare(right.id);
    return idComparison === 0
      ? normalizeRelativePath(left.path).localeCompare(normalizeRelativePath(right.path))
      : idComparison;
  });

  if (command.redaction) {
    reasons.push(reason({
      code: 'command_secret_like_value_redacted',
      message: 'Command contained a secret-looking value and was redacted before digesting.',
    }));
  }

  for (const artifactRef of refs) {
    const files = artifactFilesForRefSync(root, artifactRef, reasons);
    for (const file of files) {
      artifactsByKey.set(`${file.artifact_ref_id}:${file.path}`, file);
    }
  }

  const artifacts = [...artifactsByKey.values()]
    .sort((left, right) => {
      const refComparison = left.artifact_ref_id.localeCompare(right.artifact_ref_id);
      return refComparison === 0 ? left.path.localeCompare(right.path) : refComparison;
    });
  const requiredArtifactsComplete = !reasons.some((entry) => entry.code.startsWith('required_artifact_'));

  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    command_digest: command.digest,
    required_artifacts_complete: requiredArtifactsComplete,
    artifacts: artifacts.map((artifact) => ({
      artifact_ref_id: artifact.artifact_ref_id,
      path: artifact.path,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
    })),
    audit_reason_codes: reasons.map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
  };

  return {
    artifact_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      command_digest: command.digest ?? sha256(''),
      required_artifacts_complete: requiredArtifactsComplete,
      artifacts,
      reasons,
    },
  };
}

function readEvidenceClaimJsonlPathSync(
  path: string,
  validationPurpose: CurrentEvidenceClaimValidationPurpose | undefined,
): EvidenceClaimJsonlReadResult {
  let content: string;

  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: true,
        claims: [],
      };
    }
    throw error;
  }

  const claims: CurrentEvidenceClaimRecord[] = [];
  const failures: EvidenceClaimJsonlValidationFailure[] = [];
  const lines = content.split(/\r?\n/);
  const purpose = validationPurposeOrRecord(validationPurpose);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNumber = index + 1;
    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      failures.push({
        line: lineNumber,
        code: 'invalid_json',
        message: 'Evidence claim JSONL line is not valid JSON.',
        path,
      });
      return;
    }

    const validation = validateCurrentEvidenceClaim(parsed, { purpose });
    if (!validation.ok) {
      failures.push({
        line: lineNumber,
        code: 'claim_validation_failed',
        message: 'Evidence claim JSONL line failed current evidence claim schema validation.',
        path,
        validation_failures: validation.failures,
      });
      return;
    }

    claims.push(validation.value);
  });

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    claims,
  };
}

function appendEvidenceClaimJsonlPathSync(args: {
  path: string;
  claim: CurrentEvidenceClaimRecord;
  validationPurpose?: CurrentEvidenceClaimValidationPurpose;
}): EvidenceClaimJsonlWriteResult {
  const purpose = validationPurposeOrRecord(args.validationPurpose);
  const validation = validateCurrentEvidenceClaim(args.claim, { purpose });

  if (!validation.ok) {
    return {
      ok: false,
      path: args.path,
      failures: [{
        line: 0,
        code: 'claim_validation_failed',
        message: 'Evidence claim was not written because it failed current evidence claim schema validation.',
        path: args.path,
        validation_failures: validation.failures,
      }],
    };
  }

  mkdirSync(dirname(args.path), { recursive: true });
  appendFileSync(args.path, `${stableStringify(validation.value)}\n`, 'utf8');

  return {
    ok: true,
    path: args.path,
    claim_digest: computeEvidenceClaimDigest(validation.value),
  };
}

export function readEvidenceClaimJsonlStoreSync(
  input: EvidenceClaimJsonlReadInput,
): EvidenceClaimJsonlReadResult {
  return readEvidenceClaimJsonlPathSync(evidenceClaimsJsonlPath(input.runRoot), input.validationPurpose);
}

export function appendEvidenceClaimJsonlSync(
  input: EvidenceClaimJsonlWriteInput,
): EvidenceClaimJsonlWriteResult {
  return appendEvidenceClaimJsonlPathSync({
    path: evidenceClaimsJsonlPath(input.runRoot),
    claim: input.claim,
    validationPurpose: input.validationPurpose,
  });
}

export function readStablePureCheckClaimJsonlStoreSync(
  input: StablePureCheckClaimJsonlReadInput,
): EvidenceClaimJsonlReadResult {
  return readEvidenceClaimJsonlPathSync(stablePureCheckClaimsJsonlPath(input.repoRoot), input.validationPurpose);
}

export function appendStablePureCheckClaimJsonlSync(
  input: StablePureCheckClaimJsonlWriteInput,
): EvidenceClaimJsonlWriteResult {
  return appendEvidenceClaimJsonlPathSync({
    path: stablePureCheckClaimsJsonlPath(input.repoRoot),
    claim: input.claim,
    validationPurpose: input.validationPurpose,
  });
}

export function buildPureCheckRuntimeShadowClaimRecord(
  input: BuildPureCheckRuntimeShadowClaimInput,
): BuildPureCheckRuntimeShadowClaimResult {
  const scope = input.scope ?? 'debug';
  const job = findCurrentJobMetadataById(input.identity.owning_job_id);

  if (!job) {
    return {
      ok: false,
      failures: [{
        path: 'identity.owning_job_id',
        code: 'unknown_owning_job_id',
        message: 'Pure check identity owning_job_id is not present in the current job metadata manifest.',
      }],
    };
  }

  if (job.kind !== 'standalone_gate') {
    return {
      ok: false,
      failures: [{
        path: 'identity.owning_job_id',
        code: 'owning_job_not_standalone_gate',
        message: 'Pure check runtime shadow claims must bind standalone non-release jobs.',
      }],
    };
  }

  if (job.gate_id !== input.identity.owning_gate_id) {
    return {
      ok: false,
      failures: [{
        path: 'identity.owning_gate_id',
        code: 'owning_gate_job_mismatch',
        message: 'Pure check identity owning_gate_id does not match its owning job metadata.',
      }],
    };
  }

  if (
    input.resultStatus === 'passed'
    && input.artifactAudit
    && !input.artifactAudit.required_artifacts_complete
  ) {
    return {
      ok: false,
      failures: [{
        path: 'artifact_digest',
        code: 'required_artifact_missing',
        message: 'Passed pure check reuse claims require every required artifact to exist before claim creation.',
      }],
    };
  }

  const claim: CurrentEvidenceClaimRecord = {
    schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    subject: input.subject ?? `pure-check.${input.identity.check_id}.${input.identity.owning_job_id}`,
    scope,
    campaign_id: null,
    campaign_root: null,
    run_id: null,
    step_id: null,
    check_id: input.identity.check_id,
    gate_id: input.identity.owning_gate_id,
    line_kind: job.line_kind,
    gate_adapter: {
      npm_script: input.identity.npm_script ?? input.identity.command,
    },
    evidence_dir: input.evidenceDir,
    result_status: input.resultStatus,
    failure_class: input.failureClass,
    input_digest: {
      value: input.inputDigest,
    },
    artifact_digest: {
      value: input.artifactDigest,
    },
    result_digest: input.resultDigest,
    producer: {
      origin: input.producerOrigin,
    },
    freshness: {
      git_sha: input.gitSha,
      allow_cross_commit: false,
      allow_cross_secret_profile: false,
      secret_profile_digest: input.secretProfileDigest ?? null,
    },
    validator: {
      name: 'pure-check-runtime-shadow',
      version: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    },
    generated_at: input.generatedAt,
  };
  const validation = validateCurrentEvidenceClaim(claim, { purpose: 'pure_check_reuse' });

  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    value: validation.value,
  };
}

function pureCheckIdsForVerifyScripts(executedScripts: readonly string[]): readonly CurrentPureCheckId[] {
  return [...new Set(
    executedScripts.flatMap((script) => PURE_CHECK_IDS_BY_VERIFY_SCRIPT.get(script) ?? []),
  )];
}

function normalizeVerifyScriptExecutions(
  input: EvaluatePureCheckRuntimeShadowForVerifyRunSyncInput,
): readonly PureCheckVerifyScriptExecution[] {
  if (input.scriptExecutions) {
    return input.scriptExecutions;
  }
  return input.executedScripts.map((script) => ({
    script,
    resultStatus: 'passed',
    failureClass: 'none',
    exitCode: 0,
  }));
}

function pureCheckIdsForVerifyScriptExecutions(
  scriptExecutions: readonly PureCheckVerifyScriptExecution[],
): readonly CurrentPureCheckId[] {
  return pureCheckIdsForVerifyScripts(scriptExecutions.map((execution) => execution.script));
}

function scriptExecutionCoversCheck(
  execution: PureCheckVerifyScriptExecution,
  checkId: CurrentPureCheckId,
): boolean {
  return (PURE_CHECK_IDS_BY_VERIFY_SCRIPT.get(execution.script) ?? []).includes(checkId);
}

function resultForCheck(
  checkId: CurrentPureCheckId,
  scriptExecutions: readonly PureCheckVerifyScriptExecution[],
): PureCheckVerifyScriptExecution {
  const coveringExecutions = scriptExecutions.filter((execution) => scriptExecutionCoversCheck(execution, checkId));
  const failedExecution = coveringExecutions.find((execution) => execution.resultStatus === 'failed');
  if (failedExecution) {
    return failedExecution;
  }
  return coveringExecutions[0] ?? {
    script: 'unknown',
    resultStatus: 'failed',
    failureClass: 'evidence_missing',
    exitCode: null,
  };
}

function scriptResultsForCheck(
  checkId: CurrentPureCheckId,
  scriptExecutions: readonly PureCheckVerifyScriptExecution[],
): readonly PureCheckVerifyScriptAuditResult[] {
  return scriptExecutions
    .filter((execution) => scriptExecutionCoversCheck(execution, checkId))
    .map((execution) => ({
      script: execution.script,
      result_status: execution.resultStatus,
      failure_class: execution.failureClass,
    }));
}

function auditReasonCodes(reasons: readonly PureCheckRuntimeShadowReason[]): readonly string[] {
  return reasons.map((entry) => entry.code);
}

function inputDigestIncomplete(reasons: readonly PureCheckRuntimeShadowReason[]): boolean {
  return reasons.some((entry) => INPUT_DIGEST_INCOMPLETE_REASON_CODES.has(entry.code));
}

function findInputDigestRuleById(id: string): CurrentPureCheckInputDigestRule | undefined {
  return CURRENT_PURE_CHECK_IDENTITY_MANIFEST.input_digest_rules.find((rule) => rule.id === id);
}

function reportRootAbsolute(repoRoot: string, reportRoot: string): string {
  return isAbsolute(reportRoot) ? resolve(reportRoot) : resolve(repoRoot, reportRoot);
}

function relativeArtifactPath(root: NormalizedRootPath, absolutePath: string): string {
  return toRelativeInsideRoot(root, absolutePath) ?? absolutePath;
}

function producerEvidenceDirAbsolute(repoRoot: string, reportRoot: string, checkId: CurrentPureCheckId): string {
  return join(reportRootAbsolute(repoRoot, reportRoot), PURE_CHECK_PRODUCER_EVIDENCE_DIR_NAME, checkId);
}

function producerEvidencePathAbsolute(repoRoot: string, reportRoot: string, checkId: CurrentPureCheckId): string {
  return join(producerEvidenceDirAbsolute(repoRoot, reportRoot, checkId), PURE_CHECK_PRODUCER_RESULT_FILE_NAME);
}

function producerEvidenceDirForCheck(repoRoot: string, reportRoot: string, checkId: CurrentPureCheckId): string {
  const root = normalizeRoot(repoRoot);
  return relativeArtifactPath(root, producerEvidenceDirAbsolute(repoRoot, reportRoot, checkId));
}

function producerValidationFailure(
  code: string,
  path: string,
  message: string,
): PureCheckProducerEvidenceValidationFailure {
  return { code, path, message };
}

function pushProducerValidationFailure(
  failures: PureCheckProducerEvidenceValidationFailure[],
  code: string,
  path: string,
  message: string,
): void {
  failures.push(producerValidationFailure(code, path, message));
}

function validateProducerAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  basePath: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      pushProducerValidationFailure(
        failures,
        'unknown_key',
        basePath ? `${basePath}.${key}` : key,
        `Unknown key is not allowed: ${key}.`,
      );
    }
  }
}

function readProducerString(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    pushProducerValidationFailure(failures, 'invalid_type', path, 'Value must be a non-empty string.');
    return undefined;
  }
  return value;
}

function validateProducerNullableDigest(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (value !== null && (typeof value !== 'string' || !SHA256_DIGEST_PATTERN.test(value))) {
    pushProducerValidationFailure(
      failures,
      'malformed_digest',
      path,
      'Digest must be null or sha256:<64 lowercase hex chars>.',
    );
  }
}

function validateProducerIntegerOrNull(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value))) {
    pushProducerValidationFailure(failures, 'invalid_type', path, 'Value must be null or an integer.');
  }
}

function validateProducerNonNegativeInteger(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    pushProducerValidationFailure(failures, 'invalid_type', path, 'Value must be a non-negative integer.');
  }
}

function validateProducerTimestamp(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    pushProducerValidationFailure(failures, 'invalid_timestamp', path, 'Value must be an ISO timestamp string.');
    return undefined;
  }
  return value;
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function pathIsInside(candidate: string, base: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedCandidate = resolve(candidate);
  const pathRelativeToBase = relative(resolvedBase, resolvedCandidate);

  return pathRelativeToBase === ''
    || (!pathRelativeToBase.startsWith('..') && !pathRelativeToBase.includes(`..${sep}`));
}

function producerArtifactBasePath(
  scope: PureCheckProducerArtifactScope,
  roots: {
    repoRoot: string;
    reportRoot: string;
    evidenceDir: string;
  },
): string {
  if (scope === 'repo_root') {
    return roots.repoRoot;
  }
  if (scope === 'report_root') {
    return roots.reportRoot;
  }
  return roots.evidenceDir;
}

function resolveProducerArtifactPath(
  artifact: Pick<PureCheckProducerRequiredArtifactRef, 'scope' | 'path'>,
  roots: {
    repoRoot: string;
    reportRoot: string;
    evidenceDir: string;
  },
): string | null {
  const pathSegments = artifact.path.split(/[\\/]+/);
  if (artifact.path.startsWith('/') || pathSegments.includes('..')) {
    return null;
  }

  const basePath = producerArtifactBasePath(artifact.scope, roots);
  const absolutePath = resolve(basePath, artifact.path);
  if (!pathIsInside(absolutePath, basePath)) {
    return null;
  }
  return absolutePath;
}

function validateProducerSummaryDigest(
  value: unknown,
  path: string,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushProducerValidationFailure(failures, 'invalid_type', path, 'Summary digest must be an object.');
    return;
  }

  validateProducerAllowedKeys(value, PRODUCER_SUMMARY_DIGEST_KEYS, path, failures);
  validateProducerNullableDigest(value.digest, `${path}.digest`, failures);
  validateProducerNonNegativeInteger(value.summary_length, `${path}.summary_length`, failures);
  if (typeof value.redacted !== 'boolean') {
    pushProducerValidationFailure(failures, 'invalid_type', `${path}.redacted`, 'redacted must be a boolean.');
  }
}

function validateProducerStatusFields(
  value: Record<string, unknown>,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  const resultStatus = value.result_status;
  const failureClass = value.failure_class;
  validateProducerIntegerOrNull(value.exit_code, 'exit_code', failures);

  if (typeof resultStatus !== 'string' || !CURRENT_GATE_RESULT_STATUS_SET.has(resultStatus)) {
    pushProducerValidationFailure(failures, 'invalid_status', 'result_status', 'result_status must be passed or failed.');
  }
  if (typeof failureClass !== 'string' || !CURRENT_GATE_RESULT_FAILURE_CLASS_SET.has(failureClass)) {
    pushProducerValidationFailure(failures, 'invalid_failure_class', 'failure_class', 'failure_class is not recognized.');
  }
  if (
    typeof resultStatus !== 'string'
    || typeof failureClass !== 'string'
    || !CURRENT_GATE_RESULT_STATUS_SET.has(resultStatus)
    || !CURRENT_GATE_RESULT_FAILURE_CLASS_SET.has(failureClass)
  ) {
    return;
  }
  if (resultStatus === 'passed' && failureClass !== 'none') {
    pushProducerValidationFailure(
      failures,
      'status_failure_class_mismatch',
      'failure_class',
      'passed results must use failure_class none.',
    );
  }
  if (resultStatus === 'failed' && failureClass === 'none') {
    pushProducerValidationFailure(
      failures,
      'status_failure_class_mismatch',
      'failure_class',
      'failed results must use a non-none failure_class.',
    );
  }
}

function validateProducerTimestamps(
  value: Record<string, unknown>,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  const startedAt = validateProducerTimestamp(value.started_at, 'started_at', failures);
  const finishedAt = validateProducerTimestamp(value.finished_at, 'finished_at', failures);
  validateProducerTimestamp(value.generated_at, 'generated_at', failures);
  validateProducerNonNegativeInteger(value.duration_ms, 'duration_ms', failures);

  if (
    !startedAt
    || !finishedAt
    || typeof value.duration_ms !== 'number'
    || !Number.isInteger(value.duration_ms)
  ) {
    return;
  }

  const expectedDurationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  if (expectedDurationMs < 0) {
    pushProducerValidationFailure(failures, 'invalid_timestamp', 'finished_at', 'finished_at must be at or after started_at.');
    return;
  }
  if (value.duration_ms !== expectedDurationMs) {
    pushProducerValidationFailure(failures, 'duration_mismatch', 'duration_ms', 'duration_ms must match finished_at - started_at.');
  }
}

function validateProducerIdentityFields(
  value: Record<string, unknown>,
  identity: CurrentPureCheckIdentity,
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  readProducerString(value.owning_job_id, 'owning_job_id', failures);
  readProducerString(value.gate_id, 'gate_id', failures);
  readProducerString(value.command, 'command', failures);
  if (value.npm_script !== null && typeof value.npm_script !== 'string') {
    pushProducerValidationFailure(failures, 'invalid_type', 'npm_script', 'Value must be null or a non-empty string.');
  }

  const expectedNpmScript = identity.npm_script ?? null;
  if (value.owning_job_id !== identity.owning_job_id) {
    pushProducerValidationFailure(failures, 'identity_mismatch', 'owning_job_id', 'owning_job_id must match the pure check identity.');
  }
  if (value.gate_id !== identity.owning_gate_id) {
    pushProducerValidationFailure(failures, 'identity_mismatch', 'gate_id', 'gate_id must match the pure check identity.');
  }
  if (value.command !== identity.command) {
    pushProducerValidationFailure(failures, 'identity_mismatch', 'command', 'command must match the pure check identity.');
  }
  if (value.npm_script !== expectedNpmScript) {
    pushProducerValidationFailure(failures, 'identity_mismatch', 'npm_script', 'npm_script must match the pure check identity.');
  }
}

function validateProducerRequiredArtifactShape(
  artifact: Record<string, unknown>,
  index: number,
  seenIds: Set<string>,
  failures: PureCheckProducerEvidenceValidationFailure[],
): PureCheckProducerRequiredArtifactRef | null {
  validateProducerAllowedKeys(artifact, PRODUCER_REQUIRED_ARTIFACT_KEYS, `required_artifacts[${index}]`, failures);
  const id = readProducerString(artifact.id, `required_artifacts[${index}].id`, failures);
  const scope = readProducerString(artifact.scope, `required_artifacts[${index}].scope`, failures);
  const path = readProducerString(artifact.path, `required_artifacts[${index}].path`, failures);
  const kind = readProducerString(artifact.kind, `required_artifacts[${index}].kind`, failures);
  validateProducerNullableDigest(artifact.digest, `required_artifacts[${index}].digest`, failures);
  validateProducerIntegerOrNull(artifact.size_bytes, `required_artifacts[${index}].size_bytes`, failures);

  if (id && seenIds.has(id)) {
    pushProducerValidationFailure(failures, 'duplicate_artifact_id', `required_artifacts[${index}].id`, `Duplicate artifact id: ${id}.`);
  }
  if (id) {
    seenIds.add(id);
  }
  if (scope && !PRODUCER_REQUIRED_ARTIFACT_SCOPES.has(scope as PureCheckProducerArtifactScope)) {
    pushProducerValidationFailure(failures, 'scope_leak', `required_artifacts[${index}].scope`, 'Required artifact scope is not allowed.');
  }
  if (kind && kind !== 'file') {
    pushProducerValidationFailure(failures, 'invalid_type', `required_artifacts[${index}].kind`, 'Required artifact kind must be file.');
  }

  if (
    !id
    || !scope
    || !path
    || kind !== 'file'
    || !PRODUCER_REQUIRED_ARTIFACT_SCOPES.has(scope as PureCheckProducerArtifactScope)
    || (artifact.digest !== null && (typeof artifact.digest !== 'string' || !SHA256_DIGEST_PATTERN.test(artifact.digest)))
    || (artifact.size_bytes !== null && (typeof artifact.size_bytes !== 'number' || !Number.isInteger(artifact.size_bytes)))
  ) {
    return null;
  }

  return {
    id,
    scope: scope as PureCheckProducerArtifactScope,
    path,
    kind: 'file',
    digest: artifact.digest as string | null,
    size_bytes: artifact.size_bytes as number | null,
  };
}

function validateProducerRequiredArtifactFile(
  artifact: PureCheckProducerRequiredArtifactRef,
  roots: {
    repoRoot: string;
    reportRoot: string;
    evidenceDir: string;
  },
  failures: PureCheckProducerEvidenceValidationFailure[],
  index: number,
): void {
  const artifactPath = resolveProducerArtifactPath(artifact, roots);
  if (!artifactPath) {
    pushProducerValidationFailure(
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
    const artifactStat = statSync(artifactPath);
    if (!artifactStat.isFile()) {
      pushProducerValidationFailure(
        failures,
        'required_artifact_missing',
        `required_artifacts[${index}].path`,
        'Required artifact must be an existing file.',
      );
      return;
    }
    artifactContent = readFileSync(artifactPath);
    artifactSize = artifactStat.size;
  } catch {
    pushProducerValidationFailure(
      failures,
      'required_artifact_missing',
      `required_artifacts[${index}].path`,
      'Required artifact must be an existing file.',
    );
    return;
  }

  if (artifact.digest !== null && artifact.digest !== sha256(artifactContent)) {
    pushProducerValidationFailure(
      failures,
      'required_artifact_digest_mismatch',
      `required_artifacts[${index}].digest`,
      'Required artifact digest does not match file content.',
    );
  }
  if (artifact.size_bytes !== null && artifact.size_bytes !== artifactSize) {
    pushProducerValidationFailure(
      failures,
      'required_artifact_size_mismatch',
      `required_artifacts[${index}].size_bytes`,
      'Required artifact size does not match file size.',
    );
  }
}

function validateProducerRequiredArtifacts(
  artifacts: readonly unknown[],
  roots: {
    repoRoot: string;
    reportRoot: string;
    evidenceDir: string;
  },
  failures: PureCheckProducerEvidenceValidationFailure[],
): void {
  if (artifacts.length === 0) {
    pushProducerValidationFailure(failures, 'invalid_type', 'required_artifacts', 'required_artifacts must be non-empty.');
    return;
  }

  const seenIds = new Set<string>();
  let hasSelfArtifact = false;

  artifacts.forEach((artifact, index) => {
    if (!isRecord(artifact)) {
      pushProducerValidationFailure(failures, 'invalid_type', `required_artifacts[${index}]`, 'Required artifact must be an object.');
      return;
    }

    const ref = validateProducerRequiredArtifactShape(artifact, index, seenIds, failures);
    if (!ref) {
      return;
    }

    const isSelfArtifact = ref.id === PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID
      && ref.scope === 'evidence_dir'
      && ref.path === PURE_CHECK_PRODUCER_RESULT_FILE_NAME
      && ref.kind === 'file';
    hasSelfArtifact = hasSelfArtifact || isSelfArtifact;
    validateProducerRequiredArtifactFile(ref, roots, failures, index);
  });

  if (!hasSelfArtifact) {
    pushProducerValidationFailure(
      failures,
      'producer_result_artifact_missing',
      'required_artifacts',
      'required_artifacts must include the current producer result.json artifact.',
    );
  }
}

function validateProducerEvidenceRecordForRuntimeShadowSync(args: {
  value: unknown;
  repoRoot: string;
  reportRoot: string;
  identity: CurrentPureCheckIdentity;
}): {
  ok: true;
  value: PureCheckProducerEvidenceRecord;
} | {
  ok: false;
  failures: readonly PureCheckProducerEvidenceValidationFailure[];
} {
  const failures: PureCheckProducerEvidenceValidationFailure[] = [];

  if (!isRecord(args.value)) {
    return {
      ok: false,
      failures: [producerValidationFailure('invalid_type', 'record', 'Pure check producer evidence must be an object.')],
    };
  }

  validateProducerAllowedKeys(args.value, PRODUCER_TOP_LEVEL_KEYS, '', failures);
  if (args.value.schema !== PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA) {
    pushProducerValidationFailure(
      failures,
      'invalid_schema',
      'schema',
      `schema must be ${PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA}.`,
    );
  }

  const checkId = readProducerString(args.value.check_id, 'check_id', failures);
  if (checkId && checkId !== args.identity.check_id) {
    pushProducerValidationFailure(
      failures,
      'identity_mismatch',
      'check_id',
      `check_id must match expected pure check id ${args.identity.check_id}.`,
    );
  }

  const reportRoot = readProducerString(args.value.report_root, 'report_root', failures);
  const evidenceDir = readProducerString(args.value.evidence_dir, 'evidence_dir', failures);
  const absoluteReportRoot = reportRootAbsolute(args.repoRoot, args.reportRoot);
  const absoluteEvidenceDir = producerEvidenceDirAbsolute(args.repoRoot, args.reportRoot, args.identity.check_id);
  if (reportRoot && !sameResolvedPath(reportRoot, absoluteReportRoot)) {
    pushProducerValidationFailure(failures, 'scope_leak', 'report_root', 'report_root must match the reader reportRoot.');
  }
  if (evidenceDir && !sameResolvedPath(evidenceDir, absoluteEvidenceDir)) {
    pushProducerValidationFailure(
      failures,
      'scope_leak',
      'evidence_dir',
      'evidence_dir must resolve to <reportRoot>/pure-check-producer/<check_id>.',
    );
  }

  validateProducerIdentityFields(args.value, args.identity, failures);
  validateProducerStatusFields(args.value, failures);
  validateProducerTimestamps(args.value, failures);
  validateProducerSummaryDigest(args.value.stdout_summary_digest, 'stdout_summary_digest', failures);
  validateProducerSummaryDigest(args.value.stderr_summary_digest, 'stderr_summary_digest', failures);

  if (Array.isArray(args.value.required_artifacts)) {
    validateProducerRequiredArtifacts(
      args.value.required_artifacts,
      {
        repoRoot: resolve(args.repoRoot),
        reportRoot: absoluteReportRoot,
        evidenceDir: absoluteEvidenceDir,
      },
      failures,
    );
  } else {
    pushProducerValidationFailure(failures, 'invalid_type', 'required_artifacts', 'required_artifacts must be a non-empty array.');
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: args.value as unknown as PureCheckProducerEvidenceRecord,
  };
}

function readProducerEvidenceForRuntimeShadowSync(args: {
  repoRoot: string;
  reportRoot: string;
  identity: CurrentPureCheckIdentity;
}): PureCheckProducerEvidenceRuntimeReadResult {
  const path = producerEvidencePathAbsolute(args.repoRoot, args.reportRoot, args.identity.check_id);
  let content: string;

  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    return {
      ok: false,
      path,
      failures: [producerValidationFailure(
        'producer_result_missing',
        'result.json',
        'Pure check producer evidence result.json is missing.',
      )],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return {
      ok: false,
      path,
      failures: [producerValidationFailure(
        'invalid_json',
        'result.json',
        'Pure check producer evidence result.json must be valid JSON.',
      )],
    };
  }

  const validation = validateProducerEvidenceRecordForRuntimeShadowSync({
    value: parsed,
    repoRoot: args.repoRoot,
    reportRoot: args.reportRoot,
    identity: args.identity,
  });
  if (!validation.ok) {
    return {
      ok: false,
      path,
      failures: validation.failures,
    };
  }

  return {
    ok: true,
    path,
    digest: sha256(content),
    value: validation.value,
  };
}

function producerEvidenceFailureReasonCode(
  readResult: PureCheckProducerEvidenceRuntimeReadFailure,
): 'producer_evidence_missing' | 'producer_evidence_invalid' {
  return readResult.failures.some((failure) => failure.code === 'producer_result_missing')
    ? 'producer_evidence_missing'
    : 'producer_evidence_invalid';
}

function appendProducerEvidenceFailureReasonCodes(
  reasonCodes: string[],
  prefix: string,
  failures: readonly PureCheckProducerEvidenceValidationFailure[],
): void {
  for (const failure of failures) {
    reasonCodes.push(`${prefix}_${failure.code}`);
  }
}

function producerFailureToRuntimeReason(
  failure: PureCheckProducerEvidenceValidationFailure,
): PureCheckRuntimeShadowReason {
  return reason({
    code: `producer_evidence_${failure.code}`,
    path: failure.path,
    message: failure.message,
  });
}

function producerArtifactPathForAudit(args: {
  repoRoot: string;
  reportRoot: string;
  evidenceDir: string;
  artifact: Pick<PureCheckProducerRequiredArtifactRef, 'scope' | 'path'>;
}): {
  absolute_path: string | null;
  audit_path: string;
} {
  const roots = {
    repoRoot: resolve(args.repoRoot),
    reportRoot: reportRootAbsolute(args.repoRoot, args.reportRoot),
    evidenceDir: args.evidenceDir,
  };
  const absolutePath = resolveProducerArtifactPath(args.artifact, roots);
  if (!absolutePath) {
    return {
      absolute_path: null,
      audit_path: args.artifact.path,
    };
  }

  const root = normalizeRoot(args.repoRoot);
  return {
    absolute_path: absolutePath,
    audit_path: relativeArtifactPath(root, absolutePath),
  };
}

function typecheckNextTypegenArtifactReasons(
  identity: CurrentPureCheckIdentity,
  producerEvidence: PureCheckProducerEvidenceRecord,
): readonly PureCheckRuntimeShadowReason[] {
  if (identity.check_id !== 'typecheck') {
    return [];
  }

  return TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS.flatMap((expectedArtifact) => {
    const actualArtifact = producerEvidence.required_artifacts.find((artifact) => artifact.id === expectedArtifact.id);
    if (!actualArtifact) {
      return [reason({
        code: 'typecheck_next_typegen_artifact_missing',
        artifact_ref_id: expectedArtifact.id,
        path: expectedArtifact.path,
        message: 'Typecheck producer evidence must include Next typegen required artifacts before a shadow claim can be written.',
      })];
    }

    if (
      actualArtifact.scope === expectedArtifact.scope
      && actualArtifact.path === expectedArtifact.path
      && actualArtifact.kind === expectedArtifact.kind
    ) {
      return [];
    }

    return [reason({
      code: 'typecheck_next_typegen_artifact_mismatch',
      artifact_ref_id: expectedArtifact.id,
      path: expectedArtifact.path,
      message: `Typecheck producer evidence artifact ${expectedArtifact.id} must match scope=${expectedArtifact.scope}, path=${expectedArtifact.path}, kind=${expectedArtifact.kind}.`,
    })];
  });
}

function producerEvidenceRunBoundaryReasons(
  runStartedAt: string,
  producerEvidence: PureCheckProducerEvidenceRecord,
): readonly PureCheckRuntimeShadowReason[] {
  const runStartedAtMs = Date.parse(runStartedAt);
  if (Number.isNaN(runStartedAtMs)) {
    return [reason({
      code: 'producer_evidence_run_boundary_invalid',
      path: 'generatedAt',
      message: 'Verify run generatedAt must be a valid timestamp before producer evidence can be trusted.',
    })];
  }

  return ([
    ['started_at', producerEvidence.started_at],
    ['generated_at', producerEvidence.generated_at],
  ] as const).flatMap(([path, producerTimestamp]) => {
    const producerTimestampMs = Date.parse(producerTimestamp);
    if (!Number.isNaN(producerTimestampMs) && producerTimestampMs >= runStartedAtMs) {
      return [];
    }

    return [reason({
      code: 'producer_evidence_out_of_run',
      path,
      message: 'Producer evidence timestamp is older than this verify run start boundary and cannot produce a shadow claim.',
    })];
  });
}

function computeProducerEvidenceArtifactDigestSync(args: {
  repoRoot: string;
  reportRoot: string;
  identity: CurrentPureCheckIdentity;
  producerEvidence: PureCheckProducerEvidenceRuntimeReadResult;
  checkSpecificReasons: readonly PureCheckRuntimeShadowReason[];
}): PureCheckArtifactDigestResult {
  const producerEvidencePath = producerEvidencePathAbsolute(args.repoRoot, args.reportRoot, args.identity.check_id);
  const command = summarizeForDigest('command', args.identity.command);
  const reasons: PureCheckRuntimeShadowReason[] = [...args.checkSpecificReasons];
  const artifactsByKey = new Map<string, PureCheckArtifactDigestAuditFile>();

  if (command.redaction) {
    reasons.push(reason({
      code: 'command_secret_like_value_redacted',
      message: 'Command contained a secret-looking value and was redacted before digesting.',
    }));
  }

  if (!args.producerEvidence.ok) {
    reasons.push(...args.producerEvidence.failures.map(producerFailureToRuntimeReason));
  } else {
    const producerResultPath = producerArtifactPathForAudit({
      repoRoot: args.repoRoot,
      reportRoot: args.reportRoot,
      evidenceDir: args.producerEvidence.value.evidence_dir,
      artifact: {
        scope: 'evidence_dir',
        path: PURE_CHECK_PRODUCER_RESULT_FILE_NAME,
      },
    });
    if (producerResultPath.absolute_path) {
      artifactsByKey.set(
        `${PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID}:${producerResultPath.audit_path}`,
        artifactAuditEntrySync(
          PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
          producerResultPath.audit_path,
          producerResultPath.absolute_path,
        ),
      );
    }

    args.producerEvidence.value.required_artifacts.forEach((artifact) => {
      const artifactPath = producerArtifactPathForAudit({
        repoRoot: args.repoRoot,
        reportRoot: args.reportRoot,
        evidenceDir: args.producerEvidence.value.evidence_dir,
        artifact,
      });
      if (!artifactPath.absolute_path) {
        reasons.push(reason({
          code: 'producer_required_artifact_path_unreadable',
          artifact_ref_id: artifact.id,
          path: artifact.path,
          message: 'Producer required artifact path could not be resolved inside its declared scope.',
        }));
        return;
      }
      artifactsByKey.set(
        `${artifact.id}:${artifactPath.audit_path}`,
        artifactAuditEntrySync(artifact.id, artifactPath.audit_path, artifactPath.absolute_path),
      );
    });
  }

  if (!args.producerEvidence.ok) {
    reasons.push(reason({
      code: producerEvidenceFailureReasonCode(args.producerEvidence),
      path: relativeArtifactPath(normalizeRoot(args.repoRoot), producerEvidencePath),
      message: 'Producer-owned pure check evidence is required before a shadow claim can be written.',
    }));
  }

  const artifacts = [...artifactsByKey.values()]
    .sort((left, right) => {
      const refComparison = left.artifact_ref_id.localeCompare(right.artifact_ref_id);
      return refComparison === 0 ? left.path.localeCompare(right.path) : refComparison;
    });
  const requiredArtifactsComplete = args.producerEvidence.ok
    && !reasons.some((entry) => (
      entry.code.startsWith('typecheck_next_typegen_artifact_')
      || entry.code.startsWith('producer_required_artifact_')
      || entry.code.startsWith('producer_evidence_')
    ));
  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    producer_evidence_schema: PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
    check_id: args.identity.check_id,
    command_digest: command.digest,
    producer_result_digest: args.producerEvidence.ok ? args.producerEvidence.digest : null,
    required_artifacts_complete: requiredArtifactsComplete,
    required_artifacts: args.producerEvidence.ok
      ? args.producerEvidence.value.required_artifacts
          .map((artifact) => ({
            id: artifact.id,
            scope: artifact.scope,
            path: artifact.path,
            kind: artifact.kind,
            digest: artifact.digest,
            size_bytes: artifact.size_bytes,
          }))
          .sort((left, right) => left.id.localeCompare(right.id))
      : [],
    artifacts: artifacts.map((artifact) => ({
      artifact_ref_id: artifact.artifact_ref_id,
      path: artifact.path,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
    })),
    audit_reason_codes: reasons.map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
  };

  return {
    artifact_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      command_digest: command.digest ?? sha256(''),
      required_artifacts_complete: requiredArtifactsComplete,
      artifacts,
      reasons,
    },
  };
}

function computeProducerEvidenceResultDigest(
  input: {
    identity: CurrentPureCheckIdentity;
    producerEvidence: PureCheckProducerEvidenceRecord;
  },
): PureCheckResultDigestResult {
  const command = summarizeForDigest('command', input.identity.command);
  const redactions: PureCheckResultDigestRedaction[] = [];
  if (command.redaction) {
    redactions.push({
      field: 'command',
      reason: 'secret_like_value_redacted',
    });
  }
  if (input.producerEvidence.stdout_summary_digest.redacted) {
    redactions.push({
      field: 'stdout_summary',
      reason: 'secret_like_value_redacted',
    });
  }
  if (input.producerEvidence.stderr_summary_digest.redacted) {
    redactions.push({
      field: 'stderr_summary',
      reason: 'secret_like_value_redacted',
    });
  }

  const material: JsonValue = {
    schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
    producer_evidence_schema: PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
    check_id: input.identity.check_id,
    command_digest: command.digest,
    result_status: input.producerEvidence.result_status,
    failure_class: input.producerEvidence.failure_class,
    exit_code: input.producerEvidence.exit_code,
    stdout_summary_digest: {
      digest: input.producerEvidence.stdout_summary_digest.digest,
      summary_length: input.producerEvidence.stdout_summary_digest.summary_length,
      redacted: input.producerEvidence.stdout_summary_digest.redacted,
    },
    stderr_summary_digest: {
      digest: input.producerEvidence.stderr_summary_digest.digest,
      summary_length: input.producerEvidence.stderr_summary_digest.summary_length,
      redacted: input.producerEvidence.stderr_summary_digest.redacted,
    },
  };

  return {
    result_digest: digestJson(material),
    audit: {
      schema: PURE_CHECK_RUNTIME_SHADOW_SCHEMA,
      command_digest: command.digest ?? sha256(''),
      stdout_summary_digest: input.producerEvidence.stdout_summary_digest.digest,
      stderr_summary_digest: input.producerEvidence.stderr_summary_digest.digest,
      redactions,
    },
  };
}

function readPackageLockIdentity(repoRoot: string): string | null {
  const packageLockPath = join(repoRoot, 'package-lock.json');
  try {
    return sha256(readFileSync(packageLockPath));
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export function buildPureCheckRuntimeShadowToolchainIdentitySync(
  repoRoot: string,
): Readonly<Record<string, string | null>> {
  return {
    node: process.version,
    npm: process.env.npm_config_user_agent ?? process.env.npm_execpath ?? 'npm:unknown',
    'package-lock': readPackageLockIdentity(repoRoot),
  };
}

function claimMatchesCurrentPureCheck(args: {
  claim: CurrentEvidenceClaimRecord;
  identity: CurrentPureCheckIdentity;
  gitSha: string;
  inputDigest: string;
  artifactDigest: string;
  resultDigest: string;
}): boolean {
  const expectedNpmScript = args.identity.npm_script ?? args.identity.command;
  return args.claim.check_id === args.identity.check_id
    && args.claim.gate_id === args.identity.owning_gate_id
    && args.claim.gate_adapter.npm_script === expectedNpmScript
    && args.claim.result_status === 'passed'
    && args.claim.failure_class === 'none'
    && args.claim.input_digest.value === args.inputDigest
    && args.claim.artifact_digest.value === args.artifactDigest
    && args.claim.result_digest === args.resultDigest
    && args.claim.freshness.git_sha === args.gitSha
    && args.claim.freshness.allow_cross_commit === false
    && args.claim.freshness.allow_cross_secret_profile === false
    && args.claim.freshness.secret_profile_digest === null;
}

function appendFailureReasonCodes(
  reasonCodes: string[],
  prefix: string,
  failures: readonly (CurrentEvidenceClaimValidationFailure | EvidenceClaimJsonlValidationFailure)[],
): void {
  for (const failure of failures) {
    reasonCodes.push(`${prefix}_${failure.code}`);
  }
}

function uniqueReasonCodes(reasonCodes: readonly string[]): readonly string[] {
  return [...new Set(reasonCodes)];
}

export function evaluatePureCheckRuntimeShadowForVerifyRunSync(
  input: EvaluatePureCheckRuntimeShadowForVerifyRunSyncInput,
): PureCheckRuntimeShadowVerifyRunResult {
  const scriptExecutions = normalizeVerifyScriptExecutions(input);
  const checkIds = pureCheckIdsForVerifyScriptExecutions(scriptExecutions);
  if (checkIds.length === 0) {
    return {
      evaluations: [],
      run_claim_store_path: evidenceClaimsJsonlPath(input.reportRoot),
      stable_claim_store_path: stablePureCheckClaimsJsonlPath(input.repoRoot),
    };
  }

  const stableRead = readStablePureCheckClaimJsonlStoreSync({
    repoRoot: input.repoRoot,
    validationPurpose: 'pure_check_reuse',
  });
  const stableClaims = stableRead.ok ? stableRead.claims : [];
  const stableStoreReadable = stableRead.ok;
  const toolchainIdentity = input.toolchainIdentity
    ?? buildPureCheckRuntimeShadowToolchainIdentitySync(input.repoRoot);
  const evaluations: PureCheckRuntimeShadowVerifyEvaluation[] = [];

  for (const checkId of checkIds) {
    const identity = CURRENT_PURE_CHECK_IDENTITY_MANIFEST.checks.find((check) => check.check_id === checkId);
    if (!identity) {
      continue;
    }
    const inputDigestRule = findInputDigestRuleById(identity.input_digest_rule_id);
    if (!inputDigestRule) {
      continue;
    }

    const checkResult = resultForCheck(checkId, scriptExecutions);
    const scriptResults = scriptResultsForCheck(checkId, scriptExecutions);
    const inputDigest = computePureCheckInputDigestSync({
      repoRoot: input.repoRoot,
      identity,
      inputDigestRule,
      gitSha: input.gitSha,
      toolchainIdentity,
    });
    const producerEvidence = readProducerEvidenceForRuntimeShadowSync({
      repoRoot: input.repoRoot,
      reportRoot: input.reportRoot,
      identity,
    });
    const producerBoundaryReasons = producerEvidence.ok
      ? producerEvidenceRunBoundaryReasons(input.generatedAt, producerEvidence.value)
      : [];
    const producerEvidenceCurrent = producerEvidence.ok && producerBoundaryReasons.length === 0;
    const checkSpecificProducerReasons = producerEvidence.ok
      ? [
          ...producerBoundaryReasons,
          ...typecheckNextTypegenArtifactReasons(identity, producerEvidence.value),
        ]
      : [];
    const artifactDigest = computeProducerEvidenceArtifactDigestSync({
      repoRoot: input.repoRoot,
      reportRoot: input.reportRoot,
      identity,
      producerEvidence,
      checkSpecificReasons: checkSpecificProducerReasons,
    });
    const resultDigest = producerEvidenceCurrent
      ? computeProducerEvidenceResultDigest({
          identity,
          producerEvidence: producerEvidence.value,
        })
      : computePureCheckResultDigest({
          command: identity.command,
          resultStatus: checkResult.resultStatus,
          failureClass: checkResult.failureClass,
          exitCode: checkResult.exitCode,
          stdoutSummary: checkResult.stdoutSummary ?? null,
          stderrSummary: checkResult.stderrSummary ?? null,
        });

    const inputIncomplete = inputDigestIncomplete(inputDigest.audit.reasons);
    const resultStatus = producerEvidenceCurrent ? producerEvidence.value.result_status : checkResult.resultStatus;
    const failureClass = producerEvidenceCurrent ? producerEvidence.value.failure_class : checkResult.failureClass;
    const producerEvidenceAvailable = producerEvidenceCurrent;
    const producerEvidencePassed = producerEvidenceCurrent
      && producerEvidence.value.result_status === 'passed'
      && producerEvidence.value.failure_class === 'none';
    const resultPassed = resultStatus === 'passed' && failureClass === 'none';
    const currentEvidenceReusable = resultPassed
      && !inputIncomplete
      && producerEvidenceAvailable
      && producerEvidencePassed
      && artifactDigest.audit.required_artifacts_complete;
    const claimsForCheck = stableClaims.filter((claim) => claim.check_id === checkId);
    const validCount = currentEvidenceReusable
      ? claimsForCheck.filter((claim) => claimMatchesCurrentPureCheck({
          claim,
          identity,
          gitSha: input.gitSha,
          inputDigest: inputDigest.input_digest,
          artifactDigest: artifactDigest.artifact_digest,
          resultDigest: resultDigest.result_digest,
        })).length
      : 0;
    const claimCount = claimsForCheck.length;
    const invalidCount = claimCount - validCount;
    const reasonCodes = [
      resultPassed ? 'producer_execution_confirmed_shadow_only' : 'producer_execution_failed',
      ...auditReasonCodes(inputDigest.audit.reasons),
      ...auditReasonCodes(artifactDigest.audit.reasons),
    ];

    if (inputIncomplete) {
      reasonCodes.push('input_digest_incomplete');
    }
    if (producerEvidence.ok) {
      reasonCodes.push('producer_evidence_valid');
      if (!producerEvidencePassed) {
        reasonCodes.push('producer_evidence_failed');
      }
    } else {
      reasonCodes.push(producerEvidenceFailureReasonCode(producerEvidence));
      appendProducerEvidenceFailureReasonCodes(reasonCodes, 'producer_evidence', producerEvidence.failures);
    }
    if (!artifactDigest.audit.required_artifacts_complete) {
      reasonCodes.push('producer_required_artifacts_incomplete');
    }

    if (!stableStoreReadable) {
      reasonCodes.push('stable_claim_store_invalid');
      appendFailureReasonCodes(reasonCodes, 'stable_claim_store', stableRead.failures);
    } else if (claimCount === 0) {
      reasonCodes.push('stable_claim_store_empty');
    } else if (validCount > 0) {
      reasonCodes.push('pure_check_claim_valid_for_reuse');
    } else if (!currentEvidenceReusable) {
      reasonCodes.push('stable_claim_not_reusable_without_current_producer_evidence');
    } else {
      reasonCodes.push('stable_claim_mismatch');
    }

    let claimStoreWrite = false;
    let claimDigest: string | undefined;
    const claimEligible = currentEvidenceReusable;

    if (!claimEligible) {
      reasonCodes.push('runtime_shadow_claim_not_written');
    } else {
      const claimResult = buildPureCheckRuntimeShadowClaimRecord({
        identity,
        scope: input.scope ?? 'pr',
        evidenceDir: producerEvidenceDirForCheck(input.repoRoot, input.reportRoot, checkId),
        resultStatus,
        failureClass,
        inputDigest: inputDigest.input_digest,
        artifactDigest: artifactDigest.artifact_digest,
        artifactAudit: artifactDigest.audit,
        resultDigest: resultDigest.result_digest,
        gitSha: input.gitSha,
        generatedAt: input.generatedAt,
        producerOrigin: 'verify-run-runtime-shadow',
      });

      if (!claimResult.ok) {
        reasonCodes.push('runtime_shadow_claim_build_failed');
        appendFailureReasonCodes(reasonCodes, 'runtime_shadow_claim', claimResult.failures);
      } else {
        const runWrite = appendEvidenceClaimJsonlSync({
          runRoot: input.reportRoot,
          claim: claimResult.value,
          validationPurpose: 'pure_check_reuse',
        });
        const stableWrite = stableStoreReadable
          ? appendStablePureCheckClaimJsonlSync({
              repoRoot: input.repoRoot,
              claim: claimResult.value,
              validationPurpose: 'pure_check_reuse',
            })
          : null;
        claimStoreWrite = runWrite.ok && stableWrite?.ok === true;
        if (claimStoreWrite) {
          claimDigest = stableWrite.claim_digest;
          reasonCodes.push('runtime_shadow_claim_written');
        } else {
          reasonCodes.push('runtime_shadow_claim_write_failed');
          if (!runWrite.ok) {
            appendFailureReasonCodes(reasonCodes, 'runtime_shadow_run_claim', runWrite.failures);
          }
          if (stableWrite && !stableWrite.ok) {
            appendFailureReasonCodes(reasonCodes, 'runtime_shadow_stable_claim', stableWrite.failures);
          }
        }
      }
    }

    const decision = validCount > 0
      ? 'reuse_allowed'
      : claimStoreWrite
        ? 'shadow_only'
        : 'rerun_required';

    evaluations.push({
      check_id: checkId,
      decision,
      result_status: resultStatus,
      failure_class: failureClass,
      script_results: scriptResults,
      reason_codes: uniqueReasonCodes(reasonCodes),
      claim_store_read: true,
      claim_store_write: claimStoreWrite,
      claim_count: claimCount,
      valid_count: validCount,
      invalid_count: invalidCount,
      audit_digests: {
        input: inputDigest.input_digest,
        artifact: artifactDigest.artifact_digest,
        result: resultDigest.result_digest,
        ...(claimDigest ? { claim: claimDigest } : {}),
      },
    });
  }

  return {
    evaluations,
    run_claim_store_path: evidenceClaimsJsonlPath(input.reportRoot),
    stable_claim_store_path: stablePureCheckClaimsJsonlPath(input.repoRoot),
  };
}
