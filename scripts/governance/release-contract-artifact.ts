import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENTSMITH_CANONICAL_REPO,
  RUNNER_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  parseRunnerImageLockText,
  sha256Digest,
  validateRunnerReleaseManifest,
  type CurrentArtifactProvenance,
  type CurrentRunnerImageLock,
  type CurrentRunnerReleaseManifest,
} from './current-release-boundary-schema';
import {
  assembleAgentSmithReleaseContractFromInput,
} from './release-contract-assemble';
import type {
  AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from './release-contract-input';
import type {
  AgentSmithReleaseContractCiProvenanceInput,
} from './release-contract';
import {
  checkRunnerImageLock,
  formatRunnerImageLockFailures,
} from '../contracts/check-runner-image-lock';
import {
  checkAsbcpManifestLock,
  formatAsbcpManifestLockFailures,
} from '../contracts/check-asbcp-manifest-lock';

export const RELEASE_CONTRACT_ARTIFACT_NAME = 'agentsmith-release-contract.json' as const;
export const RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME = 'runner-release-manifest-source.json' as const;
export const ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME = 'asbcp-final-manifest-source.json' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_COMMAND = 'npm run release:contract:ci-artifact' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_VERSION = 'p1.1-release-contract-artifact' as const;
export const RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.runner-release-manifest-source/v1' as const;
export const ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.asbcp-final-manifest-source/v1' as const;

const DEFAULT_OUTPUT_DIR = 'artifacts/release-contract';
const RUNNER_IMAGE_LOCK_RELATIVE_PATH =
  'scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock' as const;
const RUNNER_RELEASE_MANIFEST_RELATIVE_PATH =
  'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json' as const;
const RUNNER_REPO_SLUG = 'agentsmith-project/agentsmith-runner' as const;
const ASBCP_IMAGE_LOCK_RELATIVE_PATH = 'infra/deploy/shared/asbcp-image.lock' as const;
const ASBCP_REPO_SLUG = 'agentsmith-project/agentsmith-sandbox-control-plane' as const;
const ASBCP_CANONICAL_REPO = `github.com/${ASBCP_REPO_SLUG}` as const;
const ASBCP_RELEASE_URL_PREFIX =
  `https://github.com/${ASBCP_REPO_SLUG}/releases/tag/` as const;
const ASBCP_FINAL_MANIFEST_ASSET_NAME = 'asbcp-final-manifest.json' as const;
const RUNNER_RELEASE_MANIFEST_ADOPTION_COMMAND =
  `npm run contracts:check-runner-image-lock -- --adoption --manifest ${RUNNER_RELEASE_MANIFEST_RELATIVE_PATH}` as const;
const PRODUCER_OWNED_INPUT_FIELDS = ['sourceGitSha', 'ci_provenance', 'runnerImageLock'] as const;
type ProducerOwnedInputField = typeof PRODUCER_OWNED_INPUT_FIELDS[number];
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z]+)*$/u;

