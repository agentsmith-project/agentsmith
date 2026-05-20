import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AsbcpManifestLockFailure = {
  field: string;
  message: string;
};

export type AsbcpManifestLockResult = {
  ok: boolean;
  failures: AsbcpManifestLockFailure[];
};

type JsonObject = Record<string, unknown>;

type ImageRef = {
  repo: string;
  tag: string;
  digest: string;
};

type AsbcpImageLock = {
  version: string;
  sourceImage: string;
  releaseUrl: string;
  commitSha: string;
  image: ImageRef;
};

type BreakingChangeAllowance = {
  id: string;
  summary: string;
  expiresOn: string;
};

type AsbcpAdoptionPolicy = {
  finalManifestSchema: {
    schemaId: string;
    manifestSchemaVersion: string;
  };
  supportedApiContractVersions: Set<string>;
  breakingChangesAllowlist: Map<string, BreakingChangeAllowance>;
};

type CliOptions = {
  manifestPath?: string;
  lockPath?: string;
  policyPath?: string;
  help: boolean;
  failures: AsbcpManifestLockFailure[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOCK_PATH = resolve(REPO_ROOT, 'infra/deploy/shared/asbcp-image.lock');
const DEFAULT_POLICY_PATH = resolve(REPO_ROOT, 'scripts/contracts/asbcp-adoption-policy.json');
const CANONICAL_REPO = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const RELEASE_URL_PREFIX = 'https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/';
const FINAL_MANIFEST_SCHEMA_ID = 'https://agentsmith.dev/schemas/asbcp/final-manifest.v1.json';
const FINAL_MANIFEST_SCHEMA_VERSION = 'v1';
const ADOPTION_POLICY_SCHEMA_ID = 'https://agentsmith.dev/schemas/agentsmith/asbcp-adoption-policy.v1.json';
const ADOPTION_POLICY_SCHEMA_VERSION = 'v1';
const FINAL_MANIFEST_ENV = 'ASBCP_FINAL_MANIFEST';
const RELEASE_GATE = 'scripts/verify-release.sh';
const KNOWN_RISK_STATUS_SOURCE = 'docs/RISK_REGISTER.md release_blocking column';
const VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z]+)*$/u;
const DIGEST_PATTERN = /^sha256:[a-fA-F0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/iu;
const API_CONTRACT_VERSION_PATTERN = /^v\d+$/u;
const BREAKING_CHANGE_ID_PATTERN = /^ASBCP-BC-\d{4}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FINAL_MANIFEST_TOP_LEVEL_KEYS = new Set([
  'schema_id',
  'manifest_schema_version',
  'asbcp_version',
  'git_tag',
  'commit_sha',
  'image_ref',
  'image_digest',
  'api_contract_version',
  'anonymous_pull',
  'same_digest_proof',
  'known_breaking_changes',
  'changelog_summary',
  'known_risk_status',
  'known_risk_status_source',
  'runbook_url',
  'release_notes',
  'release_gate',
]);
const KNOWN_BREAKING_CHANGE_KEYS = new Set(['id', 'summary']);
function addFailure(failures: AsbcpManifestLockFailure[], field: string, message: string): void {
  failures.push({ field, message });
}

function expectedActualMessage(expected: string, actual: string): string {
  return `expected ${expected}; actual ${actual}`;
}

function actualFieldValue(value: unknown): string {
  if (value === undefined) {
    return '<missing>';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextFile(path: string, field: string, failures: AsbcpManifestLockFailure[]): string | null {
  if (!existsSync(path)) {
    addFailure(failures, field, `file does not exist: ${path}`);
    return null;
  }

  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    addFailure(failures, field, `failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseJsonObject(
  source: string,
  sourceName: string,
  failures: AsbcpManifestLockFailure[],
  field = 'manifest',
): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    addFailure(
      failures,
      field,
      `failed to parse ${sourceName} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!isJsonObject(parsed)) {
    addFailure(failures, field, `${sourceName} must be a JSON object`);
    return null;
  }

  return parsed;
}

function parseKeyValues(source: string, sourceName: string, failures: AsbcpManifestLockFailure[]): Record<string, string> {
  const values: Record<string, string> = {};

  source.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      return;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      addFailure(failures, 'lock', `${sourceName}:${index + 1} must be key=value`);
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (values[key] !== undefined) {
      addFailure(failures, `lock.${key}`, `${sourceName}:${index + 1} must not duplicate ${key}`);
      return;
    }

    values[key] = value;
  });

  return values;
}

function requiredString(
  values: Record<string, string>,
  key: string,
  failures: AsbcpManifestLockFailure[],
): string | null {
  const value = values[key];
  if (!value) {
    addFailure(failures, `lock.${key}`, `lock must include ${key}`);
    return null;
  }
  return value;
}

function stringField(
  object: JsonObject,
  key: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
  sourceLabel = 'manifest',
): string | null {
  const value = object[key];
  if (value === undefined) {
    addFailure(failures, field, `${sourceLabel} must include ${key}`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    addFailure(failures, field, `${key} must be a non-empty string; actual ${actualFieldValue(value)}`);
    return null;
  }
  return value.trim();
}

function objectField(
  object: JsonObject,
  key: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
  sourceLabel = 'manifest',
): JsonObject | null {
  const value = object[key];
  if (value === undefined) {
    addFailure(failures, field, `${sourceLabel} must include ${key}`);
    return null;
  }
  if (!isJsonObject(value)) {
    addFailure(failures, field, `${key} must be an object; actual ${actualFieldValue(value)}`);
    return null;
  }
  return value;
}

function arrayField(
  object: JsonObject,
  key: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
  sourceLabel = 'manifest',
): unknown[] | null {
  const value = object[key];
  if (value === undefined) {
    addFailure(failures, field, `${sourceLabel} must include ${key}`);
    return null;
  }
  if (!Array.isArray(value)) {
    addFailure(failures, field, `${key} must be an array; actual ${actualFieldValue(value)}`);
    return null;
  }
  return value;
}

function dateOnly(value: string | Date | undefined): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_PATTERN.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return new Date().toISOString().slice(0, 10);
}

function normalizedStringValue(object: JsonObject, key: string): string | null {
  const value = object[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function isUri(value: string): boolean {
  try {
    // The upstream schema uses JSON Schema "format: uri"; URL gives us a
    // stable structural check without depending on fragile release text.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function rejectUnexpectedKeys(
  object: JsonObject,
  allowedKeys: ReadonlySet<string>,
  field: string,
  failures: AsbcpManifestLockFailure[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      addFailure(failures, `${field}.${key}`, `${field} must not include ${key}`);
    }
  }
}

function normalizeDigest(digest: string): string {
  return digest.toLowerCase();
}

function parseImageRef(
  value: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
): ImageRef | null {
  const match = /^(.+):([^:@/]+)@(sha256:[a-fA-F0-9]{64})$/u.exec(value);
  if (!match) {
    addFailure(
      failures,
      field,
      `image must use ${CANONICAL_REPO}:vX.Y.Z@sha256:<digest>; actual ${value}`,
    );
    return null;
  }

  const repo = match[1] ?? '';
  const tag = match[2] ?? '';
  const digest = normalizeDigest(match[3] ?? '');

  if (repo !== CANONICAL_REPO) {
    addFailure(
      failures,
      field,
      `image repo must be ${CANONICAL_REPO}; actual ${repo}`,
    );
  }
  if (!VERSION_PATTERN.test(tag)) {
    addFailure(failures, field, `image tag must use vX.Y.Z; actual ${tag}`);
  }
  if (!DIGEST_PATTERN.test(digest)) {
    addFailure(failures, field, `image digest must be sha256:<64 hex>; actual ${digest}`);
  }

  return { repo, tag, digest };
}

function parseLock(source: string, sourceName: string, failures: AsbcpManifestLockFailure[]): AsbcpImageLock | null {
  const values = parseKeyValues(source, sourceName, failures);

  for (const key of ['api_contract_version', 'asbcp_api_contract_version']) {
    if (values[key] !== undefined) {
      addFailure(
        failures,
        `lock.${key}`,
        `${key} must not include API contract version; ASBCP image lock only pins image identity`,
      );
    }
  }

  const version = requiredString(values, 'asbcp_version', failures);
  const sourceImage = requiredString(values, 'asbcp_source_image', failures);
  const releaseUrl = requiredString(values, 'asbcp_release_url', failures);
  const commitSha = requiredString(values, 'asbcp_commit_sha', failures);

  if (!version || !sourceImage || !releaseUrl || !commitSha) {
    return null;
  }

  if (!VERSION_PATTERN.test(version)) {
    addFailure(failures, 'lock.asbcp_version', `asbcp_version must use vX.Y.Z; actual ${version}`);
  }

  const image = parseImageRef(sourceImage, 'lock.asbcp_source_image', failures);
  if (image && image.tag !== version) {
    addFailure(
      failures,
      'lock.asbcp_source_image',
      `source image tag must match asbcp_version; ${expectedActualMessage(version, image.tag)}`,
    );
  }

  const expectedReleaseUrl = `${RELEASE_URL_PREFIX}${version}`;
  if (releaseUrl !== expectedReleaseUrl) {
    addFailure(
      failures,
      'lock.asbcp_release_url',
      `release URL tag must match asbcp_version; ${expectedActualMessage(expectedReleaseUrl, releaseUrl)}`,
    );
  }

  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    addFailure(failures, 'lock.asbcp_commit_sha', `asbcp_commit_sha must be a git SHA; actual ${commitSha}`);
  }

  if (!image) {
    return null;
  }

  return {
    version,
    sourceImage,
    releaseUrl,
    commitSha: commitSha.toLowerCase(),
    image,
  };
}

function parseStringArray(
  policy: JsonObject,
  key: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
): string[] | null {
  const values = arrayField(policy, key, field, failures, 'policy');
  if (!values) {
    return null;
  }

  const strings: string[] = [];
  values.forEach((value, index) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      addFailure(failures, `${field}[${index}]`, `${key}[${index}] must be a non-empty string; actual ${actualFieldValue(value)}`);
      return;
    }
    strings.push(value.trim());
  });

  return strings;
}

