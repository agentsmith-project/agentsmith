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

type CliOptions = {
  manifestPath?: string;
  lockPath?: string;
  help: boolean;
  failures: AsbcpManifestLockFailure[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOCK_PATH = resolve(REPO_ROOT, 'infra/deploy/shared/asbcp-image.lock');
const CANONICAL_REPO = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const RELEASE_URL_PREFIX = 'https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/';
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;
const DIGEST_PATTERN = /^sha256:[a-fA-F0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const SUCCESS_RESULTS = new Set(['ok', 'success', 'pass', 'passed', 'true']);

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

function parseJsonObject(source: string, sourceName: string, failures: AsbcpManifestLockFailure[]): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    addFailure(
      failures,
      'manifest',
      `failed to parse ${sourceName} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!isJsonObject(parsed)) {
    addFailure(failures, 'manifest', `${sourceName} must be a JSON object`);
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
): string | null {
  const value = object[key];
  if (value === undefined) {
    addFailure(failures, field, `manifest must include ${key}`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    addFailure(failures, field, `${key} must be a non-empty string; actual ${actualFieldValue(value)}`);
    return null;
  }
  return value.trim();
}

function optionalStringField(
  object: JsonObject,
  key: string,
  field: string,
  failures: AsbcpManifestLockFailure[],
): string | null {
  const value = object[key];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    addFailure(failures, field, `${key} must be a non-empty string when present; actual ${actualFieldValue(value)}`);
    return null;
  }
  return value.trim();
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

function checkManifestVersion(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const asbcpVersion = optionalStringField(manifest, 'asbcp_version', 'manifest.asbcp_version', failures);
  const gitTag = optionalStringField(manifest, 'git_tag', 'manifest.git_tag', failures);
  const versions = [asbcpVersion, gitTag].filter((value): value is string => value !== null);

  if (versions.length === 0) {
    addFailure(failures, 'manifest.version', 'manifest must include asbcp_version or git_tag');
    return;
  }

  if (asbcpVersion !== null && asbcpVersion !== lock.version) {
    addFailure(
      failures,
      'manifest.version',
      `asbcp_version must match lock version; expected ${lock.version}; actual asbcp_version=${actualFieldValue(manifest.asbcp_version)}, git_tag=${actualFieldValue(manifest.git_tag)}`,
    );
  }
  if (gitTag !== null && gitTag !== lock.version) {
    addFailure(
      failures,
      'manifest.version',
      `git_tag must match lock version; expected ${lock.version}; actual asbcp_version=${actualFieldValue(manifest.asbcp_version)}, git_tag=${actualFieldValue(manifest.git_tag)}`,
    );
  }
  if (asbcpVersion !== null && gitTag !== null && asbcpVersion !== gitTag) {
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
  const imageRef = optionalStringField(manifest, 'image_ref', 'manifest.image_ref', failures);
  const image = imageRef ?? optionalStringField(manifest, 'image', 'manifest.image', failures);

  if (!image) {
    addFailure(failures, 'manifest.image_ref', 'manifest must include image_ref or image');
    return;
  }

  const parsedImage = parseImageRef(image, imageRef ? 'manifest.image_ref' : 'manifest.image', failures);
  if (!parsedImage) {
    return;
  }

  const field = imageRef ? 'manifest.image_ref' : 'manifest.image';
  if (parsedImage.repo !== CANONICAL_REPO) {
    return;
  }
  if (parsedImage.tag !== lock.version) {
    addFailure(
      failures,
      field,
      `image tag must match lock version; ${expectedActualMessage(lock.version, parsedImage.tag)}`,
    );
  }
  if (parsedImage.digest !== lock.image.digest) {
    addFailure(
      failures,
      field,
      `image digest must match lock digest; ${expectedActualMessage(lock.image.digest, parsedImage.digest)}`,
    );
  }
}

function checkManifestImageDigest(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  const digest = optionalStringField(manifest, 'image_digest', 'manifest.image_digest', failures);
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
}

function checkSameDigestProof(manifest: JsonObject, failures: AsbcpManifestLockFailure[]): void {
  const proof = manifest.same_digest_proof;
  if (proof === undefined) {
    return;
  }
  if (!isJsonObject(proof) || proof.matches !== true) {
    addFailure(
      failures,
      'manifest.same_digest_proof.matches',
      `same_digest_proof.matches must be true when present; actual ${isJsonObject(proof) ? actualFieldValue(proof.matches) : actualFieldValue(proof)}`,
    );
  }
}

function isAnonymousPullSuccess(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return SUCCESS_RESULTS.has(value.trim().toLowerCase());
}

function checkAnonymousPull(manifest: JsonObject, failures: AsbcpManifestLockFailure[]): void {
  const anonymousPull = manifest.anonymous_pull;
  if (!isJsonObject(anonymousPull) || anonymousPull.result === undefined) {
    return;
  }

  if (!isAnonymousPullSuccess(anonymousPull.result)) {
    addFailure(
      failures,
      'manifest.anonymous_pull.result',
      `anonymous_pull.result must be ok/success/pass/passed/true when present; actual ${actualFieldValue(anonymousPull.result)}`,
    );
  }
}

function checkManifestAgainstLock(
  manifest: JsonObject,
  lock: AsbcpImageLock,
  failures: AsbcpManifestLockFailure[],
): void {
  checkManifestVersion(manifest, lock, failures);
  checkManifestCommit(manifest, lock, failures);
  checkManifestImage(manifest, lock, failures);
  checkManifestImageDigest(manifest, lock, failures);
  checkSameDigestProof(manifest, failures);
  checkAnonymousPull(manifest, failures);
}

export function checkAsbcpManifestLock(options: {
  manifestPath?: string;
  lockPath?: string;
} = {}): AsbcpManifestLockResult {
  const failures: AsbcpManifestLockFailure[] = [];

  if (!options.manifestPath) {
    addFailure(failures, 'cli.manifest', 'missing required --manifest <path>');
    return { ok: false, failures };
  }

  const manifestPath = resolve(options.manifestPath);
  const lockPath = resolve(options.lockPath ?? DEFAULT_LOCK_PATH);
  const manifestSource = readTextFile(manifestPath, 'manifest.path', failures);
  const lockSource = readTextFile(lockPath, 'lock.path', failures);

  if (manifestSource === null || lockSource === null) {
    return { ok: failures.length === 0, failures };
  }

  const manifest = parseJsonObject(manifestSource, manifestPath, failures);
  const lock = parseLock(lockSource, lockPath, failures);

  if (manifest && lock) {
    checkManifestAgainstLock(manifest, lock, failures);
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
    'Usage: npm run contracts:check-asbcp-manifest-lock -- --manifest <path> [--lock <path>]',
    '',
    `Default --lock: ${DEFAULT_LOCK_PATH}`,
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

    addFailure(options.failures, 'cli.arguments', `unknown argument ${arg}`);
  }

  if (!options.manifestPath && !options.help) {
    addFailure(options.failures, 'cli.manifest', 'missing required --manifest <path>');
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
    });

    if (!result.ok) {
      process.stderr.write(`[contracts] ASBCP manifest/lock check failed\n${formatAsbcpManifestLockFailures(result.failures)}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('[contracts] ASBCP manifest/lock check passed\n');
    }
  }
}