interface ReleaseContractArtifactCliOptions {
  argv?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface ReleaseContractArtifactCliConfig {
  inputPath: string;
  outputDir: string;
  runnerManifestPath: string;
  runnerRemoteManifestPath: string;
  runnerRunViewPath: string;
  runnerRunApiPath: string;
  runnerArtifactsApiPath: string;
  asbcpFinalManifestPath: string;
  asbcpReleaseApiPath: string;
  asbcpAssetApiPath: string;
}

interface GitHubCiProvenanceEnv {
  commitSha: string;
  repositorySlug: string;
  canonicalRepo: typeof AGENTSMITH_CANONICAL_REPO;
  workflowName: string;
  runId: string;
  runAttempt: string;
  job: string;
  generatedAt: string;
}

type ReleaseContractArtifactProducerInput = Omit<
  AgentSmithReleaseContractGeneratorInputAssemblyInput,
  ProducerOwnedInputField
> & Partial<Pick<AgentSmithReleaseContractGeneratorInputAssemblyInput, ProducerOwnedInputField>>;

interface RunnerReleaseManifestSourceReceipt {
  schema_version: typeof RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION;
  source_kind: 'github_actions_artifact';
  producer_repo: typeof RUNNER_CANONICAL_REPO;
  producer_repo_slug: typeof RUNNER_REPO_SLUG;
  manifest_path: typeof RUNNER_RELEASE_MANIFEST_RELATIVE_PATH;
  manifest_digest_kind: 'stable_json_canonical_sha256';
  local_manifest_canonical_sha256: string;
  remote_manifest_canonical_sha256: string;
  manifest_canonical_digest_match: true;
  manifest_release_id: string;
  manifest_git_sha: string;
  manifest_subject_sha256: string;
  manifest_provenance_artifact_sha256: string;
  run_id: string;
  run_attempt: string;
  workflow_name: string;
  workflow_status: string;
  workflow_conclusion: string;
  head_sha: string;
  run_url: string;
  artifact_name: string;
  artifact_id: number;
  artifact_url: string;
  artifact_archive_download_url: string | null;
  artifact_expired: false;
  expires_at: string;
  remote_artifact_zip_digest: string | null;
  remote_artifact_zip_digest_source: 'github_actions_artifact.digest' | 'not_provided_by_github';
  adoption_gate: {
    command: typeof RUNNER_RELEASE_MANIFEST_ADOPTION_COMMAND;
    lock_path: typeof RUNNER_IMAGE_LOCK_RELATIVE_PATH;
    manifest_path: typeof RUNNER_RELEASE_MANIFEST_RELATIVE_PATH;
    ok: true;
  };
  consumer: {
    repo: typeof AGENTSMITH_CANONICAL_REPO;
    workflow_name: string;
    run_id: string;
    run_attempt: string;
    job: string;
    commit_sha: string;
  };
  generated_at: string;
}

interface AsbcpImageLockSource {
  version: string;
  sourceImage: string;
  releaseUrl: string;
  commitSha: string;
}

interface AsbcpFinalManifestSourceReceipt {
  schema_version: typeof ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION;
  source_kind: 'github_release_asset';
  producer_repo: typeof ASBCP_CANONICAL_REPO;
  producer_repo_slug: typeof ASBCP_REPO_SLUG;
  lock_path: typeof ASBCP_IMAGE_LOCK_RELATIVE_PATH;
  lock_source_image: string;
  lock_commit_sha: string;
  manifest_path: string;
  release_url: string;
  release_tag: string;
  release_id: number;
  release_api_url: string;
  release_html_url: string;
  release_target_commitish: string | null;
  release_created_at: string | null;
  release_published_at: string | null;
  release_updated_at: string | null;
  asset_id: number;
  asset_name: typeof ASBCP_FINAL_MANIFEST_ASSET_NAME;
  asset_url: string;
  asset_browser_download_url: string;
  asset_content_type: string | null;
  asset_size: number | null;
  asset_created_at: string;
  asset_updated_at: string;
  api_asset_digest: string | null;
  api_asset_digest_source: 'github_release_asset.digest' | 'not_provided_by_github';
  downloaded_manifest_sha256: string;
  api_asset_digest_match: true | null;
  adoption_gate: {
    command: string;
    lock_path: typeof ASBCP_IMAGE_LOCK_RELATIVE_PATH;
    manifest_path: string;
    ok: true;
  };
  consumer: {
    repo: typeof AGENTSMITH_CANONICAL_REPO;
    workflow_name: string;
    run_id: string;
    run_attempt: string;
    job: string;
    commit_sha: string;
  };
  generated_at: string;
}

export function runReleaseContractArtifactCli(options: ReleaseContractArtifactCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));
  let outputPath: string | undefined;
  let runnerManifestReceiptPath: string | undefined;
  let asbcpFinalManifestReceiptPath: string | undefined;

  try {
    const config = parseCliArgs(argv, cwd, env);
    outputPath = path.join(config.outputDir, RELEASE_CONTRACT_ARTIFACT_NAME);
    runnerManifestReceiptPath = path.join(config.outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    asbcpFinalManifestReceiptPath = path.join(config.outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);
    const runnerManifestRelativePath = assertCanonicalRunnerManifestPath(cwd, config.runnerManifestPath);
    assertCanonicalRunnerManifestAdoption(cwd, config.runnerManifestPath);
    const runnerReleaseManifest = readCanonicalRunnerReleaseManifest(config.runnerManifestPath);
    const remoteRunnerReleaseManifest = readRemoteRunnerReleaseManifest(config.runnerRemoteManifestPath);
    const asbcpImageLock = readCanonicalAsbcpImageLockSource(cwd);
    const asbcpManifestRelativePath = toPortableRelativePath(
      cwd,
      config.asbcpFinalManifestPath,
      'ASBCP final manifest source',
    );
    const input = readInput(config.inputPath);
    assertNoProducerOwnedInputFields(input);
    const runnerImageLock = readCanonicalRunnerImageLock(cwd);
    const ciEnv = resolveGitHubCiProvenanceEnv(env);
    const ciProvenance = buildCiProvenance(ciEnv);
    const runnerManifestReceipt = buildRunnerReleaseManifestSourceReceipt({
      ciEnv,
      manifest: runnerReleaseManifest,
      manifestRelativePath: runnerManifestRelativePath,
      remoteManifest: remoteRunnerReleaseManifest,
      runViewPath: config.runnerRunViewPath,
      runApiPath: config.runnerRunApiPath,
      artifactsApiPath: config.runnerArtifactsApiPath,
    });
    const asbcpFinalManifestReceipt = buildAsbcpFinalManifestSourceReceipt({
      ciEnv,
      imageLock: asbcpImageLock,
      manifestPath: config.asbcpFinalManifestPath,
      manifestRelativePath: asbcpManifestRelativePath,
      releaseApiPath: config.asbcpReleaseApiPath,
      assetApiPath: config.asbcpAssetApiPath,
      cwd,
    });
    const contract = assembleAgentSmithReleaseContractFromInput(
      {
        ...input,
        runnerImageLock,
        sourceGitSha: ciEnv.commitSha,
        ci_provenance: ciProvenance,
      },
      {
        sourceGitSha: ciEnv.commitSha,
      },
    );

    writeJsonAtomically(outputPath, contract);
    writeJsonAtomically(runnerManifestReceiptPath, runnerManifestReceipt);
    writeJsonAtomically(asbcpFinalManifestReceiptPath, asbcpFinalManifestReceipt);
    stdout(`release contract artifact: ${outputPath}`);
    stdout(`runner release manifest source receipt: ${runnerManifestReceiptPath}`);
    stdout(`ASBCP final manifest source receipt: ${asbcpFinalManifestReceiptPath}`);
    return 0;
  } catch (error) {
    if (outputPath) {
      rmSync(outputPath, { force: true });
    }
    if (runnerManifestReceiptPath) {
      rmSync(runnerManifestReceiptPath, { force: true });
    }
    if (asbcpFinalManifestReceiptPath) {
      rmSync(asbcpFinalManifestReceiptPath, { force: true });
    }
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readInput(inputPath: string): ReleaseContractArtifactProducerInput {
  return JSON.parse(readFileSync(inputPath, 'utf8')) as ReleaseContractArtifactProducerInput;
}

function readJson(pathName: string): unknown {
  return JSON.parse(readFileSync(pathName, 'utf8')) as unknown;
}

function readCanonicalRunnerImageLock(rootDir: string): CurrentRunnerImageLock {
  const lockPath = path.join(rootDir, RUNNER_IMAGE_LOCK_RELATIVE_PATH);
  if (!existsSync(lockPath)) {
    throw new Error('runnerImageLock must be provided by canonical agentsmith-runner-image.lock.');
  }

  const result = parseRunnerImageLockText(
    readFileSync(lockPath, 'utf8'),
    RUNNER_IMAGE_LOCK_RELATIVE_PATH,
  );

  if (!result.ok) {
    const details = result.failures
      .map((failure) => `${failure.path}: ${failure.reason}`)
      .join('\n');
    throw new Error(
      `runnerImageLock must be provided by canonical agentsmith-runner-image.lock.\n${details}`,
    );
  }

  return result.value;
}

function readCanonicalAsbcpImageLockSource(rootDir: string): AsbcpImageLockSource {
  const lockPath = path.join(rootDir, ASBCP_IMAGE_LOCK_RELATIVE_PATH);
  if (!existsSync(lockPath)) {
    throw new Error(`ASBCP image lock must be provided by canonical ${ASBCP_IMAGE_LOCK_RELATIVE_PATH}.`);
  }

  const values = parseKeyValueText(readFileSync(lockPath, 'utf8'), ASBCP_IMAGE_LOCK_RELATIVE_PATH);
  const version = requireKeyValue(values, 'asbcp_version', ASBCP_IMAGE_LOCK_RELATIVE_PATH);
  const sourceImage = requireKeyValue(values, 'asbcp_source_image', ASBCP_IMAGE_LOCK_RELATIVE_PATH);
  const releaseUrl = requireKeyValue(values, 'asbcp_release_url', ASBCP_IMAGE_LOCK_RELATIVE_PATH);
  const commitSha = requireKeyValue(values, 'asbcp_commit_sha', ASBCP_IMAGE_LOCK_RELATIVE_PATH);

  if (!RELEASE_TAG_PATTERN.test(version)) {
    throw new Error(`ASBCP image lock asbcp_version must be a release tag; actual ${version}.`);
  }
  if (releaseUrl !== `${ASBCP_RELEASE_URL_PREFIX}${version}`) {
    throw new Error(
      `ASBCP image lock asbcp_release_url must match asbcp_version; expected ${ASBCP_RELEASE_URL_PREFIX}${version}; actual ${releaseUrl}.`,
    );
  }

  return {
    version,
    sourceImage,
    releaseUrl,
    commitSha,
  };
}

function parseKeyValueText(source: string, sourceName: string): Map<string, string> {
  const values = new Map<string, string>();

  source.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      return;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`${sourceName}:${index + 1} must be key=value.`);
    }

    const key = line.slice(0, separatorIndex).trim();
    if (values.has(key)) {
      throw new Error(`${sourceName}:${index + 1} must not duplicate ${key}.`);
    }
    values.set(key, line.slice(separatorIndex + 1).trim());
  });

  return values;
}