function parseBreakingChangesAllowlist(
  policy: JsonObject,
  failures: AsbcpManifestLockFailure[],
): Map<string, BreakingChangeAllowance> | null {
  const values = arrayField(policy, 'breaking_changes_allowlist', 'policy.breaking_changes_allowlist', failures, 'policy');
  if (!values) {
    return null;
  }

  const allowlist = new Map<string, BreakingChangeAllowance>();
  values.forEach((value, index) => {
    const field = `policy.breaking_changes_allowlist[${index}]`;
    if (!isJsonObject(value)) {
      addFailure(failures, field, `breaking_changes_allowlist[${index}] must be an object; actual ${actualFieldValue(value)}`);
      return;
    }

    const id = stringField(value, 'id', `${field}.id`, failures, 'breaking_changes_allowlist entry');
    const summary = stringField(value, 'summary', `${field}.summary`, failures, 'breaking_changes_allowlist entry');
    const expiresOn = stringField(value, 'expires_on', `${field}.expires_on`, failures, 'breaking_changes_allowlist entry');

    if (id && !BREAKING_CHANGE_ID_PATTERN.test(id)) {
      addFailure(failures, `${field}.id`, `id must use ASBCP-BC-0000 format; actual ${id}`);
    }
    if (expiresOn && !DATE_PATTERN.test(expiresOn)) {
      addFailure(failures, `${field}.expires_on`, `expires_on must use YYYY-MM-DD; actual ${expiresOn}`);
    }
    if (id && allowlist.has(id)) {
      addFailure(failures, `${field}.id`, `breaking change allowlist must not duplicate ${id}`);
    }

    if (id && summary && expiresOn) {
      allowlist.set(id, { id, summary, expiresOn });
    }
  });

  return allowlist;
}

