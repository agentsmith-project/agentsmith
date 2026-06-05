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
  type CurrentReleaseImageSourceProvenanceBinding,
  type CurrentRunnerImageLock,
  type CurrentRunnerReleaseManifest,
} from './current-release-boundary-schema';
import {
  assembleAgentSmithReleaseContractFromInput,
} from './release-contract-assemble';
import {
  parseLockedImageRef,
} from './build-artifact-broker';
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
export const RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME = 'runner-ga-handoff-source.json' as const;
export const ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME = 'asbcp-final-manifest-source.json' as const;
export const LLMUP_IMAGE_SOURCE_RECEIPT_NAME = 'llmup-image-source.json' as const;
export const AFSCP_IMAGE_SOURCE_RECEIPT_NAME = 'afscp-image-source.json' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_COMMAND = 'npm run release:contract:ci-artifact' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_VERSION = 'p1.1-release-contract-artifact' as const;
export const RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.runner-release-manifest-source/v1' as const;
export const RUNNER_GA_HANDOFF_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.runner-ga-handoff-source/v1' as const;
export const ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.asbcp-final-manifest-source/v1' as const;
export const LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.llmup-image-source/v1' as const;
export const AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION =
  'agentsmith.afscp-image-source/v1' as const;

const DEFAULT_OUTPUT_DIR = 'artifacts/release-contract';
const RUNNER_IMAGE_LOCK_RELATIVE_PATH =
  'release/agentsmith-runner-image.lock' as const;
const RUNNER_RELEASE_MANIFEST_RELATIVE_PATH =
  'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json' as const;
const RUNNER_REPO_SLUG = 'agentsmith-project/agentsmith-runner' as const;
const LLMUP_IMAGE_LOCK_RELATIVE_PATH = 'infra/deploy/shared/llmup-image.lock' as const;
const LLMUP_REPO_SLUG = 'agentsmith-project/llm-universal-proxy' as const;
const LLMUP_CANONICAL_REPO = `github.com/${LLMUP_REPO_SLUG}` as const;
const LLMUP_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/llm-universal-proxy' as const;
const LLMUP_IMAGE_SOURCE_SUBJECT_NAME = 'llm-universal-proxy-image' as const;
const AFSCP_IMAGE_LOCK_RELATIVE_PATH = 'infra/deploy/shared/afscp-image.lock' as const;
const AFSCP_REPO_SLUG = 'agentsmith-project/agentsmith-fs-control-plane' as const;
const AFSCP_CANONICAL_REPO = `github.com/${AFSCP_REPO_SLUG}` as const;
const AFSCP_IMAGE_REPOSITORY =
  'ghcr.io/agentsmith-project/agentsmith-fs-control-plane' as const;
const AFSCP_IMAGE_SOURCE_SUBJECT_NAME = 'agentsmith-fs-control-plane-image' as const;
const ASBCP_IMAGE_LOCK_RELATIVE_PATH = 'infra/deploy/shared/asbcp-image.lock' as const;
const ASBCP_REPO_SLUG = 'agentsmith-project/agentsmith-sandbox-control-plane' as const;
const ASBCP_CANONICAL_REPO = `github.com/${ASBCP_REPO_SLUG}` as const;
const ASBCP_IMAGE_REPOSITORY =
  'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane' as const;
const ASBCP_IMAGE_SOURCE_SUBJECT_NAME = 'agentsmith-sandbox-control-plane-image' as const;
const ASBCP_RELEASE_URL_PREFIX =
  `https://github.com/${ASBCP_REPO_SLUG}/releases/tag/` as const;
const ASBCP_FINAL_MANIFEST_ASSET_NAME = 'asbcp-final-manifest.json' as const;
const ASBCP_SOURCE_PROVENANCE_FILE_NAME = 'source-provenance.json' as const;
const RUNNER_RELEASE_MANIFEST_ADOPTION_COMMAND =
  `npm run contracts:check-runner-image-lock -- --adoption --manifest ${RUNNER_RELEASE_MANIFEST_RELATIVE_PATH}` as const;
const RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION =
  'agentsmith.runner-ga-handoff-report/v1' as const;
const RUNNER_GA_HANDOFF_SCOPE = 'runner_ga_handoff_evidence' as const;
const RUNNER_GA_HANDOFF_ARTIFACT_NAME = 'runner-ga-handoff' as const;
const RUNNER_GA_HANDOFF_REPORT_FILE_NAME = 'runner-ga-handoff-report.json' as const;
const MANAGED_RUNNER_IMAGE_SOURCE_SUBJECT_NAME = 'agentsmith-managed-runner-image' as const;
const PRODUCER_OWNED_INPUT_FIELDS = [
  'sourceGitSha',
  'ci_provenance',
  'runnerImageLock',
  'external_image_source_provenance',
] as const;
type ProducerOwnedInputField = typeof PRODUCER_OWNED_INPUT_FIELDS[number];
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z]+)*$/u;

const LLMUP_IMAGE_SOURCE_CONFIG: DependencyImageProviderConfig = {
  providerId: 'llmup',
  lockPath: LLMUP_IMAGE_LOCK_RELATIVE_PATH,
  versionKey: 'llmup_version',
  sourceImageKey: 'llmup_source_image',
  releaseUrlKey: 'llmup_release_url',
  commitShaKey: 'llmup_commit_sha',
  imageRepository: LLMUP_IMAGE_REPOSITORY,
  repoSlug: LLMUP_REPO_SLUG,
  canonicalRepo: LLMUP_CANONICAL_REPO,
  subjectName: LLMUP_IMAGE_SOURCE_SUBJECT_NAME,
  receiptName: LLMUP_IMAGE_SOURCE_RECEIPT_NAME,
  schemaVersion: LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
};

const AFSCP_IMAGE_SOURCE_CONFIG: DependencyImageProviderConfig = {
  providerId: 'afscp',
  lockPath: AFSCP_IMAGE_LOCK_RELATIVE_PATH,
  versionKey: 'afscp_version',
  sourceImageKey: 'afscp_source_image',
  releaseUrlKey: 'afscp_release_url',
  commitShaKey: 'afscp_commit_sha',
  imageRepository: AFSCP_IMAGE_REPOSITORY,
  repoSlug: AFSCP_REPO_SLUG,
  canonicalRepo: AFSCP_CANONICAL_REPO,
  subjectName: AFSCP_IMAGE_SOURCE_SUBJECT_NAME,
  receiptName: AFSCP_IMAGE_SOURCE_RECEIPT_NAME,
  schemaVersion: AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
};

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
  runnerGaHandoffPath: string;
  runnerRunViewPath: string;
  runnerRunApiPath: string;
  runnerArtifactsApiPath: string;
  llmupSourceGatePath: string;
  afscpSourceGatePath: string;
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