function requireKeyValue(values: ReadonlyMap<string, string>, key: string, sourceName: string): string {
  const value = values.get(key);
  if (!value) {
    throw new Error(`${sourceName} must include ${key}.`);
  }

  return value;
}

function readCanonicalRunnerReleaseManifest(manifestPath: string): CurrentRunnerReleaseManifest {
  return readValidatedRunnerReleaseManifest(manifestPath, 'runner release manifest source');
}

function readRemoteRunnerReleaseManifest(manifestPath: string): CurrentRunnerReleaseManifest {
  return readValidatedRunnerReleaseManifest(
    manifestPath,
    'remote runner release manifest artifact content',
  );
}

function readValidatedRunnerReleaseManifest(
  manifestPath: string,
  label: string,
): CurrentRunnerReleaseManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`${label} must exist: ${manifestPath}`);
  }

  const result = validateRunnerReleaseManifest(readJson(manifestPath));
  if (!result.ok) {
    const details = result.failures
      .map((failure) => `${failure.path}: ${failure.reason}`)
      .join('\n');
    throw new Error(`${label} is invalid.\n${details}`);
  }

  return result.value;
}

function assertCanonicalRunnerManifestPath(
  cwd: string,
  manifestPath: string,
): typeof RUNNER_RELEASE_MANIFEST_RELATIVE_PATH {
  const relativePath = toPortableRelativePath(cwd, manifestPath);
  if (relativePath !== RUNNER_RELEASE_MANIFEST_RELATIVE_PATH) {
    throw new Error(
      `runner release manifest source must be ${RUNNER_RELEASE_MANIFEST_RELATIVE_PATH}.`,
    );
  }

  return RUNNER_RELEASE_MANIFEST_RELATIVE_PATH;
}

function assertCanonicalRunnerManifestAdoption(cwd: string, manifestPath: string): void {
  const result = checkRunnerImageLock({
    lockPath: path.join(cwd, RUNNER_IMAGE_LOCK_RELATIVE_PATH),
    manifestPath,
    requireManifest: true,
  });

  if (!result.ok) {
    throw new Error(
      `runner release manifest adoption gate failed:\n${formatRunnerImageLockFailures(result.failures)}`,
    );
  }
}