function parsePolicy(source: string, sourceName: string, failures: AsbcpManifestLockFailure[]): AsbcpAdoptionPolicy | null {
  const policy = parseJsonObject(source, sourceName, failures, 'policy');
  if (!policy) {
    return null;
  }

  const schemaId = stringField(policy, 'schema_id', 'policy.schema_id', failures, 'policy');
  const schemaVersion = stringField(policy, 'schema_version', 'policy.schema_version', failures, 'policy');
  const finalManifestSchema = objectField(
    policy,
    'final_manifest_schema',
    'policy.final_manifest_schema',
    failures,
    'policy',
  );
  const supportedVersions = parseStringArray(
    policy,
    'supported_api_contract_versions',
    'policy.supported_api_contract_versions',
    failures,
  );
  const allowlist = parseBreakingChangesAllowlist(policy, failures);

  if (schemaId && schemaId !== ADOPTION_POLICY_SCHEMA_ID) {
    addFailure(
      failures,
      'policy.schema_id',
      `schema_id must match AgentSmith ASBCP adoption policy schema; ${expectedActualMessage(ADOPTION_POLICY_SCHEMA_ID, schemaId)}`,
    );
  }
  if (schemaVersion && schemaVersion !== ADOPTION_POLICY_SCHEMA_VERSION) {
    addFailure(
      failures,
      'policy.schema_version',
      `schema_version must be ${ADOPTION_POLICY_SCHEMA_VERSION}; actual ${schemaVersion}`,
    );
  }

  let expectedManifestSchemaId: string | null = null;
  let expectedManifestSchemaVersion: string | null = null;
  if (finalManifestSchema) {
    expectedManifestSchemaId = stringField(
      finalManifestSchema,
      'schema_id',
      'policy.final_manifest_schema.schema_id',
      failures,
      'policy.final_manifest_schema',
    );
    expectedManifestSchemaVersion = stringField(
      finalManifestSchema,
      'manifest_schema_version',
      'policy.final_manifest_schema.manifest_schema_version',
      failures,
      'policy.final_manifest_schema',
    );
  }

  if (expectedManifestSchemaId && expectedManifestSchemaId !== FINAL_MANIFEST_SCHEMA_ID) {
    addFailure(
      failures,
      'policy.final_manifest_schema.schema_id',
      `final manifest schema_id must be ${FINAL_MANIFEST_SCHEMA_ID}; actual ${expectedManifestSchemaId}`,
    );
  }
  if (expectedManifestSchemaVersion && expectedManifestSchemaVersion !== FINAL_MANIFEST_SCHEMA_VERSION) {
    addFailure(
      failures,
      'policy.final_manifest_schema.manifest_schema_version',
      `final manifest manifest_schema_version must be ${FINAL_MANIFEST_SCHEMA_VERSION}; actual ${expectedManifestSchemaVersion}`,
    );
  }

  const versionSet = new Set<string>();
  supportedVersions?.forEach((version, index) => {
    if (!API_CONTRACT_VERSION_PATTERN.test(version)) {
      addFailure(
        failures,
        `policy.supported_api_contract_versions[${index}]`,
        `supported API contract version must use vN; actual ${version}`,
      );
      return;
    }
    if (versionSet.has(version)) {
      addFailure(
        failures,
        `policy.supported_api_contract_versions[${index}]`,
        `supported_api_contract_versions must not duplicate ${version}`,
      );
    }
    versionSet.add(version);
  });

  if (supportedVersions && supportedVersions.length === 0) {
    addFailure(failures, 'policy.supported_api_contract_versions', 'supported_api_contract_versions must not be empty');
  }

  if (
    !schemaId ||
    !schemaVersion ||
    !expectedManifestSchemaId ||
    !expectedManifestSchemaVersion ||
    !supportedVersions ||
    !allowlist
  ) {
    return null;
  }

  return {
    finalManifestSchema: {
      schemaId: expectedManifestSchemaId,
      manifestSchemaVersion: expectedManifestSchemaVersion,
    },
    supportedApiContractVersions: versionSet,
    breakingChangesAllowlist: allowlist,
  };
}