interface RunnerGaHandoffSourceReceipt {
  schema_version: typeof RUNNER_GA_HANDOFF_SOURCE_RECEIPT_SCHEMA_VERSION;
  source_kind: 'github_actions_artifact';
  producer_repo: typeof RUNNER_CANONICAL_REPO;
  producer_repo_slug: typeof RUNNER_REPO_SLUG;
  report_schema_version: typeof RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION;
  report_scope: typeof RUNNER_GA_HANDOFF_SCOPE;
  report_status: 'pass';
  report_path: string;
  report_sha256: string;
  report_artifact_name: typeof RUNNER_GA_HANDOFF_ARTIFACT_NAME;
  report_artifact_uri: string;
  manifest_input_sha256: string;
  manifest_release_id: string;
  manifest_git_sha: string;
  manifest_artifact_uri: string;
  manifest_subject_sha256: string;
  manifest_provenance_artifact_sha256: string;
  runner_image_digest: string;
  contract_package_uri: string;
  contract_package_sha256: string;
  contract_descriptor_subject_sha256: string;
  run_id: string;
  run_attempt: string;
  workflow_name: string;
  head_sha: string;
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
  imageRepository: string;
  imageTagRef: string;
  digest: string;
  releaseUrl: string;
  commitSha: string;
}

type DependencyImageProviderId = 'llmup' | 'afscp';

interface DependencyImageProviderConfig {
  providerId: DependencyImageProviderId;
  lockPath: typeof LLMUP_IMAGE_LOCK_RELATIVE_PATH | typeof AFSCP_IMAGE_LOCK_RELATIVE_PATH;
  versionKey: `${DependencyImageProviderId}_version`;
  sourceImageKey: `${DependencyImageProviderId}_source_image`;
  releaseUrlKey: `${DependencyImageProviderId}_release_url`;
  commitShaKey: `${DependencyImageProviderId}_commit_sha`;
  imageRepository: typeof LLMUP_IMAGE_REPOSITORY | typeof AFSCP_IMAGE_REPOSITORY;
  repoSlug: typeof LLMUP_REPO_SLUG | typeof AFSCP_REPO_SLUG;
  canonicalRepo: typeof LLMUP_CANONICAL_REPO | typeof AFSCP_CANONICAL_REPO;
  subjectName: typeof LLMUP_IMAGE_SOURCE_SUBJECT_NAME | typeof AFSCP_IMAGE_SOURCE_SUBJECT_NAME;
  receiptName: typeof LLMUP_IMAGE_SOURCE_RECEIPT_NAME | typeof AFSCP_IMAGE_SOURCE_RECEIPT_NAME;
  schemaVersion: typeof LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION | typeof AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION;
}

interface DependencyImageLockSource {
  providerId: DependencyImageProviderId;
  version: string;
  sourceImage: string;
  imageRepository: string;
  imageTagRef: string;
  digest: string;
  releaseUrl: string;
  commitSha: string;
}

interface DependencyImageSourceReceipt {
  schema_version: typeof LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION | typeof AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION;
  source_kind: 'github_release_tag_and_ghcr_manifest';
  provider_image_id: DependencyImageProviderId;
  producer_repo: typeof LLMUP_CANONICAL_REPO | typeof AFSCP_CANONICAL_REPO;
  producer_repo_slug: typeof LLMUP_REPO_SLUG | typeof AFSCP_REPO_SLUG;
  lock_path: typeof LLMUP_IMAGE_LOCK_RELATIVE_PATH | typeof AFSCP_IMAGE_LOCK_RELATIVE_PATH;
  lock_version: string;
  lock_source_image: string;
  lock_digest: string;
  lock_commit_sha: string;
  release_url: string;
  release_tag: string;
  release_id: number;
  release_api_url: string;
  release_html_url: string;
  release_target_commitish: string | null;
  release_created_at: string | null;
  release_published_at: string | null;
  release_updated_at: string | null;
  tag_ref: string;
  tag_ref_object_type: 'commit' | 'tag';
  tag_ref_object_sha: string;
  tag_object_sha: string | null;
  tag_commit_sha: string;
  tag_commit_sha_match: true;
  run_id: string;
  run_attempt: string;
  run_url: string;
  subject_name: typeof LLMUP_IMAGE_SOURCE_SUBJECT_NAME | typeof AFSCP_IMAGE_SOURCE_SUBJECT_NAME;
  artifact_uri: string;
  observed_ghcr_digest: string;
  ghcr_digest_match: true;
  check_command: string;
  source_gate_path: string;
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
  run_id: string;
  run_attempt: string;
  run_url: string;
  subject_name: typeof ASBCP_IMAGE_SOURCE_SUBJECT_NAME;
  artifact_uri: string;
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
  let runnerGaHandoffReceiptPath: string | undefined;
  let llmupImageSourceReceiptPath: string | undefined;
  let afscpImageSourceReceiptPath: string | undefined;
  let asbcpFinalManifestReceiptPath: string | undefined;