function parseCliArgs(
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): ReleaseContractArtifactCliConfig {
  let inputPath: string | undefined;
  let outputDir: string | undefined;
  let runnerManifestPath: string | undefined;
  let runnerRemoteManifestPath: string | undefined;
  let runnerRunViewPath: string | undefined;
  let runnerRunApiPath: string | undefined;
  let runnerArtifactsApiPath: string | undefined;
  let asbcpFinalManifestPath: string | undefined;
  let asbcpReleaseApiPath: string | undefined;
  let asbcpAssetApiPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        inputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--output-dir':
        outputDir = requireArgValue(argv, index);
        index += 1;
        break;
      case '--runner-manifest':
        runnerManifestPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--runner-remote-manifest':
        runnerRemoteManifestPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--runner-run-view':
        runnerRunViewPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--runner-run-api':
        runnerRunApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--runner-artifacts-api':
        runnerArtifactsApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--asbcp-final-manifest':
        asbcpFinalManifestPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--asbcp-release-api':
        asbcpReleaseApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--asbcp-asset-api':
        asbcpAssetApiPath = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported release contract artifact argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error('--input is required.');
  }

  return {
    inputPath: path.resolve(cwd, inputPath),
    outputDir: path.resolve(cwd, outputDir ?? DEFAULT_OUTPUT_DIR),
    runnerManifestPath: path.resolve(
      cwd,
      runnerManifestPath ?? firstNonEmptyString(env.RUNNER_RELEASE_MANIFEST) ?? RUNNER_RELEASE_MANIFEST_RELATIVE_PATH,
    ),
    runnerRemoteManifestPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        runnerRemoteManifestPath,
        env.RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH,
        '--runner-remote-manifest',
        'RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH',
      ),
    ),
    runnerRunViewPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        runnerRunViewPath,
        env.RUNNER_RELEASE_MANIFEST_SOURCE_RUN_VIEW_PATH,
        '--runner-run-view',
        'RUNNER_RELEASE_MANIFEST_SOURCE_RUN_VIEW_PATH',
      ),
    ),
    runnerRunApiPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        runnerRunApiPath,
        env.RUNNER_RELEASE_MANIFEST_SOURCE_RUN_API_PATH,
        '--runner-run-api',
        'RUNNER_RELEASE_MANIFEST_SOURCE_RUN_API_PATH',
      ),
    ),
    runnerArtifactsApiPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        runnerArtifactsApiPath,
        env.RUNNER_RELEASE_MANIFEST_SOURCE_ARTIFACTS_API_PATH,
        '--runner-artifacts-api',
        'RUNNER_RELEASE_MANIFEST_SOURCE_ARTIFACTS_API_PATH',
      ),
    ),
    asbcpFinalManifestPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        asbcpFinalManifestPath,
        env.ASBCP_FINAL_MANIFEST_SOURCE_MANIFEST_PATH,
        '--asbcp-final-manifest',
        'ASBCP_FINAL_MANIFEST_SOURCE_MANIFEST_PATH',
        'ASBCP final manifest source freshness',
      ),
    ),
    asbcpReleaseApiPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        asbcpReleaseApiPath,
        env.ASBCP_FINAL_MANIFEST_SOURCE_RELEASE_API_PATH,
        '--asbcp-release-api',
        'ASBCP_FINAL_MANIFEST_SOURCE_RELEASE_API_PATH',
        'ASBCP final manifest source freshness',
      ),
    ),
    asbcpAssetApiPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        asbcpAssetApiPath,
        env.ASBCP_FINAL_MANIFEST_SOURCE_ASSET_API_PATH,
        '--asbcp-asset-api',
        'ASBCP_FINAL_MANIFEST_SOURCE_ASSET_API_PATH',
        'ASBCP final manifest source freshness',
      ),
    ),
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function requireCliOrEnvPath(
  cliValue: string | undefined,
  envValue: string | undefined,
  cliName: string,
  envName: string,
  validationLabel = 'runner release manifest source freshness',
): string {
  const value = firstNonEmptyString(cliValue, envValue);
  if (!value) {
    throw new Error(
      `${cliName} or ${envName} is required to validate ${validationLabel}.`,
    );
  }

  return value;
}