function checkManifestSchema(
  manifest: JsonObject,
  policy: AsbcpAdoptionPolicy,
  failures: AsbcpManifestLockFailure[],
): void {
  const schemaId = stringField(manifest, 'schema_id', 'manifest.schema_id', failures);
  const schemaVersion = stringField(
    manifest,
    'manifest_schema_version',
    'manifest.manifest_schema_version',
    failures,
  );

  if (!schemaId) {
    addFailure(
      failures,
      'manifest.schema_id',
      `schema_id must match supported ASBCP final manifest schema; ${expectedActualMessage(policy.finalManifestSchema.schemaId, '<missing>')}`,
    );
  }
  if (schemaId && schemaId !== policy.finalManifestSchema.schemaId) {
    addFailure(
      failures,
      'manifest.schema_id',
      `schema_id must match supported ASBCP final manifest schema; ${expectedActualMessage(policy.finalManifestSchema.schemaId, schemaId)}`,
    );
  }
  if (schemaVersion && schemaVersion !== policy.finalManifestSchema.manifestSchemaVersion) {
    addFailure(
      failures,
      'manifest.manifest_schema_version',
      `manifest_schema_version must be ${policy.finalManifestSchema.manifestSchemaVersion}; actual ${schemaVersion}`,
    );
  }
}

function checkManifestVersion(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const asbcpVersion = stringField(manifest, 'asbcp_version', 'manifest.asbcp_version', failures);
  const gitTag = stringField(manifest, 'git_tag', 'manifest.git_tag', failures);

  if (asbcpVersion && !VERSION_PATTERN.test(asbcpVersion)) {
    addFailure(failures, 'manifest.asbcp_version', `asbcp_version must use vX.Y.Z; actual ${asbcpVersion}`);
  }
  if (gitTag && !VERSION_PATTERN.test(gitTag)) {
    addFailure(failures, 'manifest.git_tag', `git_tag must use vX.Y.Z; actual ${gitTag}`);
  }

  if (asbcpVersion && asbcpVersion !== lock.version) {
    addFailure(
      failures,
      'manifest.version',
      `asbcp_version must match lock version; expected ${lock.version}; actual asbcp_version=${actualFieldValue(manifest.asbcp_version)}, git_tag=${actualFieldValue(manifest.git_tag)}`,
    );
  }
  if (gitTag && gitTag !== lock.version) {
    addFailure(
      failures,
      'manifest.version',
      `git_tag must match lock version; expected ${lock.version}; actual asbcp_version=${actualFieldValue(manifest.asbcp_version)}, git_tag=${actualFieldValue(manifest.git_tag)}`,
    );
  }
  if (asbcpVersion && gitTag && asbcpVersion !== gitTag) {
    addFailure(
      failures,
      'manifest.version',
      `asbcp_version and git_tag must match each other; actual asbcp_version=${actualFieldValue(manifest.asbcp_version)}, git_tag=${actualFieldValue(manifest.git_tag)}`,
    );
  }
}