  try {
    const config = parseCliArgs(argv, cwd, env);
    outputPath = path.join(config.outputDir, RELEASE_CONTRACT_ARTIFACT_NAME);
    runnerManifestReceiptPath = path.join(config.outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    runnerGaHandoffReceiptPath = path.join(config.outputDir, RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME);
    llmupImageSourceReceiptPath = path.join(config.outputDir, LLMUP_IMAGE_SOURCE_RECEIPT_NAME);
    afscpImageSourceReceiptPath = path.join(config.outputDir, AFSCP_IMAGE_SOURCE_RECEIPT_NAME);
    asbcpFinalManifestReceiptPath = path.join(config.outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);
    const runnerManifestRelativePath = assertCanonicalRunnerManifestPath(cwd, config.runnerManifestPath);
    assertCanonicalRunnerManifestAdoption(cwd, config.runnerManifestPath);
    const runnerReleaseManifest = readCanonicalRunnerReleaseManifest(config.runnerManifestPath);
    const remoteRunnerReleaseManifest = readRemoteRunnerReleaseManifest(config.runnerRemoteManifestPath);
    const llmupImageLock = readCanonicalDependencyImageLockSource(cwd, LLMUP_IMAGE_SOURCE_CONFIG);
    const afscpImageLock = readCanonicalDependencyImageLockSource(cwd, AFSCP_IMAGE_SOURCE_CONFIG);
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
    const runnerGaHandoffReceipt = buildRunnerGaHandoffSourceReceipt({
      ciEnv,
      manifest: runnerReleaseManifest,
      manifestReceipt: runnerManifestReceipt,
      remoteManifestPath: config.runnerRemoteManifestPath,
      reportPath: config.runnerGaHandoffPath,
    });
    const llmupImageSourceReceipt = buildDependencyImageSourceReceipt({
      ciEnv,
      config: LLMUP_IMAGE_SOURCE_CONFIG,
      imageLock: llmupImageLock,
      sourceGatePath: config.llmupSourceGatePath,
      sourceGateRelativePath: toPortableRelativePath(cwd, config.llmupSourceGatePath, 'LLMUP image source gate'),
    });
    const afscpImageSourceReceipt = buildDependencyImageSourceReceipt({
      ciEnv,
      config: AFSCP_IMAGE_SOURCE_CONFIG,
      imageLock: afscpImageLock,
      sourceGatePath: config.afscpSourceGatePath,
      sourceGateRelativePath: toPortableRelativePath(cwd, config.afscpSourceGatePath, 'AFSCP image source gate'),
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
    assertAdoptedProviderImagesMatchSourceReceipts(input, [
      llmupImageSourceReceipt,
      afscpImageSourceReceipt,
    ]);
    const externalImageSourceProvenance = [
      buildRunnerImageSourceProvenance({
        runnerImageLock,
        manifest: runnerReleaseManifest,
        receipt: runnerManifestReceipt,
        handoffReceipt: runnerGaHandoffReceipt,
      }),
      buildDependencyImageSourceProvenance(llmupImageSourceReceipt),
      buildDependencyImageSourceProvenance(afscpImageSourceReceipt),
      buildAsbcpImageSourceProvenance({
        imageLock: asbcpImageLock,
        receipt: asbcpFinalManifestReceipt,
      }),
    ];
    const contract = assembleAgentSmithReleaseContractFromInput(
      {
        ...input,
        runnerImageLock,
        external_image_source_provenance: externalImageSourceProvenance,
        sourceGitSha: ciEnv.commitSha,
        ci_provenance: ciProvenance,
      },
      {
        sourceGitSha: ciEnv.commitSha,
      },
    );

    writeJsonAtomically(outputPath, contract);
    writeJsonAtomically(runnerManifestReceiptPath, runnerManifestReceipt);
    writeJsonAtomically(runnerGaHandoffReceiptPath, runnerGaHandoffReceipt);
    writeJsonAtomically(llmupImageSourceReceiptPath, llmupImageSourceReceipt);
    writeJsonAtomically(afscpImageSourceReceiptPath, afscpImageSourceReceipt);
    writeJsonAtomically(asbcpFinalManifestReceiptPath, asbcpFinalManifestReceipt);
    stdout(`release contract artifact: ${outputPath}`);
    stdout(`runner release manifest source receipt: ${runnerManifestReceiptPath}`);
    stdout(`runner GA handoff source receipt: ${runnerGaHandoffReceiptPath}`);
    stdout(`LLMUP image source receipt: ${llmupImageSourceReceiptPath}`);
    stdout(`AFSCP image source receipt: ${afscpImageSourceReceiptPath}`);
    stdout(`ASBCP final manifest source receipt: ${asbcpFinalManifestReceiptPath}`);
    return 0;
  } catch (error) {
    if (outputPath) {
      rmSync(outputPath, { force: true });
    }
    if (runnerManifestReceiptPath) {
      rmSync(runnerManifestReceiptPath, { force: true });
    }
    if (runnerGaHandoffReceiptPath) {
      rmSync(runnerGaHandoffReceiptPath, { force: true });
    }
    if (llmupImageSourceReceiptPath) {
      rmSync(llmupImageSourceReceiptPath, { force: true });
    }
    if (afscpImageSourceReceiptPath) {
      rmSync(afscpImageSourceReceiptPath, { force: true });
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

function readCanonicalDependencyImageLockSource(
  rootDir: string,
  config: DependencyImageProviderConfig,
): DependencyImageLockSource {
  const lockPath = path.join(rootDir, config.lockPath);
  if (!existsSync(lockPath)) {
    throw new Error(
      `${config.providerId.toUpperCase()} image lock must be provided by canonical ${config.lockPath}.`,
    );
  }

  const values = parseKeyValueText(readFileSync(lockPath, 'utf8'), config.lockPath);
  const version = requireKeyValue(values, config.versionKey, config.lockPath);
  const sourceImage = requireKeyValue(values, config.sourceImageKey, config.lockPath);
  const releaseUrl = requireKeyValue(values, config.releaseUrlKey, config.lockPath);
  const commitSha = requireKeyValue(values, config.commitShaKey, config.lockPath);
  const releaseUrlPrefix = `https://github.com/${config.repoSlug}/releases/tag/`;
  const failures: string[] = [];

  if (!RELEASE_TAG_PATTERN.test(version)) {
    failures.push(`${config.versionKey}: must be a release tag; actual ${version}.`);
  }
  if (releaseUrl !== `${releaseUrlPrefix}${version}`) {
    failures.push(
      `${config.releaseUrlKey}: expected ${releaseUrlPrefix}${version}; actual ${releaseUrl}.`,
    );
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    failures.push(`${config.commitShaKey}: must be a 40-character lowercase git commit sha.`);
  }

  const parsedSourceImage = parseLockedImageRef(sourceImage);
  if (!parsedSourceImage.ok) {
    failures.push(`${config.sourceImageKey}: ${parsedSourceImage.reason}`);
  } else {
    if (parsedSourceImage.value.image !== config.imageRepository) {
      failures.push(`${config.sourceImageKey}: expected image repository ${config.imageRepository}; actual ${parsedSourceImage.value.image}.`);
    }
    if (parsedSourceImage.value.tag !== version) {
      failures.push(`${config.sourceImageKey}: image tag must match ${config.versionKey}.`);
    }
  }

  if (failures.length > 0) {
    throw new Error(formatDependencyImageSourceFailures(config.providerId, failures));
  }

  if (!parsedSourceImage.ok) {
    throw new Error(formatDependencyImageSourceFailures(config.providerId, [`${config.sourceImageKey}: invalid.`]));
  }

  return {
    providerId: config.providerId,
    version,
    sourceImage,
    imageRepository: parsedSourceImage.value.image,
    imageTagRef: `${parsedSourceImage.value.image}:${version}`,
    digest: parsedSourceImage.value.digest,
    releaseUrl,
    commitSha,
  };
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
  const failures: string[] = [];

  if (!RELEASE_TAG_PATTERN.test(version)) {
    failures.push(`asbcp_version: must be a release tag; actual ${version}.`);
  }
  if (releaseUrl !== `${ASBCP_RELEASE_URL_PREFIX}${version}`) {
    failures.push(
      `asbcp_release_url: expected ${ASBCP_RELEASE_URL_PREFIX}${version}; actual ${releaseUrl}.`,
    );
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    failures.push('asbcp_commit_sha: must be a 40-character lowercase git commit sha.');
  }

  const parsedSourceImage = parseLockedImageRef(sourceImage);
  if (!parsedSourceImage.ok) {
    failures.push(`asbcp_source_image: ${parsedSourceImage.reason}`);
  } else {
    if (parsedSourceImage.value.image !== ASBCP_IMAGE_REPOSITORY) {
      failures.push(
        `asbcp_source_image: expected image repository ${ASBCP_IMAGE_REPOSITORY}; actual ${parsedSourceImage.value.image}.`,
      );
    }
    if (parsedSourceImage.value.tag !== version) {
      failures.push('asbcp_source_image: image tag must match asbcp_version.');
    }
  }

  if (failures.length > 0) {
    throw new Error(formatAsbcpManifestSourceFailures(failures));
  }
  if (!parsedSourceImage.ok) {
    throw new Error(formatAsbcpManifestSourceFailures(['asbcp_source_image: invalid.']));
  }

  return {
    version,
    sourceImage,
    imageRepository: parsedSourceImage.value.image,
    imageTagRef: `${parsedSourceImage.value.image}:${version}`,
    digest: parsedSourceImage.value.digest,
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
  let runnerGaHandoffPath: string | undefined;
  let runnerRunViewPath: string | undefined;
  let runnerRunApiPath: string | undefined;
  let runnerArtifactsApiPath: string | undefined;
  let llmupSourceGatePath: string | undefined;
  let afscpSourceGatePath: string | undefined;
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
      case '--runner-ga-handoff':
        runnerGaHandoffPath = requireArgValue(argv, index);
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
      case '--llmup-source-gate':
        llmupSourceGatePath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--afscp-source-gate':
        afscpSourceGatePath = requireArgValue(argv, index);
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
    runnerGaHandoffPath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        runnerGaHandoffPath,
        env.RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH,
        '--runner-ga-handoff',
        'RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH',
        'runner GA handoff source freshness',
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
    llmupSourceGatePath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        llmupSourceGatePath,
        env.LLMUP_IMAGE_SOURCE_GATE_PATH,
        '--llmup-source-gate',
        'LLMUP_IMAGE_SOURCE_GATE_PATH',
        'LLMUP image source freshness',
      ),
    ),
    afscpSourceGatePath: path.resolve(
      cwd,
      requireCliOrEnvPath(
        afscpSourceGatePath,
        env.AFSCP_IMAGE_SOURCE_GATE_PATH,
        '--afscp-source-gate',
        'AFSCP_IMAGE_SOURCE_GATE_PATH',
        'AFSCP image source freshness',
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

function assertAdoptedProviderImagesMatchSourceReceipts(
  input: ReleaseContractArtifactProducerInput,
  receipts: readonly DependencyImageSourceReceipt[],
): void {
  const failures: string[] = [];
  const adoptedProviderImages = input.adopted_provider_images;

  if (!Array.isArray(adoptedProviderImages)) {
    throw new Error(formatAdoptedProviderImageSourceBindingFailures([
      'adopted_provider_images must be an array.',
    ]));
  }

  for (const receipt of receipts) {
    const providerId = receipt.provider_image_id;
    const matches = adoptedProviderImages
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => isRecord(entry) && entry.id === providerId);

    if (matches.length !== 1) {
      failures.push(
        `adopted_provider_images.${providerId}: expected exactly one source-bound image; actual ${matches.length}.`,
      );
      continue;
    }

    const match = matches[0];
    if (!match || !isRecord(match.entry)) {
      failures.push(`adopted_provider_images.${providerId}: expected image entry object.`);
      continue;
    }

    const pathName = `adopted_provider_images[${match.index}]`;
    const image = typeof match.entry.image === 'string' ? match.entry.image : '';
    const digest = typeof match.entry.digest === 'string' ? match.entry.digest : '';

    if (image.trim().length === 0) {
      failures.push(`${pathName}.image: must be a non-empty string.`);
    } else if (image !== receipt.lock_source_image) {
      failures.push(
        `${pathName}.image: expected source image ${receipt.lock_source_image}; actual ${image}.`,
      );
    }

    if (digest.trim().length === 0) {
      failures.push(`${pathName}.digest: must be a non-empty string.`);
    } else if (digest !== receipt.lock_digest) {
      failures.push(
        `${pathName}.digest: expected source digest ${receipt.lock_digest}; actual ${digest}.`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(formatAdoptedProviderImageSourceBindingFailures(failures));
  }
}

function buildRunnerImageSourceProvenance(input: {
  runnerImageLock: CurrentRunnerImageLock;
  manifest: CurrentRunnerReleaseManifest;
  receipt: RunnerReleaseManifestSourceReceipt;
  handoffReceipt: RunnerGaHandoffSourceReceipt;
}): CurrentReleaseImageSourceProvenanceBinding {
  return {
    image_id: 'managed_runner',
    producer_repo: input.receipt.producer_repo,
    normalized_remote: requireNonEmptyField(
      input.manifest.artifact_provenance.normalized_remote,
      'runner release manifest artifact_provenance.normalized_remote',
    ),
    commit_sha: input.receipt.manifest_git_sha,
    tag: requireLockedImageTag(input.runnerImageLock.image.image, 'runnerImageLock.image.image'),
    run_id: input.receipt.run_id,
    run_attempt: input.receipt.run_attempt,
    run_url: githubActionsRunAttemptUrl(input.receipt.producer_repo, input.receipt.run_id, input.receipt.run_attempt),
    subject_name: MANAGED_RUNNER_IMAGE_SOURCE_SUBJECT_NAME,
    artifact_uri: imageSourceArtifactUri(
      input.receipt.producer_repo,
      input.receipt.run_id,
      MANAGED_RUNNER_IMAGE_SOURCE_SUBJECT_NAME,
    ),
    artifact_sha256: input.runnerImageLock.image.digest,
    runner_release_manifest_uri: requireNonEmptyField(
      input.manifest.artifact_provenance.artifact_uri,
      'runner release manifest artifact_provenance.artifact_uri',
    ),
    runner_release_manifest_subject_sha256: input.receipt.manifest_subject_sha256,
    runner_release_manifest_artifact_sha256: input.receipt.manifest_provenance_artifact_sha256,
    runner_ga_handoff_uri: input.handoffReceipt.report_artifact_uri,
    runner_ga_handoff_manifest_input_sha256: input.handoffReceipt.manifest_input_sha256,
    runner_ga_handoff_report_sha256: input.handoffReceipt.report_sha256,
  };
}

function buildDependencyImageSourceProvenance(
  receipt: DependencyImageSourceReceipt,
): CurrentReleaseImageSourceProvenanceBinding {
  return {
    image_id: receipt.provider_image_id,
    producer_repo: receipt.producer_repo,
    normalized_remote: receipt.producer_repo,
    commit_sha: receipt.tag_commit_sha,
    tag: receipt.release_tag,
    run_id: receipt.run_id,
    run_attempt: receipt.run_attempt,
    run_url: receipt.run_url,
    subject_name: receipt.subject_name,
    artifact_uri: receipt.artifact_uri,
    artifact_sha256: receipt.observed_ghcr_digest,
  };
}

function buildAsbcpImageSourceProvenance(input: {
  imageLock: AsbcpImageLockSource;
  receipt: AsbcpFinalManifestSourceReceipt;
}): CurrentReleaseImageSourceProvenanceBinding {
  return {
    image_id: 'asbcp',
    producer_repo: input.receipt.producer_repo,
    normalized_remote: input.receipt.producer_repo,
    commit_sha: input.receipt.lock_commit_sha,
    tag: input.receipt.release_tag,
    run_id: input.receipt.run_id,
    run_attempt: input.receipt.run_attempt,
    run_url: input.receipt.run_url,
    subject_name: input.receipt.subject_name,
    artifact_uri: input.receipt.artifact_uri,
    artifact_sha256: input.imageLock.digest,
  };
}

function formatProducerOwnedInputFieldFailure(field: ProducerOwnedInputField): string {
  switch (field) {
    case 'sourceGitSha':
    case 'ci_provenance':
      return `${field} must be provided by GitHub CI env.`;
    case 'runnerImageLock':
      return 'runnerImageLock must be provided by canonical agentsmith-runner-image.lock.';
    case 'external_image_source_provenance':
      return 'external_image_source_provenance must be provided by canonical source receipts.';
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

function buildRunnerGaHandoffSourceReceipt(input: {
  ciEnv: GitHubCiProvenanceEnv;
  manifest: CurrentRunnerReleaseManifest;
  manifestReceipt: RunnerReleaseManifestSourceReceipt;
  remoteManifestPath: string;
  reportPath: string;
}): RunnerGaHandoffSourceReceipt {
  const failures: string[] = [];
  const report = readJson(input.reportPath);
  const reportText = readFileSync(input.reportPath, 'utf8');
  const remoteManifestText = readFileSync(input.remoteManifestPath, 'utf8');

  if (!isRecord(report)) {
    failures.push('handoff: runner GA handoff report must be a JSON object.');
    throw new Error(formatRunnerGaHandoffSourceFailures(failures));
  }

  const reportRecord = report as Record<string, unknown>;
  const expectedReportArtifactUri =
    `gh-artifact://${RUNNER_REPO_SLUG}/${RUNNER_GA_HANDOFF_ARTIFACT_NAME}/${input.manifestReceipt.run_id}/${RUNNER_GA_HANDOFF_REPORT_FILE_NAME}`;
  const expectedChecks = new Set([
    'runner_release_manifest',
    'digest_pinned_runner_image',
    'contract_artifact_binding',
    'adoption_policy_declared',
  ]);

  compareString(
    readString(reportRecord, 'schema_version'),
    RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION,
    'handoff.schema_version',
    failures,
  );
  compareString(readString(reportRecord, 'scope'), RUNNER_GA_HANDOFF_SCOPE, 'handoff.scope', failures);
  compareString(readString(reportRecord, 'status'), 'pass', 'handoff.status', failures);
  if (Object.hasOwn(reportRecord, 'formal_verdict')) {
    failures.push('handoff.formal_verdict: runner GA handoff must not issue a formal verdict.');
  }
  compareString(readString(reportRecord, 'runner'), input.manifest.runner, 'handoff.runner', failures);
  compareString(readString(reportRecord, 'release_id'), input.manifest.release_id, 'handoff.release_id', failures);
  compareString(readString(reportRecord, 'git_sha'), input.manifest.git_sha, 'handoff.git_sha', failures);
  compareString(
    readString(reportRecord, 'runner_contract_version'),
    input.manifest.runner_contract_version,
    'handoff.runner_contract_version',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['image', 'id']),
    input.manifest.image.id,
    'handoff.image.id',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['image', 'image']),
    input.manifest.image.image,
    'handoff.image.image',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['image', 'digest']),
    input.manifest.image.digest,
    'handoff.image.digest',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['contract_artifact', 'package_uri']),
    input.manifest.contract_artifact.package_uri,
    'handoff.contract_artifact.package_uri',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['contract_artifact', 'package_sha256']),
    input.manifest.contract_artifact.package_sha256,
    'handoff.contract_artifact.package_sha256',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['contract_artifact', 'descriptor_subject_sha256']),
    input.manifest.contract_artifact.descriptor_subject_sha256,
    'handoff.contract_artifact.descriptor_subject_sha256',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['manifest', 'input_sha256']),
    sha256Digest(remoteManifestText),
    'handoff.manifest.input_sha256',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['manifest', 'artifact_uri']),
    input.manifest.artifact_provenance.artifact_uri,
    'handoff.manifest.artifact_uri',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['manifest', 'subject_sha256']),
    input.manifest.artifact_provenance.subject_sha256,
    'handoff.manifest.subject_sha256',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['manifest', 'artifact_sha256']),
    input.manifest.artifact_provenance.artifact_sha256,
    'handoff.manifest.artifact_sha256',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'producer_repo']),
    input.manifest.artifact_provenance.producer_repo,
    'handoff.provenance.producer_repo',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'normalized_remote']),
    input.manifest.artifact_provenance.normalized_remote,
    'handoff.provenance.normalized_remote',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'workflow_name']),
    input.manifestReceipt.workflow_name,
    'handoff.provenance.workflow_name',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'run_id']),
    input.manifestReceipt.run_id,
    'handoff.provenance.run_id',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'run_attempt']),
    input.manifestReceipt.run_attempt,
    'handoff.provenance.run_attempt',
    failures,
  );
  compareString(
    readNestedString(reportRecord, ['provenance', 'commit_sha']),
    input.manifestReceipt.head_sha,
    'handoff.provenance.commit_sha',
    failures,
  );

  const checks = Array.isArray(reportRecord.checks) ? reportRecord.checks : [];
  if (!Array.isArray(reportRecord.checks)) {
    failures.push('handoff.checks: must be an array.');
  }
  const seenChecks = new Set<string>();
  for (const [index, check] of checks.entries()) {
    if (!isRecord(check)) {
      failures.push(`handoff.checks[${index}]: must be an object.`);
      continue;
    }
    const name = readString(check, 'name');
    const status = readString(check, 'status');
    if (name) {
      seenChecks.add(name);
    }
    if (status !== 'pass') {
      failures.push(`handoff.checks[${index}].status: expected pass; actual ${status || '<missing>'}`);
    }
  }
  for (const expectedCheck of expectedChecks) {
    if (!seenChecks.has(expectedCheck)) {
      failures.push(`handoff.checks: missing ${expectedCheck}.`);
    }
  }

  if (failures.length > 0) {
    throw new Error(formatRunnerGaHandoffSourceFailures(failures));
  }

  return {
    schema_version: RUNNER_GA_HANDOFF_SOURCE_RECEIPT_SCHEMA_VERSION,
    source_kind: 'github_actions_artifact',
    producer_repo: RUNNER_CANONICAL_REPO,
    producer_repo_slug: RUNNER_REPO_SLUG,
    report_schema_version: RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION,
    report_scope: RUNNER_GA_HANDOFF_SCOPE,
    report_status: 'pass',
    report_path: input.reportPath,
    report_sha256: sha256Digest(reportText),
    report_artifact_name: RUNNER_GA_HANDOFF_ARTIFACT_NAME,
    report_artifact_uri: expectedReportArtifactUri,
    manifest_input_sha256: readNestedString(reportRecord, ['manifest', 'input_sha256']),
    manifest_release_id: input.manifest.release_id,
    manifest_git_sha: input.manifest.git_sha,
    manifest_artifact_uri: input.manifest.artifact_provenance.artifact_uri,
    manifest_subject_sha256: input.manifest.artifact_provenance.subject_sha256,
    manifest_provenance_artifact_sha256: input.manifest.artifact_provenance.artifact_sha256,
    runner_image_digest: input.manifest.image.digest,
    contract_package_uri: input.manifest.contract_artifact.package_uri,
    contract_package_sha256: input.manifest.contract_artifact.package_sha256,
    contract_descriptor_subject_sha256: input.manifest.contract_artifact.descriptor_subject_sha256,
    run_id: input.manifestReceipt.run_id,
    run_attempt: input.manifestReceipt.run_attempt,
    workflow_name: input.manifestReceipt.workflow_name,
    head_sha: input.manifestReceipt.head_sha,
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

function buildDependencyImageSourceReceipt(input: {
  ciEnv: GitHubCiProvenanceEnv;
  config: DependencyImageProviderConfig;
  imageLock: DependencyImageLockSource;
  sourceGatePath: string;
  sourceGateRelativePath: string;
}): DependencyImageSourceReceipt {
  const failures: string[] = [];
  const sourceGate = readJson(input.sourceGatePath);

  if (!isRecord(sourceGate)) {
    failures.push('source_gate: provider image source gate must be a JSON object.');
  }
  if (failures.length > 0) {
    throw new Error(formatDependencyImageSourceFailures(input.config.providerId, failures));
  }

  const sourceGateRecord = sourceGate as Record<string, unknown>;
  const releaseApi = sourceGateRecord.release_api;
  const tagRefApi = sourceGateRecord.tag_ref_api;
  const tagObjectApi = sourceGateRecord.tag_object_api;
  const releaseUrlPrefix = `https://github.com/${input.config.repoSlug}/releases/tag/`;
  const expectedCheckCommand = formatDependencyImageDigestCheckCommand(input.imageLock.imageTagRef);
  const observedGhrDigest = normalizeOptionalSha256Digest(
    firstNonEmptyString(readString(sourceGateRecord, 'observed_ghcr_digest')),
    'source_gate.observed_ghcr_digest',
    failures,
  );
  const checkCommand = readString(sourceGateRecord, 'check_command');
  const sourceRunId = readString(sourceGateRecord, 'run_id');
  const sourceRunAttempt = readString(sourceGateRecord, 'run_attempt');
  const sourceRunUrl = readString(sourceGateRecord, 'run_url');
  const sourceCommitSha = readString(sourceGateRecord, 'commit_sha');
  const sourceSubjectName = readString(sourceGateRecord, 'subject_name');
  const sourceArtifactUri = readString(sourceGateRecord, 'artifact_uri');

  compareString(readString(sourceGateRecord, 'provider_id'), input.config.providerId, 'source_gate.provider_id', failures);
  compareString(readString(sourceGateRecord, 'repo_slug'), input.config.repoSlug, 'source_gate.repo_slug', failures);
  compareString(checkCommand, expectedCheckCommand, 'source_gate.check_command', failures);
  compareString(sourceCommitSha, input.imageLock.commitSha, 'source_gate.commit_sha', failures);
  compareString(sourceSubjectName, input.config.subjectName, 'source_gate.subject_name', failures);
  requirePositiveIntegerString(sourceRunId, 'source_gate.run_id', failures);
  requirePositiveIntegerString(sourceRunAttempt, 'source_gate.run_attempt', failures);
  if (sourceRunId && sourceRunAttempt) {
    compareString(
      sourceRunUrl,
      githubActionsRunAttemptUrl(input.config.canonicalRepo, sourceRunId, sourceRunAttempt),
      'source_gate.run_url',
      failures,
    );
    compareString(
      sourceArtifactUri,
      imageSourceArtifactUri(input.config.canonicalRepo, sourceRunId, input.config.subjectName),
      'source_gate.artifact_uri',
      failures,
    );
  } else {
    requireNonEmptyString(sourceRunUrl, 'source_gate.run_url', failures);
    requireNonEmptyString(sourceArtifactUri, 'source_gate.artifact_uri', failures);
  }
  if (!isRecord(releaseApi)) {
    failures.push('source_gate.release_api: GitHub release metadata must be a JSON object.');
  }
  if (!isRecord(tagRefApi)) {
    failures.push('source_gate.tag_ref_api: GitHub tag ref metadata must be a JSON object.');
  }
  if (tagObjectApi !== null && !isRecord(tagObjectApi)) {
    failures.push('source_gate.tag_object_api: GitHub tag object metadata must be a JSON object or null.');
  }

  if (observedGhrDigest && observedGhrDigest !== input.imageLock.digest) {
    failures.push(
      `source_gate.observed_ghcr_digest: expected ${input.imageLock.digest}; actual ${observedGhrDigest}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(formatDependencyImageSourceFailures(input.config.providerId, failures));
  }

  const releaseApiRecord = releaseApi as Record<string, unknown>;
  const tagRefApiRecord = tagRefApi as Record<string, unknown>;
  const tagObjectApiRecord = isRecord(tagObjectApi) ? tagObjectApi : null;
  const releaseId = readNumber(releaseApiRecord, 'id');
  const releaseTag = readString(releaseApiRecord, 'tag_name');
  const releaseApiUrl = readString(releaseApiRecord, 'url');
  const releaseHtmlUrl = readString(releaseApiRecord, 'html_url');
  const releaseTargetCommitish = firstNonEmptyString(readString(releaseApiRecord, 'target_commitish'));
  const releaseCreatedAt = firstNonEmptyString(readString(releaseApiRecord, 'created_at'));
  const releasePublishedAt = firstNonEmptyString(readString(releaseApiRecord, 'published_at'));
  const releaseUpdatedAt = firstNonEmptyString(readString(releaseApiRecord, 'updated_at'));
  const tagRef = readString(tagRefApiRecord, 'ref');
  const tagRefObject = isRecord(tagRefApiRecord.object) ? tagRefApiRecord.object : {};
  const tagRefObjectType = readString(tagRefObject, 'type');
  const tagRefObjectSha = readString(tagRefObject, 'sha');
  const tagObjectSha = tagObjectApiRecord ? readString(tagObjectApiRecord, 'sha') : null;
  const tagCommitSha = resolveTagCommitSha({
    expectedVersion: input.imageLock.version,
    tagRefObjectType,
    tagRefObjectSha,
    tagObjectApi: tagObjectApiRecord,
    failures,
  });

  requirePositiveInteger(releaseId, 'release_api.id', failures);
  compareString(releaseTag, input.imageLock.version, 'release_api.tag_name', failures);
  if (releaseTag && !RELEASE_TAG_PATTERN.test(releaseTag)) {
    failures.push(`release_api.tag_name: must be a release tag; actual ${releaseTag}`);
  }
  compareString(releaseHtmlUrl, input.imageLock.releaseUrl, 'release_api.html_url', failures);
  compareString(input.imageLock.releaseUrl, `${releaseUrlPrefix}${input.imageLock.version}`, 'lock.release_url', failures);
  requireNonEmptyString(releaseApiUrl, 'release_api.url', failures);
  validateOptionalTimestamp(releaseCreatedAt, 'release_api.created_at', failures);
  validateOptionalTimestamp(releasePublishedAt, 'release_api.published_at', failures);
  validateOptionalTimestamp(releaseUpdatedAt, 'release_api.updated_at', failures);
  compareString(tagRef, `refs/tags/${input.imageLock.version}`, 'tag_ref_api.ref', failures);
  if (tagRefObjectType !== 'commit' && tagRefObjectType !== 'tag') {
    failures.push(`tag_ref_api.object.type: expected commit or tag; actual ${tagRefObjectType || '<missing>'}`);
  }
  if (!COMMIT_SHA_PATTERN.test(tagRefObjectSha)) {
    failures.push('tag_ref_api.object.sha: must be a 40-character lowercase git object sha.');
  }
  if (tagCommitSha) {
    compareString(tagCommitSha, input.imageLock.commitSha, 'tag_commit_sha', failures);
  }

  if (failures.length > 0) {
    throw new Error(formatDependencyImageSourceFailures(input.config.providerId, failures));
  }

  if (!observedGhrDigest || !tagCommitSha || (tagRefObjectType !== 'commit' && tagRefObjectType !== 'tag')) {
    throw new Error(
      formatDependencyImageSourceFailures(input.config.providerId, ['source_gate: provider image source metadata is incomplete.']),
    );
  }

  return {
    schema_version: input.config.schemaVersion,
    source_kind: 'github_release_tag_and_ghcr_manifest',
    provider_image_id: input.config.providerId,
    producer_repo: input.config.canonicalRepo,
    producer_repo_slug: input.config.repoSlug,
    lock_path: input.config.lockPath,
    lock_version: input.imageLock.version,
    lock_source_image: input.imageLock.sourceImage,
    lock_digest: input.imageLock.digest,
    lock_commit_sha: input.imageLock.commitSha,
    release_url: input.imageLock.releaseUrl,
    release_tag: input.imageLock.version,
    release_id: releaseId ?? 0,
    release_api_url: releaseApiUrl,
    release_html_url: releaseHtmlUrl,
    release_target_commitish: releaseTargetCommitish,
    release_created_at: releaseCreatedAt,
    release_published_at: releasePublishedAt,
    release_updated_at: releaseUpdatedAt,
    tag_ref: tagRef,
    tag_ref_object_type: tagRefObjectType,
    tag_ref_object_sha: tagRefObjectSha,
    tag_object_sha: tagObjectSha,
    tag_commit_sha: tagCommitSha,
    tag_commit_sha_match: true,
    run_id: sourceRunId,
    run_attempt: sourceRunAttempt,
    run_url: sourceRunUrl,
    subject_name: input.config.subjectName,
    artifact_uri: sourceArtifactUri,
    observed_ghcr_digest: observedGhrDigest,
    ghcr_digest_match: true,
    check_command: expectedCheckCommand,
    source_gate_path: input.sourceGateRelativePath,
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
  const sourceProvenancePath = path.join(path.dirname(input.manifestPath), ASBCP_SOURCE_PROVENANCE_FILE_NAME);
  const sourceProvenance = existsSync(sourceProvenancePath)
    ? readJson(sourceProvenancePath)
    : null;

  if (!isRecord(releaseApi)) {
    failures.push('release_api: GitHub release metadata must be a JSON object.');
  }
  if (!isRecord(assetApi)) {
    failures.push('asset_api: GitHub release asset metadata must be a JSON object.');
  }
  if (!existsSync(sourceProvenancePath)) {
    failures.push(`source_provenance_path: ASBCP source provenance sidecar must exist: ${sourceProvenancePath}`);
  } else if (!isRecord(sourceProvenance)) {
    failures.push('source_provenance: ASBCP source provenance sidecar must be a JSON object.');
  }
  if (!existsSync(input.manifestPath)) {
    failures.push(`manifest_path: downloaded ASBCP final manifest must exist: ${input.manifestPath}`);
  }
  if (failures.length > 0) {
    throw new Error(formatAsbcpManifestSourceFailures(failures));
  }

  const releaseApiRecord = releaseApi as Record<string, unknown>;
  const assetApiRecord = assetApi as Record<string, unknown>;
  const sourceProvenanceRecord = sourceProvenance as Record<string, unknown>;
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
  const sourceRepoSlug = readString(sourceProvenanceRecord, 'repo_slug');
  const sourceCommitSha = readString(sourceProvenanceRecord, 'commit_sha');
  const sourceRunId = readString(sourceProvenanceRecord, 'run_id');
  const sourceRunAttempt = readString(sourceProvenanceRecord, 'run_attempt');
  const sourceRunUrl = readString(sourceProvenanceRecord, 'run_url');
  const sourceSubjectName = readString(sourceProvenanceRecord, 'subject_name');
  const sourceArtifactUri = readString(sourceProvenanceRecord, 'artifact_uri');

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
  compareString(sourceRepoSlug, ASBCP_REPO_SLUG, 'source_provenance.repo_slug', failures);
  compareString(sourceCommitSha, input.imageLock.commitSha, 'source_provenance.commit_sha', failures);
  compareString(sourceSubjectName, ASBCP_IMAGE_SOURCE_SUBJECT_NAME, 'source_provenance.subject_name', failures);
  requirePositiveIntegerString(sourceRunId, 'source_provenance.run_id', failures);
  requirePositiveIntegerString(sourceRunAttempt, 'source_provenance.run_attempt', failures);
  if (sourceRunId && sourceRunAttempt) {
    compareString(
      sourceRunUrl,
      githubActionsRunAttemptUrl(ASBCP_CANONICAL_REPO, sourceRunId, sourceRunAttempt),
      'source_provenance.run_url',
      failures,
    );
    compareString(
      sourceArtifactUri,
      imageSourceArtifactUri(ASBCP_CANONICAL_REPO, sourceRunId, ASBCP_IMAGE_SOURCE_SUBJECT_NAME),
      'source_provenance.artifact_uri',
      failures,
    );
  } else {
    requireNonEmptyString(sourceRunUrl, 'source_provenance.run_url', failures);
    requireNonEmptyString(sourceArtifactUri, 'source_provenance.artifact_uri', failures);
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
    run_id: sourceRunId,
    run_attempt: sourceRunAttempt,
    run_url: sourceRunUrl,
    subject_name: ASBCP_IMAGE_SOURCE_SUBJECT_NAME,
    artifact_uri: sourceArtifactUri,
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

function formatDependencyImageDigestCheckCommand(imageTagRef: string): string {
  return `docker buildx imagetools inspect ${imageTagRef} --format '{{.Manifest.Digest}}'`;
}

function formatAsbcpFinalManifestAdoptionCommand(manifestPath: string): string {
  return `npm run contracts:check-asbcp-adoption -- --manifest ${manifestPath}`;
}

function resolveTagCommitSha(input: {
  expectedVersion: string;
  tagRefObjectType: string;
  tagRefObjectSha: string;
  tagObjectApi: Record<string, unknown> | null;
  failures: string[];
}): string | null {
  if (input.tagRefObjectType === 'commit') {
    return input.tagRefObjectSha;
  }

  if (input.tagRefObjectType !== 'tag') {
    return null;
  }
  if (!input.tagObjectApi) {
    input.failures.push('tag_object_api: annotated tag metadata is required when tag ref points at a tag object.');
    return null;
  }

  const tagObjectTag = readString(input.tagObjectApi, 'tag');
  const tagObjectSha = readString(input.tagObjectApi, 'sha');
  const target = isRecord(input.tagObjectApi.object) ? input.tagObjectApi.object : {};
  const targetType = readString(target, 'type');
  const targetSha = readString(target, 'sha');

  compareString(tagObjectTag, input.expectedVersion, 'tag_object_api.tag', input.failures);
  compareString(tagObjectSha, input.tagRefObjectSha, 'tag_object_api.sha', input.failures);
  compareString(targetType, 'commit', 'tag_object_api.object.type', input.failures);
  if (!COMMIT_SHA_PATTERN.test(targetSha)) {
    input.failures.push('tag_object_api.object.sha: must be a 40-character lowercase git commit sha.');
    return null;
  }

  return targetSha;
}

function requireEnvString(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = firstNonEmptyString(env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireNonEmptyField(value: unknown, pathName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string.`);
  }

  return value.trim();
}

function githubActionsRunAttemptUrl(canonicalRepo: string, runId: string, runAttempt: string): string {
  return `https://github.com/${githubRepoSlug(canonicalRepo)}/actions/runs/${runId}/attempts/${runAttempt}`;
}

function imageSourceArtifactUri(canonicalRepo: string, runId: string, subjectName: string): string {
  return `gh-artifact://${githubRepoSlug(canonicalRepo)}/${runId}/${subjectName}.oci`;
}

function githubRepoSlug(canonicalRepo: string): string {
  const prefix = 'github.com/';
  if (!canonicalRepo.startsWith(prefix) || canonicalRepo.slice(prefix.length).trim().length === 0) {
    throw new Error(`canonical repo must start with ${prefix}.`);
  }

  return canonicalRepo.slice(prefix.length);
}

function requireLockedImageTag(value: string, pathName: string): string {
  const parsed = parseLockedImageRef(value);
  if (!parsed.ok) {
    throw new Error(`${pathName}: ${parsed.reason}`);
  }
  if (!parsed.value.tag) {
    throw new Error(`${pathName}: image ref must include a tag.`);
  }

  return parsed.value.tag;
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

function formatRunnerGaHandoffSourceFailures(failures: readonly string[]): string {
  return `runner GA handoff source freshness check failed:\n${failures.join('\n')}`;
}

function formatDependencyImageSourceFailures(
  providerId: DependencyImageProviderId,
  failures: readonly string[],
): string {
  return `${providerId.toUpperCase()} image source freshness check failed:\n${failures.join('\n')}`;
}

function formatAsbcpManifestSourceFailures(failures: readonly string[]): string {
  return `ASBCP final manifest source freshness check failed:\n${failures.join('\n')}`;
}

function formatAdoptedProviderImageSourceBindingFailures(failures: readonly string[]): string {
  return `release contract adopted provider image source binding failed:\n${failures.join('\n')}`;
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

function requirePositiveIntegerString(value: string, pathName: string, failures: string[]): void {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    failures.push(`${pathName}: must be a positive integer string.`);
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