function assertNoProducerOwnedInputFields(input: ReleaseContractArtifactProducerInput): void {
  if (!isRecord(input)) {
    throw new Error('release contract artifact input must be an object.');
  }

  const failures: string[] = [];
  for (const field of PRODUCER_OWNED_INPUT_FIELDS) {
    if (Object.hasOwn(input, field)) {
      failures.push(formatProducerOwnedInputFieldFailure(field));
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

function formatProducerOwnedInputFieldFailure(field: ProducerOwnedInputField): string {
  switch (field) {
    case 'sourceGitSha':
    case 'ci_provenance':
      return `${field} must be provided by GitHub CI env.`;
    case 'runnerImageLock':
      return 'runnerImageLock must be provided by canonical agentsmith-runner-image.lock.';
  }
}

function resolveGitHubCiProvenanceEnv(
  env: Readonly<Record<string, string | undefined>>,
): GitHubCiProvenanceEnv {
  const repositorySlug = requireEnvString(env, 'GITHUB_REPOSITORY');
  const canonicalRepo = `github.com/${repositorySlug}`;
  if (canonicalRepo !== AGENTSMITH_CANONICAL_REPO) {
    throw new Error(`GITHUB_REPOSITORY must be agentsmith-project/agentsmith.`);
  }

  return {
    commitSha: requireEnvString(env, 'GITHUB_SHA'),
    repositorySlug,
    canonicalRepo,
    workflowName: requireEnvString(env, 'GITHUB_WORKFLOW'),
    runId: requireEnvString(env, 'GITHUB_RUN_ID'),
    runAttempt: requireEnvString(env, 'GITHUB_RUN_ATTEMPT'),
    job: requireEnvString(env, 'GITHUB_JOB'),
    generatedAt: firstNonEmptyString(env.AGENTSMITH_RELEASE_CONTRACT_GENERATED_AT) ?? new Date().toISOString(),
  };
}

function buildCiProvenance(env: GitHubCiProvenanceEnv): AgentSmithReleaseContractCiProvenanceInput {
  return {
    producer_repo: env.canonicalRepo,
    normalized_remote: env.canonicalRepo,
    commit_sha: env.commitSha,
    subject_uri: RELEASE_CONTRACT_ARTIFACT_NAME,
    workflow_name: env.workflowName,
    run_id: env.runId,
    run_attempt: env.runAttempt,
    job: env.job,
    artifact_uri: `gh-artifact://${env.repositorySlug}/release-contract/${env.runId}/${RELEASE_CONTRACT_ARTIFACT_NAME}`,
    generated_at: env.generatedAt,
    generator_command: RELEASE_CONTRACT_ARTIFACT_GENERATOR_COMMAND,
    generator_version: RELEASE_CONTRACT_ARTIFACT_GENERATOR_VERSION,
    attestation: 'none' satisfies CurrentArtifactProvenance['attestation'],
  };
}

function buildRunnerReleaseManifestSourceReceipt(input: {
  ciEnv: GitHubCiProvenanceEnv;
  manifest: CurrentRunnerReleaseManifest;
  manifestRelativePath: typeof RUNNER_RELEASE_MANIFEST_RELATIVE_PATH;
  remoteManifest: CurrentRunnerReleaseManifest;
  runViewPath: string;
  runApiPath: string;
  artifactsApiPath: string;
}): RunnerReleaseManifestSourceReceipt {
  const failures: string[] = [];
  const runView = readJson(input.runViewPath);
  const runApi = readJson(input.runApiPath);
  const artifactsApi = readJson(input.artifactsApiPath);

  if (!isRecord(runView)) {
    failures.push('run_view: GitHub run view metadata must be a JSON object.');
  }
  if (!isRecord(runApi)) {
    failures.push('run_api: GitHub run API metadata must be a JSON object.');
  }
  if (!isRecord(artifactsApi)) {
    failures.push('artifacts_api: GitHub artifacts metadata must be a JSON object.');
  }
  if (failures.length > 0) {
    throw new Error(formatRunnerManifestSourceFailures(failures));
  }
  const runViewRecord = runView as Record<string, unknown>;
  const runApiRecord = runApi as Record<string, unknown>;
  const artifactsApiRecord = artifactsApi as Record<string, unknown>;

  const runIdNumber = Number(input.manifest.artifact_provenance.run_id);
  const expected = {
    artifactName: input.manifest.artifact_provenance.subject_name,
    headSha: input.manifest.git_sha,
    runAttempt: input.manifest.artifact_provenance.run_attempt,
    runId: input.manifest.artifact_provenance.run_id,
    workflowName: input.manifest.artifact_provenance.workflow_name,
  };
  const localManifestCanonicalSha256 = manifestCanonicalSha256(input.manifest);
  const remoteManifestCanonicalSha256 = manifestCanonicalSha256(input.remoteManifest);

  requirePositiveInteger(runIdNumber, 'manifest.artifact_provenance.run_id', failures);
  compareString(
    remoteManifestCanonicalSha256,
    localManifestCanonicalSha256,
    'remote_manifest.canonical_sha256',
    failures,
  );
  compareNumber(readNumber(runViewRecord, 'databaseId'), runIdNumber, 'run_view.databaseId', failures);
  compareNumber(readNumber(runApiRecord, 'id'), runIdNumber, 'run_api.id', failures);
  compareString(
    readNestedString(runApiRecord, ['repository', 'full_name']),
    RUNNER_REPO_SLUG,
    'run_api.repository.full_name',
    failures,
  );
  const headRepository = readNestedString(runApiRecord, ['head_repository', 'full_name']);
  if (headRepository && headRepository !== RUNNER_REPO_SLUG) {
    failures.push(`run_api.head_repository.full_name: expected ${RUNNER_REPO_SLUG}; actual ${headRepository}`);
  }
  compareString(readString(runViewRecord, 'workflowName'), expected.workflowName, 'run_view.workflowName', failures);
  compareString(readString(runApiRecord, 'name'), expected.workflowName, 'run_api.name', failures);
  compareString(readString(runViewRecord, 'headSha'), expected.headSha, 'run_view.headSha', failures);
  compareString(readString(runApiRecord, 'head_sha'), expected.headSha, 'run_api.head_sha', failures);
  compareString(String(readNumber(runApiRecord, 'run_attempt') ?? ''), expected.runAttempt, 'run_api.run_attempt', failures);
  const runViewStatus = readString(runViewRecord, 'status');
  if (runViewStatus && runViewStatus !== 'completed') {
    failures.push(`run_view.status: expected completed; actual ${runViewStatus}`);
  }
  compareString(readString(runApiRecord, 'status'), 'completed', 'run_api.status', failures);
  compareString(readString(runViewRecord, 'conclusion'), 'success', 'run_view.conclusion', failures);
  compareString(readString(runApiRecord, 'conclusion'), 'success', 'run_api.conclusion', failures);

  const artifacts = Array.isArray(artifactsApiRecord.artifacts)
    ? artifactsApiRecord.artifacts.filter(isRecord)
    : [];
  if (!Array.isArray(artifactsApiRecord.artifacts)) {
    failures.push('artifacts_api.artifacts: GitHub artifacts metadata must include an artifacts array.');
  }
  const matchingArtifacts = artifacts.filter((artifact) => artifact.name === expected.artifactName);
  if (matchingArtifacts.length !== 1) {
    failures.push(
      `artifacts_api.artifacts: expected exactly one ${expected.artifactName} artifact; actual ${matchingArtifacts.length}`,
    );
  }
  const artifact: Record<string, unknown> = matchingArtifacts[0] ?? {};
  const artifactId = readNumber(artifact, 'id');
  const artifactUrl = readString(artifact, 'url');
  const artifactArchiveDownloadUrl = readString(artifact, 'archive_download_url');
  const expiresAt = readString(artifact, 'expires_at');
  const remoteArtifactZipDigest = firstNonEmptyString(readString(artifact, 'digest'));
  const runUrl = readString(runViewRecord, 'url') || readString(runApiRecord, 'html_url');

  requireNonEmptyString(runUrl, 'run.url', failures);
  requirePositiveInteger(artifactId, 'artifact.id', failures);
  requireNonEmptyString(artifactUrl, 'artifact.url', failures);
  if (artifact.expired !== false) {
    failures.push('artifact.expired: expected false.');
  }
  requireNonEmptyString(expiresAt, 'artifact.expires_at', failures);
  validateExpiresAt(expiresAt, input.ciEnv.generatedAt, failures);
  if (remoteArtifactZipDigest && !DIGEST_PATTERN.test(remoteArtifactZipDigest)) {
    failures.push('artifact.digest: remote artifact digest must be sha256:<64 lowercase hex>.');
  }

  if (isRecord(artifact.workflow_run)) {
    const artifactRunId = readNumber(artifact.workflow_run, 'id') ?? readNumber(artifact.workflow_run, 'run_id');
    if (artifactRunId !== null && artifactRunId !== undefined && artifactRunId !== runIdNumber) {
      failures.push(`artifact.workflow_run.id: expected ${runIdNumber}; actual ${artifactRunId}`);
    }
    const artifactHeadSha = readString(artifact.workflow_run, 'head_sha');
    if (artifactHeadSha && artifactHeadSha !== expected.headSha) {
      failures.push(`artifact.workflow_run.head_sha: expected ${expected.headSha}; actual ${artifactHeadSha}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(formatRunnerManifestSourceFailures(failures));
  }

  return {
    schema_version: RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
    source_kind: 'github_actions_artifact',
    producer_repo: RUNNER_CANONICAL_REPO,
    producer_repo_slug: RUNNER_REPO_SLUG,
    manifest_path: input.manifestRelativePath,
    manifest_digest_kind: 'stable_json_canonical_sha256',
    local_manifest_canonical_sha256: localManifestCanonicalSha256,
    remote_manifest_canonical_sha256: remoteManifestCanonicalSha256,
    manifest_canonical_digest_match: true,
    manifest_release_id: input.manifest.release_id,
    manifest_git_sha: input.manifest.git_sha,
    manifest_subject_sha256: input.manifest.artifact_provenance.subject_sha256,
    manifest_provenance_artifact_sha256: input.manifest.artifact_provenance.artifact_sha256,
    run_id: expected.runId,
    run_attempt: expected.runAttempt,
    workflow_name: expected.workflowName,
    workflow_status: readString(runApiRecord, 'status'),
    workflow_conclusion: readString(runApiRecord, 'conclusion'),
    head_sha: readString(runApiRecord, 'head_sha'),
    run_url: runUrl,
    artifact_name: expected.artifactName,
    artifact_id: artifactId ?? 0,
    artifact_url: artifactUrl,
    artifact_archive_download_url: artifactArchiveDownloadUrl || null,
    artifact_expired: false,
    expires_at: expiresAt,
    remote_artifact_zip_digest: remoteArtifactZipDigest,
    remote_artifact_zip_digest_source: remoteArtifactZipDigest
      ? 'github_actions_artifact.digest'
      : 'not_provided_by_github',
    adoption_gate: {
      command: RUNNER_RELEASE_MANIFEST_ADOPTION_COMMAND,
      lock_path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
      manifest_path: RUNNER_RELEASE_MANIFEST_RELATIVE_PATH,
      ok: true,
    },
    consumer: {
      repo: input.ciEnv.canonicalRepo,
      workflow_name: input.ciEnv.workflowName,
      run_id: input.ciEnv.runId,
      run_attempt: input.ciEnv.runAttempt,
      job: input.ciEnv.job,
      commit_sha: input.ciEnv.commitSha,
    },
    generated_at: input.ciEnv.generatedAt,
  };
}

function buildAsbcpFinalManifestSourceReceipt(input: {
  ciEnv: GitHubCiProvenanceEnv;
  imageLock: AsbcpImageLockSource;
  manifestPath: string;
  manifestRelativePath: string;
  releaseApiPath: string;
  assetApiPath: string;
  cwd: string;
}): AsbcpFinalManifestSourceReceipt {
  const failures: string[] = [];
  const releaseApi = readJson(input.releaseApiPath);
  const assetApi = readJson(input.assetApiPath);

  if (!isRecord(releaseApi)) {
    failures.push('release_api: GitHub release metadata must be a JSON object.');
  }
  if (!isRecord(assetApi)) {
    failures.push('asset_api: GitHub release asset metadata must be a JSON object.');
  }
  if (!existsSync(input.manifestPath)) {
    failures.push(`manifest_path: downloaded ASBCP final manifest must exist: ${input.manifestPath}`);
  }
  if (failures.length > 0) {
    throw new Error(formatAsbcpManifestSourceFailures(failures));
  }

  const releaseApiRecord = releaseApi as Record<string, unknown>;
  const assetApiRecord = assetApi as Record<string, unknown>;
  const releaseId = readNumber(releaseApiRecord, 'id');
  const releaseTag = readString(releaseApiRecord, 'tag_name');
  const releaseApiUrl = readString(releaseApiRecord, 'url');
  const releaseHtmlUrl = readString(releaseApiRecord, 'html_url');
  const releaseTargetCommitish = firstNonEmptyString(readString(releaseApiRecord, 'target_commitish'));
  const releaseCreatedAt = firstNonEmptyString(readString(releaseApiRecord, 'created_at'));
  const releasePublishedAt = firstNonEmptyString(readString(releaseApiRecord, 'published_at'));
  const releaseUpdatedAt = firstNonEmptyString(readString(releaseApiRecord, 'updated_at'));
  const downloadedManifestSha256 = fileSha256Digest(input.manifestPath);
  const adoptionResult = checkAsbcpManifestLock({
    manifestPath: input.manifestPath,
    lockPath: path.join(input.cwd, ASBCP_IMAGE_LOCK_RELATIVE_PATH),
  });

  requirePositiveInteger(releaseId, 'release_api.id', failures);
  compareString(releaseTag, input.imageLock.version, 'release_api.tag_name', failures);
  if (releaseTag && !RELEASE_TAG_PATTERN.test(releaseTag)) {
    failures.push(`release_api.tag_name: must be an ASBCP release tag; actual ${releaseTag}`);
  }
  compareString(releaseHtmlUrl, input.imageLock.releaseUrl, 'release_api.html_url', failures);
  requireNonEmptyString(releaseApiUrl, 'release_api.url', failures);
  validateOptionalTimestamp(releaseCreatedAt, 'release_api.created_at', failures);
  validateOptionalTimestamp(releasePublishedAt, 'release_api.published_at', failures);
  validateOptionalTimestamp(releaseUpdatedAt, 'release_api.updated_at', failures);

  const releaseAssets = Array.isArray(releaseApiRecord.assets)
    ? releaseApiRecord.assets.filter(isRecord)
    : [];
  if (!Array.isArray(releaseApiRecord.assets)) {
    failures.push('release_api.assets: GitHub release metadata must include an assets array.');
  }
  const matchingReleaseAssets = releaseAssets.filter(
    (asset) => asset.name === ASBCP_FINAL_MANIFEST_ASSET_NAME,
  );
  if (matchingReleaseAssets.length !== 1) {
    failures.push(
      `release_api.assets: expected exactly one ${ASBCP_FINAL_MANIFEST_ASSET_NAME} asset; actual ${matchingReleaseAssets.length}`,
    );
  }

  const releaseAsset = matchingReleaseAssets[0] ?? {};
  const releaseAssetId = readNumber(releaseAsset, 'id');
  const assetId = readNumber(assetApiRecord, 'id');
  const assetName = readString(assetApiRecord, 'name');
  const assetUrl = readString(assetApiRecord, 'url');
  const assetBrowserDownloadUrl = readString(assetApiRecord, 'browser_download_url');
  const assetContentType = firstNonEmptyString(readString(assetApiRecord, 'content_type'));
  const assetSize = readNumber(assetApiRecord, 'size');
  const assetCreatedAt = readString(assetApiRecord, 'created_at');
  const assetUpdatedAt = readString(assetApiRecord, 'updated_at');
  const rawAssetApiDigest = firstNonEmptyString(readString(assetApiRecord, 'digest'));
  const assetApiDigest = normalizeOptionalSha256Digest(rawAssetApiDigest, 'asset_api.digest', failures);
  const rawReleaseAssetDigest = firstNonEmptyString(readString(releaseAsset, 'digest'));
  const releaseAssetDigest = normalizeOptionalSha256Digest(
    rawReleaseAssetDigest,
    'release_api.assets[].digest',
    failures,
  );
  const apiAssetDigest = assetApiDigest ?? releaseAssetDigest;
  const apiAssetDigestPath = assetApiDigest ? 'asset_api.digest' : 'release_api.assets[].digest';

  requirePositiveInteger(releaseAssetId, 'release_api.assets[].id', failures);
  requirePositiveInteger(assetId, 'asset_api.id', failures);
  if (releaseAssetId !== null && assetId !== null) {
    compareNumber(assetId, releaseAssetId, 'asset_api.id', failures);
  }
  compareString(assetName, ASBCP_FINAL_MANIFEST_ASSET_NAME, 'asset_api.name', failures);
  requireNonEmptyString(assetUrl, 'asset_api.url', failures);
  requireNonEmptyString(assetBrowserDownloadUrl, 'asset_api.browser_download_url', failures);
  if (assetSize !== null && assetSize <= 0) {
    failures.push('asset_api.size: must be a positive integer when provided.');
  }
  requireNonEmptyString(assetCreatedAt, 'asset_api.created_at', failures);
  requireNonEmptyString(assetUpdatedAt, 'asset_api.updated_at', failures);
  validateRequiredTimestamp(assetCreatedAt, 'asset_api.created_at', failures);
  validateRequiredTimestamp(assetUpdatedAt, 'asset_api.updated_at', failures);

  if (assetApiDigest && releaseAssetDigest && assetApiDigest !== releaseAssetDigest) {
    failures.push('release_api.assets[].digest: release asset digest must match asset_api.digest.');
  }
  if (apiAssetDigest && apiAssetDigest !== downloadedManifestSha256) {
    failures.push(
      `${apiAssetDigestPath}: release asset digest must match downloaded manifest sha256; expected ${apiAssetDigest}; actual ${downloadedManifestSha256}`,
    );
  }

  if (!adoptionResult.ok) {
    failures.push(`adoption_gate: ${formatAsbcpManifestLockFailures(adoptionResult.failures)}`);
  }

  if (failures.length > 0) {
    throw new Error(formatAsbcpManifestSourceFailures(failures));
  }

  return {
    schema_version: ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
    source_kind: 'github_release_asset',
    producer_repo: ASBCP_CANONICAL_REPO,
    producer_repo_slug: ASBCP_REPO_SLUG,
    lock_path: ASBCP_IMAGE_LOCK_RELATIVE_PATH,
    lock_source_image: input.imageLock.sourceImage,
    lock_commit_sha: input.imageLock.commitSha,
    manifest_path: input.manifestRelativePath,
    release_url: input.imageLock.releaseUrl,
    release_tag: input.imageLock.version,
    release_id: releaseId ?? 0,
    release_api_url: releaseApiUrl,
    release_html_url: releaseHtmlUrl,
    release_target_commitish: releaseTargetCommitish,
    release_created_at: releaseCreatedAt,
    release_published_at: releasePublishedAt,
    release_updated_at: releaseUpdatedAt,
    asset_id: assetId ?? 0,
    asset_name: ASBCP_FINAL_MANIFEST_ASSET_NAME,
    asset_url: assetUrl,
    asset_browser_download_url: assetBrowserDownloadUrl,
    asset_content_type: assetContentType,
    asset_size: assetSize,
    asset_created_at: assetCreatedAt,
    asset_updated_at: assetUpdatedAt,
    api_asset_digest: apiAssetDigest,
    api_asset_digest_source: apiAssetDigest
      ? 'github_release_asset.digest'
      : 'not_provided_by_github',
    downloaded_manifest_sha256: downloadedManifestSha256,
    api_asset_digest_match: apiAssetDigest ? true : null,
    adoption_gate: {
      command: formatAsbcpFinalManifestAdoptionCommand(input.manifestRelativePath),
      lock_path: ASBCP_IMAGE_LOCK_RELATIVE_PATH,
      manifest_path: input.manifestRelativePath,
      ok: true,
    },
    consumer: {
      repo: input.ciEnv.canonicalRepo,
      workflow_name: input.ciEnv.workflowName,
      run_id: input.ciEnv.runId,
      run_attempt: input.ciEnv.runAttempt,
      job: input.ciEnv.job,
      commit_sha: input.ciEnv.commitSha,
    },
    generated_at: input.ciEnv.generatedAt,
  };
}

function manifestCanonicalSha256(manifest: CurrentRunnerReleaseManifest): string {
  return sha256Digest(canonicalReleaseBoundaryJson(manifest));
}

function fileSha256Digest(filePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function formatAsbcpFinalManifestAdoptionCommand(manifestPath: string): string {
  return `npm run contracts:check-asbcp-adoption -- --manifest ${manifestPath}`;
}

function requireEnvString(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = firstNonEmptyString(env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function firstNonEmptyString(...values: readonly (string | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function formatRunnerManifestSourceFailures(failures: readonly string[]): string {
  return `runner release manifest source freshness check failed:\n${failures.join('\n')}`;
}

function formatAsbcpManifestSourceFailures(failures: readonly string[]): string {
  return `ASBCP final manifest source freshness check failed:\n${failures.join('\n')}`;
}

function normalizeSha256Digest(digest: string): string {
  return digest.trim().toLowerCase();
}

function normalizeOptionalSha256Digest(
  digest: string | null,
  pathName: string,
  failures: string[],
): string | null {
  if (!digest) {
    return null;
  }

  const normalized = normalizeSha256Digest(digest);
  if (!DIGEST_PATTERN.test(normalized)) {
    failures.push(`${pathName}: release asset digest must be sha256:<64 lowercase hex>.`);
    return null;
  }

  return normalized;
}

function compareString(
  actual: string,
  expected: string,
  pathName: string,
  failures: string[],
): void {
  if (actual !== expected) {
    failures.push(`${pathName}: expected ${expected}; actual ${actual || '<missing>'}`);
  }
}

function compareNumber(
  actual: number | null,
  expected: number,
  pathName: string,
  failures: string[],
): void {
  if (actual !== expected) {
    failures.push(`${pathName}: expected ${expected}; actual ${actual ?? '<missing>'}`);
  }
}

function requirePositiveInteger(
  value: number | null,
  pathName: string,
  failures: string[],
): void {
  if (value === null || !Number.isSafeInteger(value) || value <= 0) {
    failures.push(`${pathName}: must be a positive integer.`);
  }
}

function requireNonEmptyString(value: string, pathName: string, failures: string[]): void {
  if (value.trim().length === 0) {
    failures.push(`${pathName}: must be a non-empty string.`);
  }
}

function validateExpiresAt(expiresAt: string, generatedAt: string, failures: string[]): void {
  const expiresAtTime = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtTime)) {
    failures.push('artifact.expires_at: must be a parseable timestamp.');
    return;
  }

  const generatedAtTime = Date.parse(generatedAt);
  if (Number.isFinite(generatedAtTime) && expiresAtTime <= generatedAtTime) {
    failures.push('artifact.expires_at: must be later than the receipt generated_at timestamp.');
  }
}

function validateOptionalTimestamp(value: string | null, pathName: string, failures: string[]): void {
  if (value === null) {
    return;
  }
  validateRequiredTimestamp(value, pathName, failures);
}

function validateRequiredTimestamp(value: string, pathName: string, failures: string[]): void {
  if (!Number.isFinite(Date.parse(value))) {
    failures.push(`${pathName}: must be a parseable timestamp.`);
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedString(record: Record<string, unknown>, keys: readonly string[]): string {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) {
      return '';
    }
    current = current[key];
  }

  return typeof current === 'string' ? current.trim() : '';
}

function toPortableRelativePath(cwd: string, targetPath: string, label = 'runner release manifest source'): string {
  const relativePath = path.relative(cwd, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(
      `${label} must be inside ${cwd}.`,
    );
  }

  return relativePath.split(path.sep).join('/');
}

function writeJsonAtomically(outputPath: string, value: unknown): void {
  const outputDir = path.dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const tempPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.tmp`);

  try {
    writeFileSync(tempPath, `${canonicalReleaseBoundaryJson(value)}\n`);
    renameSync(tempPath, outputPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseContractArtifactCli());
}