function checkManifestCommit(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const commitSha = stringField(manifest, 'commit_sha', 'manifest.commit_sha', failures);
  if (!commitSha) {
    return;
  }

  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    addFailure(failures, 'manifest.commit_sha', `commit_sha must be a git SHA; actual ${commitSha}`);
    return;
  }

  if (commitSha.toLowerCase() !== lock.commitSha) {
    addFailure(
      failures,
      'manifest.commit_sha',
      `commit_sha must match lock asbcp_commit_sha; ${expectedActualMessage(lock.commitSha, commitSha)}`,
    );
  }
}

function checkManifestImage(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const imageRef = stringField(manifest, 'image_ref', 'manifest.image_ref', failures);
  if (!imageRef) {
    return;
  }

  const parsedImage = parseImageRef(imageRef, 'manifest.image_ref', failures);
  if (!parsedImage) {
    return;
  }

  if (parsedImage.repo !== CANONICAL_REPO) {
    return;
  }
  if (parsedImage.tag !== lock.version) {
    addFailure(
      failures,
      'manifest.image_ref',
      `image tag must match lock version; ${expectedActualMessage(lock.version, parsedImage.tag)}`,
    );
  }
  if (parsedImage.digest !== lock.image.digest) {
    addFailure(
      failures,
      'manifest.image_ref',
      `image digest must match lock digest; ${expectedActualMessage(lock.image.digest, parsedImage.digest)}`,
    );
  }

  for (const [manifestKey, manifestField] of [
    ['asbcp_version', 'manifest.asbcp_version'],
    ['git_tag', 'manifest.git_tag'],
  ] as const) {
    const tag = normalizedStringValue(manifest, manifestKey);
    if (tag && parsedImage.tag !== tag) {
      addFailure(
        failures,
        'manifest.image_ref',
        `image tag must match ${manifestField}; ${expectedActualMessage(tag, parsedImage.tag)}`,
      );
    }
  }
}

function checkManifestImageDigest(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const digest = stringField(manifest, 'image_digest', 'manifest.image_digest', failures);
  if (!digest) {
    return;
  }

  const normalizedDigest = normalizeDigest(digest);
  if (!DIGEST_PATTERN.test(normalizedDigest)) {
    addFailure(failures, 'manifest.image_digest', `image_digest must be sha256:<64 hex>; actual ${digest}`);
    return;
  }
  if (normalizedDigest !== lock.image.digest) {
    addFailure(
      failures,
      'manifest.image_digest',
      `image_digest must match lock digest; ${expectedActualMessage(lock.image.digest, normalizedDigest)}`,
    );
  }

  const imageRef = normalizedStringValue(manifest, 'image_ref');
  if (imageRef) {
    const parsedImage = parseImageRef(imageRef, 'manifest.image_ref', failures);
    if (parsedImage && parsedImage.digest !== normalizedDigest) {
      addFailure(
        failures,
        'manifest.image_digest',
        `image_digest must match image_ref digest; ${expectedActualMessage(parsedImage.digest, normalizedDigest)}`,
      );
    }
  }
}

function checkApiContractVersion(
  manifest: JsonObject,
  policy: AsbcpAdoptionPolicy,
  failures: AsbcpManifestLockFailure[],
): void {
  const version = stringField(manifest, 'api_contract_version', 'manifest.api_contract_version', failures);
  if (!version) {
    return;
  }

  if (!API_CONTRACT_VERSION_PATTERN.test(version)) {
    addFailure(failures, 'manifest.api_contract_version', `api_contract_version must use vN; actual ${version}`);
    return;
  }

  if (!policy.supportedApiContractVersions.has(version)) {
    addFailure(
      failures,
      'manifest.api_contract_version',
      `api_contract_version is not supported by AgentSmith ASBCP adoption policy; supported ${Array.from(policy.supportedApiContractVersions).join(', ')}; actual ${version}`,
    );
  }
}

function checkDigestEvidenceField(
  object: JsonObject,
  key: string,
  field: string,
  expectedDigest: string | null,
  failures: AsbcpManifestLockFailure[],
  sourceLabel: string,
): void {
  const digest = stringField(object, key, field, failures, sourceLabel);
  if (!digest) {
    return;
  }
  const normalizedDigest = normalizeDigest(digest);
  if (!DIGEST_PATTERN.test(normalizedDigest)) {
    addFailure(failures, field, `${key} must be sha256:<64 hex>; actual ${digest}`);
    return;
  }
  if (expectedDigest && normalizedDigest !== expectedDigest) {
    addFailure(failures, field, `${key} must match manifest image_digest; ${expectedActualMessage(expectedDigest, normalizedDigest)}`);
  }
}

function checkSameDigestProof(manifest: JsonObject, failures: AsbcpManifestLockFailure[]): void {
  const proof = objectField(manifest, 'same_digest_proof', 'manifest.same_digest_proof', failures);
  if (!proof) {
    return;
  }

  const expectedDigest = normalizedStringValue(manifest, 'image_digest');
  checkDigestEvidenceField(
    proof,
    'tag_resolved_digest',
    'manifest.same_digest_proof.tag_resolved_digest',
    expectedDigest,
    failures,
    'same_digest_proof',
  );
  checkDigestEvidenceField(
    proof,
    'build_push_digest',
    'manifest.same_digest_proof.build_push_digest',
    expectedDigest,
    failures,
    'same_digest_proof',
  );
  checkDigestEvidenceField(
    proof,
    'anonymous_digest',
    'manifest.same_digest_proof.anonymous_digest',
    expectedDigest,
    failures,
    'same_digest_proof',
  );

  if (proof.matches !== true) {
    addFailure(
      failures,
      'manifest.same_digest_proof.matches',
      `same_digest_proof.matches must be true; actual ${actualFieldValue(proof.matches)}`,
    );
  }
  stringField(proof, 'source', 'manifest.same_digest_proof.source', failures, 'same_digest_proof');
}

function checkAnonymousPull(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const anonymousPull = objectField(manifest, 'anonymous_pull', 'manifest.anonymous_pull', failures);
  if (!anonymousPull) {
    return;
  }

  const expectedDigest = normalizedStringValue(manifest, 'image_digest');
  const expectedImageRef = normalizedStringValue(manifest, 'image_ref');
  const expectedTagRef = `${CANONICAL_REPO}:${lock.version}`;
  const result = stringField(anonymousPull, 'result', 'manifest.anonymous_pull.result', failures, 'anonymous_pull');
  const tagRef = stringField(anonymousPull, 'tag_ref', 'manifest.anonymous_pull.tag_ref', failures, 'anonymous_pull');
  const imageRef = stringField(anonymousPull, 'image_ref', 'manifest.anonymous_pull.image_ref', failures, 'anonymous_pull');

  if (result && result !== 'ok') {
    addFailure(failures, 'manifest.anonymous_pull.result', `anonymous_pull.result must be ok; actual ${result}`);
  }
  if (tagRef && tagRef !== expectedTagRef) {
    addFailure(
      failures,
      'manifest.anonymous_pull.tag_ref',
      `anonymous_pull.tag_ref must match release tag; ${expectedActualMessage(expectedTagRef, tagRef)}`,
    );
  }
  if (imageRef && expectedImageRef && imageRef !== expectedImageRef) {
    addFailure(
      failures,
      'manifest.anonymous_pull.image_ref',
      `anonymous_pull.image_ref must match manifest image_ref; ${expectedActualMessage(expectedImageRef, imageRef)}`,
    );
  }

  checkDigestEvidenceField(
    anonymousPull,
    'tag_resolved_digest',
    'manifest.anonymous_pull.tag_resolved_digest',
    expectedDigest,
    failures,
    'anonymous_pull',
  );
  checkDigestEvidenceField(
    anonymousPull,
    'build_push_digest',
    'manifest.anonymous_pull.build_push_digest',
    expectedDigest,
    failures,
    'anonymous_pull',
  );
  checkDigestEvidenceField(
    anonymousPull,
    'anonymous_digest',
    'manifest.anonymous_pull.anonymous_digest',
    expectedDigest,
    failures,
    'anonymous_pull',
  );

  const dockerConfig = stringField(
    anonymousPull,
    'docker_config',
    'manifest.anonymous_pull.docker_config',
    failures,
    'anonymous_pull',
  );
  if (dockerConfig && dockerConfig !== 'fresh-empty') {
    addFailure(
      failures,
      'manifest.anonymous_pull.docker_config',
      `anonymous_pull.docker_config must be fresh-empty; actual ${dockerConfig}`,
    );
  }

  const commands = arrayField(anonymousPull, 'commands', 'manifest.anonymous_pull.commands', failures, 'anonymous_pull');
  if (commands && commands.length < 2) {
    addFailure(failures, 'manifest.anonymous_pull.commands', 'anonymous_pull.commands must include at least tag and digest pulls');
  }
  commands?.forEach((command, index) => {
    if (typeof command !== 'string' || command.trim().length === 0) {
      addFailure(
        failures,
        `manifest.anonymous_pull.commands[${index}]`,
        `anonymous_pull.commands[${index}] must be a non-empty string; actual ${actualFieldValue(command)}`,
      );
    }
  });
}

function checkKnownBreakingChanges(
  manifest: JsonObject,
  policy: AsbcpAdoptionPolicy,
  currentDate: string,
  failures: AsbcpManifestLockFailure[],
): void {
  const changes = arrayField(manifest, 'known_breaking_changes', 'manifest.known_breaking_changes', failures);
  if (!changes) {
    return;
  }

  const seen = new Set<string>();
  changes.forEach((change, index) => {
    const baseField = `manifest.known_breaking_changes[${index}]`;
    if (!isJsonObject(change)) {
      addFailure(failures, baseField, `known_breaking_changes[${index}] must be an object; actual ${actualFieldValue(change)}`);
      return;
    }

    rejectUnexpectedKeys(change, KNOWN_BREAKING_CHANGE_KEYS, baseField, failures);
    const id = stringField(change, 'id', `${baseField}.id`, failures, 'known_breaking_changes entry');
    stringField(change, 'summary', `${baseField}.summary`, failures, 'known_breaking_changes entry');

    if (id && !BREAKING_CHANGE_ID_PATTERN.test(id)) {
      addFailure(failures, `${baseField}.id`, `id must use ASBCP-BC-0000 format; actual ${id}`);
    }
    if (id && seen.has(id)) {
      addFailure(failures, `${baseField}.id`, `known_breaking_changes must not duplicate ${id}`);
    }
    if (id) {
      seen.add(id);
    }

    const allowance = id ? policy.breakingChangesAllowlist.get(id) : undefined;
    if (id && !allowance) {
      addFailure(
        failures,
        `${baseField}.id`,
        `breaking change ${id} is not in AgentSmith ASBCP adoption allowlist`,
      );
      return;
    }

    // The stable breaking-change ID gates adoption; summary text is retained as human review context.
    if (allowance && allowance.expiresOn < currentDate) {
      addFailure(
        failures,
        `${baseField}.id`,
        `breaking change ${allowance.id} allowlist entry expired on ${allowance.expiresOn}; current date ${currentDate}`,
      );
    }
  });
}

function checkReleaseMetadata(manifest: JsonObject, failures: AsbcpManifestLockFailure[]): void {
  stringField(manifest, 'changelog_summary', 'manifest.changelog_summary', failures);
  stringField(manifest, 'known_risk_status', 'manifest.known_risk_status', failures);
  const knownRiskStatusSource = stringField(
    manifest,
    'known_risk_status_source',
    'manifest.known_risk_status_source',
    failures,
  );
  const runbookUrl = stringField(manifest, 'runbook_url', 'manifest.runbook_url', failures);
  const releaseNotes = objectField(manifest, 'release_notes', 'manifest.release_notes', failures);
  const releaseGate = stringField(manifest, 'release_gate', 'manifest.release_gate', failures);

  if (knownRiskStatusSource && knownRiskStatusSource !== KNOWN_RISK_STATUS_SOURCE) {
    addFailure(
      failures,
      'manifest.known_risk_status_source',
      `known_risk_status_source must be ${KNOWN_RISK_STATUS_SOURCE}; actual ${knownRiskStatusSource}`,
    );
  }
  if (runbookUrl && !isUri(runbookUrl)) {
    addFailure(failures, 'manifest.runbook_url', `runbook_url must be a URI; actual ${runbookUrl}`);
  }
  if (releaseNotes) {
    rejectUnexpectedKeys(
      releaseNotes,
      new Set(['body_source', 'github_release_url']),
      'manifest.release_notes',
      failures,
    );
    const bodySource = stringField(
      releaseNotes,
      'body_source',
      'manifest.release_notes.body_source',
      failures,
      'release_notes',
    );
    const githubReleaseUrl = stringField(
      releaseNotes,
      'github_release_url',
      'manifest.release_notes.github_release_url',
      failures,
      'release_notes',
    );
    if (bodySource && bodySource.trim().length === 0) {
      addFailure(failures, 'manifest.release_notes.body_source', 'release_notes.body_source must be non-empty');
    }
    if (githubReleaseUrl && !isUri(githubReleaseUrl)) {
      addFailure(
        failures,
        'manifest.release_notes.github_release_url',
        `release_notes.github_release_url must be a URI; actual ${githubReleaseUrl}`,
      );
    }
  }
  if (releaseGate && releaseGate !== RELEASE_GATE) {
    addFailure(failures, 'manifest.release_gate', `release_gate must be ${RELEASE_GATE}; actual ${releaseGate}`);
  }
}

function checkManifestAgainstLock(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  policy: AsbcpAdoptionPolicy,
  currentDate: string,
  failures: AsbcpManifestLockFailure[],
): void {
  rejectUnexpectedKeys(manifest, FINAL_MANIFEST_TOP_LEVEL_KEYS, 'manifest', failures);
  checkManifestSchema(manifest, policy, failures);
  checkManifestVersion(manifest, lock, failures);
  checkManifestCommit(manifest, lock, failures);
  checkManifestImage(manifest, lock, failures);
  checkManifestImageDigest(manifest, lock, failures);
  checkApiContractVersion(manifest, policy, failures);
  checkAnonymousPull(manifest, lock, failures);
  checkSameDigestProof(manifest, failures);
  checkKnownBreakingChanges(manifest, policy, currentDate, failures);
  checkReleaseMetadata(manifest, failures);
}

export function checkAsbcpManifestLock(options: {
  manifestPath?: string;
  lockPath?: string;
  policyPath?: string;
  currentDate?: string | Date;
} = {}): AsbcpManifestLockResult {
  const failures: AsbcpManifestLockFailure[] = [];

  if (!options.manifestPath) {
    addFailure(failures, 'cli.manifest', 'missing required --manifest <path>');
    return { ok: false, failures };
  }

  const manifestPath = resolve(options.manifestPath);
  const lockPath = resolve(options.lockPath ?? DEFAULT_LOCK_PATH);
  const policyPath = resolve(options.policyPath ?? DEFAULT_POLICY_PATH);
  const currentDate = dateOnly(options.currentDate);
  const manifestSource = readTextFile(manifestPath, 'manifest.path', failures);
  const lockSource = readTextFile(lockPath, 'lock.path', failures);
  const policySource = readTextFile(policyPath, 'policy.path', failures);

  if (manifestSource === null || lockSource === null || policySource === null) {
    return { ok: failures.length === 0, failures };
  }

  const manifest = parseJsonObject(manifestSource, manifestPath, failures);
  const lock = parseLock(lockSource, lockPath, failures);
  const policy = parsePolicy(policySource, policyPath, failures);

  if (manifest && lock && policy) {
    checkManifestAgainstLock(manifest, lock, policy, currentDate, failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function formatAsbcpManifestLockFailures(failures: readonly AsbcpManifestLockFailure[]): string {
  return failures.map((failure) => `${failure.field}: ${failure.message}`).join('\n');
}

function usage(): string {
  return [
    'Usage: npm run contracts:check-asbcp-manifest-lock -- --manifest <path> [--lock <path>] [--policy <path>]',
    `       or ${FINAL_MANIFEST_ENV}=<path> npm run contracts:check-asbcp-adoption`,
    '',
    `Default --lock: ${DEFAULT_LOCK_PATH}`,
    `Default --policy: ${DEFAULT_POLICY_PATH}`,
  ].join('\n');
}

function parseCliArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    failures: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--manifest') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.manifest', 'missing value for --manifest <path>');
        continue;
      }
      options.manifestPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length);
      continue;
    }

    if (arg === '--lock') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.lock', 'missing value for --lock <path>');
        continue;
      }
      options.lockPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--lock=')) {
      options.lockPath = arg.slice('--lock='.length);
      continue;
    }

    if (arg === '--policy') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.policy', 'missing value for --policy <path>');
        continue;
      }
      options.policyPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--policy=')) {
      options.policyPath = arg.slice('--policy='.length);
      continue;
    }

    addFailure(options.failures, 'cli.arguments', `unknown argument ${arg}`);
  }

  if (!options.manifestPath && !options.help) {
    const envManifestPath = process.env[FINAL_MANIFEST_ENV]?.trim();
    if (envManifestPath) {
      options.manifestPath = envManifestPath;
    }
  }

  if (!options.manifestPath && !options.help) {
    addFailure(options.failures, 'cli.manifest', `missing required --manifest <path> or ${FINAL_MANIFEST_ENV}=<path>`);
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    process.stdout.write(`${usage()}\n`);
  } else if (cliOptions.failures.length > 0) {
    process.stderr.write(`[contracts] ASBCP manifest/lock check failed\n${formatAsbcpManifestLockFailures(cliOptions.failures)}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    const result = checkAsbcpManifestLock({
      manifestPath: cliOptions.manifestPath,
      lockPath: cliOptions.lockPath,
      policyPath: cliOptions.policyPath,
    });

    if (!result.ok) {
      process.stderr.write(`[contracts] ASBCP manifest/lock check failed\n${formatAsbcpManifestLockFailures(result.failures)}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('[contracts] ASBCP manifest/lock check passed\n');
    }
  }
}
