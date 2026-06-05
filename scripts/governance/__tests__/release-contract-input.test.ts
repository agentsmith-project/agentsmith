import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  type CurrentBuildManifestAggregate,
} from '../build-artifact-broker';
import {
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseImageSourceProvenanceBinding,
  type CurrentRunnerImageLock,
} from '../current-release-boundary-schema';
import {
  assembleReleaseContractGeneratorInput,
  buildProductImagesFromBuildManifest,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from '../release-contract-input';
import {
  AFSCP_IMAGE_SOURCE_RECEIPT_NAME,
  AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
  ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME,
  ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
  LLMUP_IMAGE_SOURCE_RECEIPT_NAME,
  LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
  RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME,
  RUNNER_GA_HANDOFF_SOURCE_RECEIPT_SCHEMA_VERSION,
  RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME,
  RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
  runReleaseContractArtifactCli,
} from '../release-contract-artifact';
import {
  generateAgentSmithReleaseContract,
  type AgentSmithReleaseContractCiProvenanceInput,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';
import { runReleaseContractAssembleCli } from '../release-contract-assemble';

const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-05-23T12:00:00.000Z';
const SOURCE_OPTIONS = { sourceGitSha: GIT_SHA } as const;
const CLI_SOURCE_ARGV = ['--source-git-sha', GIT_SHA] as const;
const APP_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST = `sha256:${'b'.repeat(64)}`;
const LLMUP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/llm-universal-proxy';
const AFSCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-fs-control-plane';
const ASBCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const LLMUP_VERSION = 'v0.2.44';
const LLMUP_DIGEST = `sha256:${'3'.repeat(64)}`;
const LLMUP_COMMIT_SHA = '9c8208d3a12e8070c4edb0ee07469d023cfe38ad';
const LLMUP_SOURCE_RUN_ID = '30001';
const LLMUP_SOURCE_RUN_ATTEMPT = '1';
const LLMUP_SOURCE_SUBJECT_NAME = 'llm-universal-proxy-image';
const LLMUP_RELEASE_URL =
  `https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/${LLMUP_VERSION}`;
const AFSCP_VERSION = 'v1.0.7';
const AFSCP_DIGEST = `sha256:${'5'.repeat(64)}`;
const AFSCP_COMMIT_SHA = '0fec35424500b6b5d9075edafb997778f1803e19';
const AFSCP_SOURCE_RUN_ID = '40001';
const AFSCP_SOURCE_RUN_ATTEMPT = '1';
const AFSCP_SOURCE_SUBJECT_NAME = 'agentsmith-fs-control-plane-image';
const AFSCP_RELEASE_URL =
  `https://github.com/agentsmith-project/agentsmith-fs-control-plane/releases/tag/${AFSCP_VERSION}`;
const ASBCP_VERSION = 'v2.0.12';
const ASBCP_DIGEST = `sha256:${'6'.repeat(64)}`;
const ASBCP_COMMIT_SHA = '291a0195aeab392ca7265460573670e41e5f058b';
const ASBCP_SOURCE_RUN_ID = '50001';
const ASBCP_SOURCE_RUN_ATTEMPT = '1';
const ASBCP_SOURCE_SUBJECT_NAME = 'agentsmith-sandbox-control-plane-image';
const ASBCP_RELEASE_URL =
  `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/${ASBCP_VERSION}`;
const ASBCP_FINAL_MANIFEST_ASSET_NAME = 'asbcp-final-manifest.json';
const ASBCP_BREAKING_CHANGE_ID = 'ASBCP-BC-0001';
const MANAGED_RUNNER_SOURCE_SUBJECT_NAME = 'agentsmith-managed-runner-image';
const REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS = [
  'afscp',
  'agentsmith_app',
  'asbcp',
  'ingress_nginx_certgen',
  'ingress_nginx_controller',
  'llmup',
  'managed_runner',
] as const;
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'test',
  command: 'npm run build-artifact-broker',
  runtime: 'vitest',
};
const RUNNER_IMAGE_LOCK = {
  schema_version: 'agentsmith.runner-image-lock/v1',
  runner: 'agentsmith-runner',
  release_id: 'locked-safety-008dbbd',
  git_sha: '008dbbd3b232485cb77f3cae585d38955a8bf9fb',
  runner_contract_version: '0.1.0',
  runner_protocol_version: '1.0',
  image: {
    id: 'agentsmith-runner',
    image:
      'ghcr.io/agentsmith-project/agentsmith-runner:release-locked-safety-008dbbd@sha256:07292903e04006a2912225970e824174894aad1953d8d3f98453e4df7a58849a',
    digest: 'sha256:07292903e04006a2912225970e824174894aad1953d8d3f98453e4df7a58849a',
  },
  manifest: {
    producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
    subject_sha256: 'sha256:88f46a3519906e2db6f51390b000671e3322b4c7fbb8badca3f58e2357f4b3b0',
    artifact_sha256: 'sha256:88f46a3519906e2db6f51390b000671e3322b4c7fbb8badca3f58e2357f4b3b0',
  },
  handoff: {
    report_artifact_uri:
      'gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/26866339967/runner-ga-handoff-report.json',
    manifest_input_sha256: 'sha256:a7e83fd0cae608d7e7ac8f3483c78ffa2c3ebe25f09c0b4e6e63526d95cfab70',
    report_sha256: 'sha256:03aafe51bd832b68acc26ed56df05bcd49f2dfb02ad3560d28e0636acb8e612d',
  },
} as const satisfies CurrentRunnerImageLock;
const CANONICAL_RUNNER_IMAGE_LOCK_PATH = join(
  process.cwd(),
  'release',
  'agentsmith-runner-image.lock',
);
const CANONICAL_RUNNER_RELEASE_MANIFEST_PATH = join(
  process.cwd(),
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
  'runner-release-manifest.valid.json',
);
const CANONICAL_RUNNER_IMAGE_LOCK_RELATIVE_PATH = join(
  'release',
  'agentsmith-runner-image.lock',
);
const CANONICAL_RUNNER_RELEASE_MANIFEST_RELATIVE_PATH = join(
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
  'runner-release-manifest.valid.json',
);
const RUNNER_REMOTE_ARTIFACT_DIGEST = `sha256:${'c'.repeat(64)}`;

function buildRunnerImageLock(): CurrentRunnerImageLock {
  return structuredClone(RUNNER_IMAGE_LOCK);
}

function buildExternalImageSourceProvenance(
  overrides: {
    runId?: string;
    runAttempt?: string;
    asbcpDigest?: string;
    asbcpVersion?: string;
  } = {},
): CurrentReleaseImageSourceProvenanceBinding[] {
  const runId = overrides.runId ?? '10001';
  const runAttempt = overrides.runAttempt ?? '1';
  const asbcpDigest = overrides.asbcpDigest ?? ASBCP_DIGEST;
  const asbcpVersion = overrides.asbcpVersion ?? ASBCP_VERSION;

  return [
    {
      image_id: 'llmup',
      producer_repo: 'github.com/agentsmith-project/llm-universal-proxy',
      normalized_remote: 'github.com/agentsmith-project/llm-universal-proxy',
      commit_sha: LLMUP_COMMIT_SHA,
      tag: LLMUP_VERSION,
      run_id: runId,
      run_attempt: runAttempt,
      run_url: githubActionsRunAttemptUrl('github.com/agentsmith-project/llm-universal-proxy', runId, runAttempt),
      subject_name: LLMUP_SOURCE_SUBJECT_NAME,
      artifact_uri: imageSourceArtifactUri(
        'github.com/agentsmith-project/llm-universal-proxy',
        runId,
        LLMUP_SOURCE_SUBJECT_NAME,
      ),
      artifact_sha256: LLMUP_DIGEST,
    },
    {
      image_id: 'afscp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      commit_sha: AFSCP_COMMIT_SHA,
      tag: AFSCP_VERSION,
      run_id: runId,
      run_attempt: runAttempt,
      run_url: githubActionsRunAttemptUrl('github.com/agentsmith-project/agentsmith-fs-control-plane', runId, runAttempt),
      subject_name: AFSCP_SOURCE_SUBJECT_NAME,
      artifact_uri: imageSourceArtifactUri(
        'github.com/agentsmith-project/agentsmith-fs-control-plane',
        runId,
        AFSCP_SOURCE_SUBJECT_NAME,
      ),
      artifact_sha256: AFSCP_DIGEST,
    },
    {
      image_id: 'asbcp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      commit_sha: ASBCP_COMMIT_SHA,
      tag: asbcpVersion,
      run_id: runId,
      run_attempt: runAttempt,
      run_url: githubActionsRunAttemptUrl(
        'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
        runId,
        runAttempt,
      ),
      subject_name: ASBCP_SOURCE_SUBJECT_NAME,
      artifact_uri: imageSourceArtifactUri(
        'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
        runId,
        ASBCP_SOURCE_SUBJECT_NAME,
      ),
      artifact_sha256: asbcpDigest,
    },
    {
      image_id: 'managed_runner',
      producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
      commit_sha: RUNNER_IMAGE_LOCK.git_sha,
      tag: 'release-locked-safety-008dbbd',
      run_id: '26866339967',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith-runner/actions/runs/26866339967/attempts/1',
      subject_name: MANAGED_RUNNER_SOURCE_SUBJECT_NAME,
      artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith-runner/26866339967/agentsmith-managed-runner-image.oci',
      artifact_sha256: RUNNER_IMAGE_LOCK.image.digest,
      runner_release_manifest_uri:
        'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26866339967/runner-release-manifest.json',
      runner_release_manifest_subject_sha256: RUNNER_IMAGE_LOCK.manifest.subject_sha256,
      runner_release_manifest_artifact_sha256: RUNNER_IMAGE_LOCK.manifest.artifact_sha256,
      runner_ga_handoff_uri: RUNNER_IMAGE_LOCK.handoff.report_artifact_uri,
      runner_ga_handoff_manifest_input_sha256: RUNNER_IMAGE_LOCK.handoff.manifest_input_sha256,
      runner_ga_handoff_report_sha256: RUNNER_IMAGE_LOCK.handoff.report_sha256,
    },
  ];
}

function buildAppImageSourceProvenance(
  productImages: AgentSmithReleaseContractGeneratorInput['product_images'],
): CurrentReleaseImageSourceProvenanceBinding {
  const image = productImages[0];
  if (!image) {
    throw new Error('expected app image');
  }

  return {
    image_id: 'agentsmith_app',
    producer_repo: 'github.com/agentsmith-project/agentsmith',
    normalized_remote: 'github.com/agentsmith-project/agentsmith',
    commit_sha: GIT_SHA,
    tag: imageTagFromRef(image.image),
    run_id: '10001',
    run_attempt: '1',
    run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1',
    subject_name: 'agentsmith-app-image',
    artifact_uri: 'gh-artifact://agentsmith-project/agentsmith/10001/agentsmith-app-image.oci',
    artifact_sha256: image.digest,
  };
}

function imageTagFromRef(image: string): string {
  const refWithoutDigest = image.replace(/@sha256:[0-9a-f]{64}$/u, '');
  const lastSlashIndex = refWithoutDigest.lastIndexOf('/');
  const lastColonIndex = refWithoutDigest.lastIndexOf(':');
  if (lastColonIndex <= lastSlashIndex) {
    throw new Error(`expected image tag in ${image}`);
  }

  return refWithoutDigest.slice(lastColonIndex + 1);
}

function sourceProvenanceFor(
  bindings: readonly CurrentReleaseImageSourceProvenanceBinding[],
  imageId: string,
): Omit<CurrentReleaseImageSourceProvenanceBinding, 'image_id'> {
  const binding = bindings.find((entry) => entry.image_id === imageId);
  if (!binding) {
    throw new Error(`missing source provenance for ${imageId}`);
  }

  return {
    producer_repo: binding.producer_repo,
    normalized_remote: binding.normalized_remote,
    commit_sha: binding.commit_sha,
    tag: binding.tag,
    run_id: binding.run_id,
    run_attempt: binding.run_attempt,
    run_url: binding.run_url,
    subject_name: binding.subject_name,
    artifact_uri: binding.artifact_uri,
    artifact_sha256: binding.artifact_sha256,
    ...(binding.runner_release_manifest_uri === undefined ? {} : {
      runner_release_manifest_uri: binding.runner_release_manifest_uri,
    }),
    ...(binding.runner_release_manifest_subject_sha256 === undefined ? {} : {
      runner_release_manifest_subject_sha256: binding.runner_release_manifest_subject_sha256,
    }),
    ...(binding.runner_release_manifest_artifact_sha256 === undefined ? {} : {
      runner_release_manifest_artifact_sha256: binding.runner_release_manifest_artifact_sha256,
    }),
    ...(binding.runner_ga_handoff_uri === undefined ? {} : {
      runner_ga_handoff_uri: binding.runner_ga_handoff_uri,
    }),
    ...(binding.runner_ga_handoff_manifest_input_sha256 === undefined ? {} : {
      runner_ga_handoff_manifest_input_sha256: binding.runner_ga_handoff_manifest_input_sha256,
    }),
    ...(binding.runner_ga_handoff_report_sha256 === undefined ? {} : {
      runner_ga_handoff_report_sha256: binding.runner_ga_handoff_report_sha256,
    }),
  };
}

function githubActionsRunAttemptUrl(canonicalRepo: string, runId: string, runAttempt: string): string {
  return `https://github.com/${githubRepoSlug(canonicalRepo)}/actions/runs/${runId}/attempts/${runAttempt}`;
}

function imageSourceArtifactUri(canonicalRepo: string, runId: string, subjectName: string): string {
  return `gh-artifact://${githubRepoSlug(canonicalRepo)}/${runId}/${subjectName}.oci`;
}

function githubRepoSlug(canonicalRepo: string): string {
  const prefix = 'github.com/';
  if (!canonicalRepo.startsWith(prefix)) {
    throw new Error(`canonical repo must start with ${prefix}`);
  }

  return canonicalRepo.slice(prefix.length);
}

function buildAppManifestTarget() {
  const contentKey = computeAppImageContentKey({
    files: [
      { path: 'package.json', content: '{"name":"agentsmith"}' },
      { path: 'src/app/page.tsx', content: 'export default function Page() { return null; }' },
      { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'FROM app-base' },
    ],
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
    },
    baseImages: [`docker.io/library/node:22-bookworm-slim@${LOCKED_DIGEST}`],
  });

  return buildBuildManifestTarget({
    target: 'app',
    releaseId: RELEASE_ID,
    imageName: 'ghcr.io/agentsmith-project/agentsmith-app',
    contentKey,
    imageDigest: APP_DIGEST,
    decision: 'built',
    producer: BUILD_PRODUCER,
    generatedAt: GENERATED_AT,
  });
}

function buildManifestAggregate(): CurrentBuildManifestAggregate {
  return buildBuildManifestAggregate({
    runId: 'build-run-20260523',
    releaseId: RELEASE_ID,
    versionPath: '/tmp/release/VERSION',
    mode: 'build',
    producer: BUILD_PRODUCER,
    targets: [buildAppManifestTarget()],
    generatedAt: GENERATED_AT,
  });
}

function buildDeployTemplatePackage(): CurrentDeployTemplatePackage {
  const subject: Omit<CurrentDeployTemplatePackage, 'artifact_provenance'> = {
    schema_version: 'agentsmith.deploy-template-package/v1',
    package_uri: 'gh-artifact://agentsmith/deploy-template-package/10001/agentsmith-deploy-template-package.tgz',
    package_sha256: `sha256:${'6'.repeat(64)}`,
    manifest_sha256: `sha256:${'7'.repeat(64)}`,
    required_image_ids: REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS,
  };

  return {
    ...subject,
    artifact_provenance: {
      schema_version: 'agentsmith.artifact-provenance/v1',
      provenance_kind: 'ci_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      subject_name: 'agentsmith-deploy-template-package',
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(subject)),
      subject_uri: 'deploy-template-package.json',
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1',
      job: 'package-deploy-template',
      artifact_uri: subject.package_uri,
      artifact_sha256: subject.package_sha256,
      generated_at: GENERATED_AT,
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function buildOpenApiSubject() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AgentSmith API',
      version: RELEASE_ID,
    },
    paths: {},
  };
}

function buildAsyncApiSubject() {
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'AgentSmith AsyncAPI',
      version: RELEASE_ID,
    },
    channels: {},
  };
}

function buildTargetProfiles(): AgentSmithReleaseContractGeneratorInput['target_profiles'] {
  return structuredClone(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES);
}

function buildReleaseContractInput(
  productImages: AgentSmithReleaseContractGeneratorInput['product_images'],
): AgentSmithReleaseContractGeneratorInput {
  const openapiSubject = buildOpenApiSubject();
  const asyncapiSubject = buildAsyncApiSubject();

  return {
    release_id: RELEASE_ID,
    git_sha: GIT_SHA,
    product_images: productImages,
    adopted_provider_images: [
      {
        id: 'llmup',
        image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION}@${LLMUP_DIGEST}`,
        digest: LLMUP_DIGEST,
      },
      {
        id: 'afscp',
        image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:${AFSCP_VERSION}@${AFSCP_DIGEST}`,
        digest: AFSCP_DIGEST,
      },
      {
        id: 'asbcp',
        image: `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}@${ASBCP_DIGEST}`,
        digest: ASBCP_DIGEST,
      },
    ],
    release_kit_prerequisite_images: [
      {
        id: 'ingress_nginx_controller',
        image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
        digest: `sha256:${'4'.repeat(64)}`,
      },
      {
        id: 'ingress_nginx_certgen',
        image: `registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:${'7'.repeat(64)}`,
        digest: `sha256:${'7'.repeat(64)}`,
      },
    ],
    image_source_provenance: [
      buildAppImageSourceProvenance(productImages),
      ...buildExternalImageSourceProvenance({
        asbcpDigest: ASBCP_DIGEST,
        asbcpVersion: ASBCP_VERSION,
      }),
    ],
    runnerImageLock: buildRunnerImageLock(),
    deploy_template_digest: `sha256:${'7'.repeat(64)}`,
    deploy_template_package: buildDeployTemplatePackage(),
    openapi_subject: openapiSubject,
    openapi_digest: sha256Digest(canonicalReleaseBoundaryJson(openapiSubject)),
    asyncapi_subject: asyncapiSubject,
    asyncapi_digest: sha256Digest(canonicalReleaseBoundaryJson(asyncapiSubject)),
    target_profiles: buildTargetProfiles(),
    min_release_kit_version: '0.1.0',
    ci_provenance: {
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      job: 'generate-release-contract',
      artifact_uri: 'gh-artifact://agentsmith/release-contract/10001/agentsmith-release-contract.json',
      generated_at: GENERATED_AT,
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function buildAssemblyInput(): AgentSmithReleaseContractGeneratorInputAssemblyInput {
  return {
    release_id: RELEASE_ID,
    git_sha: GIT_SHA,
    sourceGitSha: GIT_SHA,
    buildManifestAggregate: buildManifestAggregate(),
    deployTemplatePackage: buildDeployTemplatePackage(),
    openapi_subject: buildOpenApiSubject(),
    asyncapi_subject: buildAsyncApiSubject(),
    adopted_provider_images: [
      {
        id: 'llmup',
        image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION}@${LLMUP_DIGEST}`,
        digest: LLMUP_DIGEST,
      },
      {
        id: 'afscp',
        image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:${AFSCP_VERSION}@${AFSCP_DIGEST}`,
        digest: AFSCP_DIGEST,
      },
      {
        id: 'asbcp',
        image: `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}@${ASBCP_DIGEST}`,
        digest: ASBCP_DIGEST,
      },
    ],
    release_kit_prerequisite_images: [
      {
        id: 'ingress_nginx_controller',
        image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
        digest: `sha256:${'4'.repeat(64)}`,
      },
      {
        id: 'ingress_nginx_certgen',
        image: `registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:${'7'.repeat(64)}`,
        digest: `sha256:${'7'.repeat(64)}`,
      },
    ],
    external_image_source_provenance: buildExternalImageSourceProvenance({
      asbcpDigest: ASBCP_DIGEST,
      asbcpVersion: ASBCP_VERSION,
    }),
    runnerImageLock: buildRunnerImageLock(),
    target_profiles: buildTargetProfiles(),
    min_release_kit_version: '0.1.0',
    ci_provenance: {
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      job: 'generate-release-contract',
      artifact_uri: 'gh-artifact://agentsmith/release-contract/10001/agentsmith-release-contract.json',
      generated_at: GENERATED_AT,
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function expectBuildProductImagesToThrow(value: unknown, expected: string): void {
  expect(() => buildProductImagesFromBuildManifest(value, { expectedReleaseId: RELEASE_ID })).toThrow(expected);
}

function expectAssemblyToThrow(
  input: AgentSmithReleaseContractGeneratorInputAssemblyInput,
  expected: string,
): void {
  expect(() => assembleReleaseContractGeneratorInput(input)).toThrow(expected);
}

function writeAssemblyInput(root: string, input: AgentSmithReleaseContractGeneratorInputAssemblyInput): string {
  const inputPath = join(root, 'assembly-input.json');
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return inputPath;
}

function buildArtifactProducerInput(): Record<string, unknown> {
  const input = JSON.parse(JSON.stringify(buildAssemblyInput())) as Record<string, unknown>;
  delete input.sourceGitSha;
  delete input.ci_provenance;
  delete input.runnerImageLock;
  delete input.external_image_source_provenance;
  return input;
}

interface RunnerManifestSourceMetadataPaths {
  manifestPath: string;
  remoteManifestPath: string;
  handoffReportPath: string;
  runViewPath: string;
  runApiPath: string;
  artifactsApiPath: string;
}

interface RunnerManifestSourceMetadataFixture {
  runView: Record<string, unknown>;
  runApi: Record<string, unknown>;
  artifactsApi: {
    artifacts: Record<string, unknown>[];
    total_count: number;
  };
}

interface AsbcpFinalManifestSourceMetadataPaths {
  manifestPath: string;
  releaseApiPath: string;
  assetApiPath: string;
  llmupSourceGatePath: string;
  afscpSourceGatePath: string;
}

interface AsbcpFinalManifestSourceMetadataFixture {
  manifest: Record<string, unknown>;
  releaseApi: {
    assets: Record<string, unknown>[];
    [key: string]: unknown;
  };
  assetApi: Record<string, unknown>;
}

interface DependencyImageSourceFixtureConfig {
  providerId: 'llmup' | 'afscp';
  repoSlug: string;
  imageRepository: string;
  version: string;
  digest: string;
  commitSha: string;
  releaseUrl: string;
  releaseId: number;
  tagObjectSha: string;
  sourceRunId: string;
  sourceRunAttempt: string;
  sourceSubjectName: string;
}

interface DependencyImageSourceGateFixture {
  provider_id: 'llmup' | 'afscp';
  repo_slug: string;
  commit_sha: string;
  run_id: string;
  run_attempt: string;
  run_url: string;
  subject_name: string;
  artifact_uri: string;
  release_api: Record<string, unknown>;
  tag_ref_api: Record<string, unknown>;
  tag_object_api: Record<string, unknown>;
  observed_ghcr_digest: string;
  check_command: string;
}

function writeCanonicalRunnerImageLock(root: string): void {
  const lockPath = join(root, CANONICAL_RUNNER_IMAGE_LOCK_RELATIVE_PATH);
  mkdirSync(join(lockPath, '..'), { recursive: true });
  writeFileSync(lockPath, readFileSync(CANONICAL_RUNNER_IMAGE_LOCK_PATH, 'utf8'), 'utf8');
}

function writeCanonicalRunnerReleaseManifest(root: string): string {
  const manifestPath = join(root, CANONICAL_RUNNER_RELEASE_MANIFEST_RELATIVE_PATH);
  mkdirSync(join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary'), { recursive: true });
  writeFileSync(manifestPath, readFileSync(CANONICAL_RUNNER_RELEASE_MANIFEST_PATH, 'utf8'), 'utf8');
  return manifestPath;
}

function writeRunnerManifestSourceMetadata(
  root: string,
  mutate: (metadata: RunnerManifestSourceMetadataFixture) => void = () => undefined,
): RunnerManifestSourceMetadataPaths {
  const manifestPath = writeCanonicalRunnerReleaseManifest(root);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const provenance = manifest.artifact_provenance as Record<string, unknown>;
  const runId = String(provenance.run_id);
  const runIdNumber = Number(runId);
  const runAttempt = Number(provenance.run_attempt);
  const headSha = String(manifest.git_sha);
  const workflowName = String(provenance.workflow_name);
  const artifactName = String(provenance.subject_name);
  const artifactId = 987654321;
  const metadataRoot = join(root, 'runner-manifest-source-metadata');
  const metadata: RunnerManifestSourceMetadataFixture = {
    runView: {
      conclusion: 'success',
      databaseId: runIdNumber,
      headSha,
      status: 'completed',
      url: `https://github.com/agentsmith-project/agentsmith-runner/actions/runs/${runId}`,
      workflowName,
    },
    runApi: {
      id: runIdNumber,
      run_attempt: runAttempt,
      repository: {
        full_name: 'agentsmith-project/agentsmith-runner',
      },
      head_repository: {
        full_name: 'agentsmith-project/agentsmith-runner',
      },
      name: workflowName,
      head_sha: headSha,
      status: 'completed',
      conclusion: 'success',
      html_url: `https://github.com/agentsmith-project/agentsmith-runner/actions/runs/${runId}`,
    },
    artifactsApi: {
      total_count: 1,
      artifacts: [
        {
          id: artifactId,
          name: artifactName,
          url: `https://api.github.com/repos/agentsmith-project/agentsmith-runner/actions/artifacts/${artifactId}`,
          archive_download_url:
            `https://api.github.com/repos/agentsmith-project/agentsmith-runner/actions/artifacts/${artifactId}/zip`,
          expired: false,
          created_at: '2026-05-31T13:39:29.000Z',
          expires_at: '2026-08-29T13:39:29.000Z',
          digest: RUNNER_REMOTE_ARTIFACT_DIGEST,
          workflow_run: {
            id: runIdNumber,
            head_sha: headSha,
          },
        },
      ],
    },
  };

  mutate(metadata);
  mkdirSync(metadataRoot, { recursive: true });
  mkdirSync(join(metadataRoot, 'artifact-download'), { recursive: true });
  const paths = {
    manifestPath,
    remoteManifestPath: join(metadataRoot, 'artifact-download', 'runner-release-manifest.json'),
    handoffReportPath: join(metadataRoot, 'handoff-download', 'runner-ga-handoff-report.json'),
    runViewPath: join(metadataRoot, 'run-view.json'),
    runApiPath: join(metadataRoot, 'run-api.json'),
    artifactsApiPath: join(metadataRoot, 'artifacts-api.json'),
  };
  const remoteManifestText = `${canonicalReleaseBoundaryJson(manifest)}\n`;
  mkdirSync(join(metadataRoot, 'handoff-download'), { recursive: true });
  writeFileSync(paths.remoteManifestPath, remoteManifestText);
  writeFileSync(paths.handoffReportPath, `${JSON.stringify(buildRunnerGaHandoffReport(manifest, remoteManifestText), null, 2)}\n`);
  writeFileSync(paths.runViewPath, `${JSON.stringify(metadata.runView, null, 2)}\n`);
  writeFileSync(paths.runApiPath, `${JSON.stringify(metadata.runApi, null, 2)}\n`);
  writeFileSync(paths.artifactsApiPath, `${JSON.stringify(metadata.artifactsApi, null, 2)}\n`);
  return paths;
}

function buildRunnerGaHandoffReport(
  manifest: Record<string, unknown>,
  remoteManifestText: string,
): Record<string, unknown> {
  const image = manifest.image as Record<string, unknown>;
  const contractArtifact = manifest.contract_artifact as Record<string, unknown>;
  const provenance = manifest.artifact_provenance as Record<string, unknown>;

  return {
    schema_version: 'agentsmith.runner-ga-handoff-report/v1',
    scope: 'runner_ga_handoff_evidence',
    status: 'pass',
    generated_at: GENERATED_AT,
    runner: manifest.runner,
    release_id: manifest.release_id,
    git_sha: manifest.git_sha,
    runner_contract_version: manifest.runner_contract_version,
    supported_protocol_versions: manifest.supported_protocol_versions,
    image: {
      id: image.id,
      image: image.image,
      digest: image.digest,
    },
    contract_artifact: {
      package_uri: contractArtifact.package_uri,
      package_sha256: contractArtifact.package_sha256,
      descriptor_subject_sha256: contractArtifact.descriptor_subject_sha256,
    },
    manifest: {
      input_sha256: sha256Digest(remoteManifestText),
      artifact_uri: provenance.artifact_uri,
      subject_sha256: provenance.subject_sha256,
      artifact_sha256: provenance.artifact_sha256,
    },
    provenance: {
      producer_repo: provenance.producer_repo,
      normalized_remote: provenance.normalized_remote,
      workflow_name: provenance.workflow_name,
      job: provenance.job,
      run_id: provenance.run_id,
      run_attempt: provenance.run_attempt,
      commit_sha: provenance.commit_sha,
    },
    checks: [
      { name: 'runner_release_manifest', status: 'pass' },
      { name: 'digest_pinned_runner_image', status: 'pass' },
      { name: 'contract_artifact_binding', status: 'pass' },
      { name: 'adoption_policy_declared', status: 'pass' },
    ],
    notes: [
      'Runner GA handoff is evidence for AgentSmith adoption and release-kit final aggregation.',
      'It does not issue formal_verdict and does not update AgentSmith locks.',
    ],
  };
}

function buildAsbcpFinalManifest(): Record<string, unknown> {
  const imageRef = `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}@${ASBCP_DIGEST}`;
  const tagRef = `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}`;
  return {
    schema_id: 'https://agentsmith.dev/schemas/asbcp/final-manifest.v1.json',
    manifest_schema_version: 'v1',
    asbcp_version: ASBCP_VERSION,
    git_tag: ASBCP_VERSION,
    commit_sha: ASBCP_COMMIT_SHA,
    image_ref: imageRef,
    image_digest: ASBCP_DIGEST,
    api_contract_version: 'v1',
    anonymous_pull: {
      result: 'ok',
      tag_ref: tagRef,
      image_ref: imageRef,
      tag_resolved_digest: ASBCP_DIGEST,
      build_push_digest: ASBCP_DIGEST,
      anonymous_digest: ASBCP_DIGEST,
      docker_config: 'fresh-empty',
      commands: [
        `DOCKER_CONFIG=<fresh-empty> docker pull ${tagRef}`,
        `DOCKER_CONFIG=<fresh-empty> docker pull ${imageRef}`,
      ],
    },
    same_digest_proof: {
      tag_resolved_digest: ASBCP_DIGEST,
      build_push_digest: ASBCP_DIGEST,
      anonymous_digest: ASBCP_DIGEST,
      matches: true,
      source: 'fresh-empty Docker config docker pull image:tag and image:tag@build_push_digest',
    },
    known_breaking_changes: [
      {
        id: ASBCP_BREAKING_CHANGE_ID,
        summary: 'pre-GA ASBCP release evidence clean cut.',
      },
    ],
    changelog_summary: 'ASBCP release evidence schema clean cut.',
    known_risk_status: 'no release-blocking risks',
    known_risk_status_source: 'docs/RISK_REGISTER.md release_blocking column',
    runbook_url:
      `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/blob/${ASBCP_COMMIT_SHA}/docs/runbooks/release.md`,
    release_notes: {
      body_source: [
        '## ASBCP Release',
        `Version: ${ASBCP_VERSION}`,
        `Git tag: ${ASBCP_VERSION}`,
        `Commit SHA: ${ASBCP_COMMIT_SHA}`,
        'API contract version: v1',
        `Image ref: \`${imageRef}\``,
        `Image digest: \`${ASBCP_DIGEST}\``,
      ].join('\n'),
      github_release_url: ASBCP_RELEASE_URL,
    },
    release_gate: 'scripts/verify-release.sh',
  };
}

function writeCanonicalAsbcpImageLock(root: string): void {
  const lockPath = join(root, 'infra', 'deploy', 'shared', 'asbcp-image.lock');
  mkdirSync(join(root, 'infra', 'deploy', 'shared'), { recursive: true });
  writeFileSync(lockPath, [
    `asbcp_version=${ASBCP_VERSION}`,
    `asbcp_source_image=${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}@${ASBCP_DIGEST}`,
    `asbcp_release_url=${ASBCP_RELEASE_URL}`,
    `asbcp_commit_sha=${ASBCP_COMMIT_SHA}`,
    '',
  ].join('\n'));
}

function writeCanonicalDependencyImageLock(root: string, config: DependencyImageSourceFixtureConfig): void {
  const lockPath = join(root, 'infra', 'deploy', 'shared', `${config.providerId}-image.lock`);
  mkdirSync(join(root, 'infra', 'deploy', 'shared'), { recursive: true });
  writeFileSync(lockPath, [
    `${config.providerId}_version=${config.version}`,
    `${config.providerId}_source_image=${config.imageRepository}:${config.version}@${config.digest}`,
    `${config.providerId}_release_url=${config.releaseUrl}`,
    `${config.providerId}_commit_sha=${config.commitSha}`,
    '',
  ].join('\n'));
}

function buildDependencyImageSourceGateFixture(
  config: DependencyImageSourceFixtureConfig,
): DependencyImageSourceGateFixture {
  return {
    provider_id: config.providerId,
    repo_slug: config.repoSlug,
    commit_sha: config.commitSha,
    run_id: config.sourceRunId,
    run_attempt: config.sourceRunAttempt,
    run_url: `https://github.com/${config.repoSlug}/actions/runs/${config.sourceRunId}/attempts/${config.sourceRunAttempt}`,
    subject_name: config.sourceSubjectName,
    artifact_uri: `gh-artifact://${config.repoSlug}/${config.sourceRunId}/${config.sourceSubjectName}.oci`,
    release_api: {
      id: config.releaseId,
      tag_name: config.version,
      target_commitish: 'main',
      name: config.version,
      url: `https://api.github.com/repos/${config.repoSlug}/releases/tags/${config.version}`,
      html_url: config.releaseUrl,
      created_at: '2026-05-31T13:50:00.000Z',
      published_at: '2026-05-31T14:02:00.000Z',
      updated_at: '2026-05-31T14:02:00.000Z',
      assets: [],
    },
    tag_ref_api: {
      ref: `refs/tags/${config.version}`,
      object: {
        type: 'tag',
        sha: config.tagObjectSha,
        url: `https://api.github.com/repos/${config.repoSlug}/git/tags/${config.tagObjectSha}`,
      },
    },
    tag_object_api: {
      sha: config.tagObjectSha,
      tag: config.version,
      object: {
        type: 'commit',
        sha: config.commitSha,
        url: `https://api.github.com/repos/${config.repoSlug}/git/commits/${config.commitSha}`,
      },
    },
    observed_ghcr_digest: config.digest,
    check_command: `docker buildx imagetools inspect ${config.imageRepository}:${config.version} --format '{{.Manifest.Digest}}'`,
  };
}

function writeDependencyImageSourceGate(
  root: string,
  config: DependencyImageSourceFixtureConfig,
  mutate: (sourceGate: DependencyImageSourceGateFixture) => void = () => undefined,
): string {
  writeCanonicalDependencyImageLock(root, config);
  const metadataRoot = join(root, `${config.providerId}-image-source-metadata`);
  const sourceGate = buildDependencyImageSourceGateFixture(config);

  mutate(sourceGate);
  mkdirSync(metadataRoot, { recursive: true });
  const sourceGatePath = join(metadataRoot, 'source-gate.json');
  writeFileSync(sourceGatePath, `${JSON.stringify(sourceGate, null, 2)}\n`);
  return sourceGatePath;
}

function writeDependencyImageSourceGates(root: string): Pick<
  AsbcpFinalManifestSourceMetadataPaths,
  'llmupSourceGatePath' | 'afscpSourceGatePath'
> {
  return {
    llmupSourceGatePath: writeDependencyImageSourceGate(root, {
      providerId: 'llmup',
      repoSlug: 'agentsmith-project/llm-universal-proxy',
      imageRepository: LLMUP_PROVIDER_IMAGE_REPOSITORY,
      version: LLMUP_VERSION,
      digest: LLMUP_DIGEST,
      commitSha: LLMUP_COMMIT_SHA,
      releaseUrl: LLMUP_RELEASE_URL,
      releaseId: 331570298,
      tagObjectSha: '5bac2cd8cc316c27a42a4fbdd21b986600bfaadf',
      sourceRunId: LLMUP_SOURCE_RUN_ID,
      sourceRunAttempt: LLMUP_SOURCE_RUN_ATTEMPT,
      sourceSubjectName: LLMUP_SOURCE_SUBJECT_NAME,
    }),
    afscpSourceGatePath: writeDependencyImageSourceGate(root, {
      providerId: 'afscp',
      repoSlug: 'agentsmith-project/agentsmith-fs-control-plane',
      imageRepository: AFSCP_PROVIDER_IMAGE_REPOSITORY,
      version: AFSCP_VERSION,
      digest: AFSCP_DIGEST,
      commitSha: AFSCP_COMMIT_SHA,
      releaseUrl: AFSCP_RELEASE_URL,
      releaseId: 326107668,
      tagObjectSha: '9f4f16a691049da6065a2bd45720c652e6fed171',
      sourceRunId: AFSCP_SOURCE_RUN_ID,
      sourceRunAttempt: AFSCP_SOURCE_RUN_ATTEMPT,
      sourceSubjectName: AFSCP_SOURCE_SUBJECT_NAME,
    }),
  };
}

function writeAsbcpFinalManifestSourceMetadata(
  root: string,
  mutate: (metadata: AsbcpFinalManifestSourceMetadataFixture) => void = () => undefined,
): AsbcpFinalManifestSourceMetadataPaths {
  writeCanonicalAsbcpImageLock(root);
  const dependencySourceGates = writeDependencyImageSourceGates(root);
  const metadataRoot = join(root, 'asbcp-final-manifest-source-metadata');
  const assetId = 246802468;
  const manifest = buildAsbcpFinalManifest();
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = sha256Digest(manifestText);
  const assetApi = {
    id: assetId,
    name: ASBCP_FINAL_MANIFEST_ASSET_NAME,
    url: `https://api.github.com/repos/agentsmith-project/agentsmith-sandbox-control-plane/releases/assets/${assetId}`,
    browser_download_url:
      `${ASBCP_RELEASE_URL}/download/${ASBCP_FINAL_MANIFEST_ASSET_NAME}`,
    content_type: 'application/json',
    state: 'uploaded',
    size: Buffer.byteLength(manifestText, 'utf8'),
    digest: manifestSha256,
    created_at: '2026-05-31T14:00:00.000Z',
    updated_at: '2026-05-31T14:01:00.000Z',
  };
  const metadata: AsbcpFinalManifestSourceMetadataFixture = {
    manifest,
    releaseApi: {
      id: 975310864,
      tag_name: ASBCP_VERSION,
      target_commitish: ASBCP_COMMIT_SHA,
      name: ASBCP_VERSION,
      url: `https://api.github.com/repos/agentsmith-project/agentsmith-sandbox-control-plane/releases/tags/${ASBCP_VERSION}`,
      html_url: ASBCP_RELEASE_URL,
      created_at: '2026-05-31T13:50:00.000Z',
      published_at: '2026-05-31T14:02:00.000Z',
      updated_at: '2026-05-31T14:02:00.000Z',
      assets: [assetApi],
    },
    assetApi,
  };

  mutate(metadata);
  mkdirSync(metadataRoot, { recursive: true });
  const paths = {
    manifestPath: join(metadataRoot, ASBCP_FINAL_MANIFEST_ASSET_NAME),
    releaseApiPath: join(metadataRoot, 'release-api.json'),
    assetApiPath: join(metadataRoot, 'asset-api.json'),
    ...dependencySourceGates,
  };
  writeFileSync(paths.manifestPath, `${JSON.stringify(metadata.manifest, null, 2)}\n`);
  writeFileSync(paths.releaseApiPath, `${JSON.stringify(metadata.releaseApi, null, 2)}\n`);
  writeFileSync(paths.assetApiPath, `${JSON.stringify(metadata.assetApi, null, 2)}\n`);
  writeFileSync(join(metadataRoot, 'source-provenance.json'), `${JSON.stringify({
    repo_slug: 'agentsmith-project/agentsmith-sandbox-control-plane',
    commit_sha: ASBCP_COMMIT_SHA,
    run_id: ASBCP_SOURCE_RUN_ID,
    run_attempt: ASBCP_SOURCE_RUN_ATTEMPT,
    run_url:
      `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/actions/runs/${ASBCP_SOURCE_RUN_ID}/attempts/${ASBCP_SOURCE_RUN_ATTEMPT}`,
    subject_name: ASBCP_SOURCE_SUBJECT_NAME,
    artifact_uri:
      `gh-artifact://agentsmith-project/agentsmith-sandbox-control-plane/${ASBCP_SOURCE_RUN_ID}/${ASBCP_SOURCE_SUBJECT_NAME}.oci`,
  }, null, 2)}\n`);
  return paths;
}

function runnerManifestSourceEnv(
  paths: RunnerManifestSourceMetadataPaths,
): Readonly<Record<string, string>> {
  return {
    RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH: paths.remoteManifestPath,
    RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH: paths.handoffReportPath,
    RUNNER_RELEASE_MANIFEST_SOURCE_RUN_VIEW_PATH: paths.runViewPath,
    RUNNER_RELEASE_MANIFEST_SOURCE_RUN_API_PATH: paths.runApiPath,
    RUNNER_RELEASE_MANIFEST_SOURCE_ARTIFACTS_API_PATH: paths.artifactsApiPath,
  };
}

function asbcpFinalManifestSourceEnv(
  paths: AsbcpFinalManifestSourceMetadataPaths,
): Readonly<Record<string, string>> {
  return {
    ASBCP_FINAL_MANIFEST_SOURCE_MANIFEST_PATH: paths.manifestPath,
    ASBCP_FINAL_MANIFEST_SOURCE_RELEASE_API_PATH: paths.releaseApiPath,
    ASBCP_FINAL_MANIFEST_SOURCE_ASSET_API_PATH: paths.assetApiPath,
    LLMUP_IMAGE_SOURCE_GATE_PATH: paths.llmupSourceGatePath,
    AFSCP_IMAGE_SOURCE_GATE_PATH: paths.afscpSourceGatePath,
  };
}

function artifactProducerSourceEnv(
  runnerPaths: RunnerManifestSourceMetadataPaths,
  asbcpPaths: AsbcpFinalManifestSourceMetadataPaths,
): Readonly<Record<string, string>> {
  return {
    ...runnerManifestSourceEnv(runnerPaths),
    ...asbcpFinalManifestSourceEnv(asbcpPaths),
  };
}

function artifactProducerArgv(
  inputPath: string,
  outputDir: string,
  paths: RunnerManifestSourceMetadataPaths,
  asbcpPaths: AsbcpFinalManifestSourceMetadataPaths,
): string[] {
  return [
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--runner-manifest',
    paths.manifestPath,
    '--runner-remote-manifest',
    paths.remoteManifestPath,
    '--runner-ga-handoff',
    paths.handoffReportPath,
    '--runner-run-view',
    paths.runViewPath,
    '--runner-run-api',
    paths.runApiPath,
    '--runner-artifacts-api',
    paths.artifactsApiPath,
    '--llmup-source-gate',
    asbcpPaths.llmupSourceGatePath,
    '--afscp-source-gate',
    asbcpPaths.afscpSourceGatePath,
    '--asbcp-final-manifest',
    asbcpPaths.manifestPath,
    '--asbcp-release-api',
    asbcpPaths.releaseApiPath,
    '--asbcp-asset-api',
    asbcpPaths.assetApiPath,
  ];
}

function writeArtifactProducerInput(root: string, input: Record<string, unknown>): string {
  const inputPath = join(root, 'release-contract-input.json');
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return inputPath;
}

function rehashRunnerManifestProvenance(manifest: Record<string, unknown>): void {
  const subject = { ...manifest };
  delete subject.artifact_provenance;
  const digest = sha256Digest(canonicalReleaseBoundaryJson(subject));
  const provenance = manifest.artifact_provenance as Record<string, unknown>;
  provenance.subject_sha256 = digest;
  provenance.artifact_sha256 = digest;
}

function githubReleaseContractEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    GITHUB_SHA: GIT_SHA,
    GITHUB_REPOSITORY: 'agentsmith-project/agentsmith',
    GITHUB_WORKFLOW: 'Release Contract Artifact',
    GITHUB_RUN_ID: '10001',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'generate-release-contract',
    AGENTSMITH_RELEASE_CONTRACT_GENERATED_AT: GENERATED_AT,
    ...overrides,
  };
}

function assemblyCliArgv(inputPath: string, outputPath?: string): string[] {
  const argv = [...CLI_SOURCE_ARGV, '--input', inputPath];
  if (outputPath) {
    argv.push('--output', outputPath);
  }
  return argv;
}

describe('release contract input adapter', () => {
  it('assembles generator input from explicit build, template, contract subject, image and CI inputs', () => {
    const input = buildAssemblyInput();
    const generatorInput = assembleReleaseContractGeneratorInput(input);
    const contract = generateAgentSmithReleaseContract(generatorInput, SOURCE_OPTIONS);
    const appProductImages = buildProductImagesFromBuildManifest(input.buildManifestAggregate, {
      expectedReleaseId: RELEASE_ID,
    });

    expect(generatorInput.product_images).toEqual(appProductImages);
    expect(generatorInput.deploy_template_package).toBe(input.deployTemplatePackage);
    expect(generatorInput.deploy_template_digest).toBe(input.deployTemplatePackage.manifest_sha256);
    expect(generatorInput.runnerImageLock).toEqual(input.runnerImageLock);
    expect(generatorInput.image_source_provenance).toEqual([
      buildAppImageSourceProvenance(appProductImages),
      ...(input.external_image_source_provenance ?? []),
    ]);
    expect(generatorInput.openapi_subject).toBe(input.openapi_subject);
    expect(generatorInput.asyncapi_subject).toBe(input.asyncapi_subject);
    expect('deploy_image_inventory' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect('artifact_provenance' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory).toContainEqual({
      ...appProductImages[0],
      source: 'product_images',
      source_provenance: sourceProvenanceFor(generatorInput.image_source_provenance, 'agentsmith_app'),
    });
    expect(contract.managed_runner_image).toEqual(RUNNER_IMAGE_LOCK.image);
    expect(contract.deploy_image_inventory).toContainEqual({
      id: 'managed_runner',
      image: RUNNER_IMAGE_LOCK.image.image,
      digest: RUNNER_IMAGE_LOCK.image.digest,
      source: 'managed_runner_image',
      source_provenance: sourceProvenanceFor(generatorInput.image_source_provenance, 'managed_runner'),
    });
    expect(contract.product_images.map((image) => image.id)).toEqual(['agentsmith_app']);
  });

  it('fails fast when release id, git sha, or deploy template provenance drift from the explicit source binding', () => {
    const buildManifestDrift = buildAssemblyInput();
    const aggregate = buildManifestAggregate();
    buildManifestDrift.buildManifestAggregate = {
      ...aggregate,
      release_id: '2026.05.23-other',
      targets: [{ ...aggregate.targets[0], release_id: '2026.05.23-other' }],
    };
    expectAssemblyToThrow(
      buildManifestDrift,
      'build manifest app target release_id must match expected release_id',
    );

    const sourceGitShaDrift = buildAssemblyInput();
    sourceGitShaDrift.sourceGitSha = 'ffffffffffffffffffffffffffffffffffffffff';
    expectAssemblyToThrow(sourceGitShaDrift, 'git_sha must match sourceGitSha');

    const deployTemplateCommitDrift = buildAssemblyInput();
    deployTemplateCommitDrift.deployTemplatePackage.artifact_provenance.commit_sha =
      'ffffffffffffffffffffffffffffffffffffffff';
    expectAssemblyToThrow(
      deployTemplateCommitDrift,
      'deployTemplatePackage.artifact_provenance.commit_sha must match git_sha',
    );
  });

  it('uses deploy template manifest_sha256 as the only deploy_template_digest source', () => {
    const input = buildAssemblyInput();
    const generatorInput = assembleReleaseContractGeneratorInput(input);

    expect(generatorInput.deploy_template_digest).toBe(input.deployTemplatePackage.manifest_sha256);

    const driftInput = {
      ...buildAssemblyInput(),
      deploy_template_digest: `sha256:${'9'.repeat(64)}`,
    } as AgentSmithReleaseContractGeneratorInputAssemblyInput & { deploy_template_digest: string };

    expect(() => assembleReleaseContractGeneratorInput(driftInput)).toThrow(
      'deploy_template_digest must be assembled from deployTemplatePackage.manifest_sha256',
    );
  });

  it('fails fast when runnerImageLock is missing or invalid', () => {
    const missing = buildAssemblyInput() as Partial<AgentSmithReleaseContractGeneratorInputAssemblyInput>;
    delete missing.runnerImageLock;
    expect(() => assembleReleaseContractGeneratorInput(
      missing as AgentSmithReleaseContractGeneratorInputAssemblyInput,
    )).toThrow('runnerImageLock is required');

    const protocolDrift = buildAssemblyInput();
    protocolDrift.runnerImageLock.runner_protocol_version = '0.9';
    expectAssemblyToThrow(protocolDrift, 'runner_protocol_version must exactly equal "1.0"');

    const digestDrift = buildAssemblyInput();
    digestDrift.runnerImageLock.image.digest = `sha256:${'9'.repeat(64)}`;
    expectAssemblyToThrow(digestDrift, 'image.image digest must match image.digest');
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/agentsmith-deploy-template-package.tgz',
    './agentsmith-deploy-template-package.tgz',
  ])('leaves deploy template package artifact URI validation to the generator boundary for %s', (packageUri) => {
    const input = buildAssemblyInput();
    input.deployTemplatePackage.package_uri = packageUri;
    input.deployTemplatePackage.artifact_provenance.artifact_uri = input.deployTemplatePackage.package_uri;

    const generatorInput = assembleReleaseContractGeneratorInput(input);

    expect(() => generateAgentSmithReleaseContract(generatorInput, SOURCE_OPTIONS)).toThrow(
      'package_uri must be a remote/CI artifact URI',
    );
  });

  it('fails fast when CI provenance commit, workflow, run, job, artifact, or source fields are missing or drift', () => {
    const commitDrift = buildAssemblyInput();
    commitDrift.ci_provenance.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    expectAssemblyToThrow(commitDrift, 'ci_provenance.commit_sha must match git_sha');

    const requiredCases: readonly [
      keyof AgentSmithReleaseContractCiProvenanceInput,
      string,
    ][] = [
      ['commit_sha', 'ci_provenance.commit_sha must be a non-empty string'],
      ['workflow_name', 'ci_provenance.workflow_name must be a non-empty string'],
      ['run_id', 'ci_provenance.run_id must be a non-empty string'],
      ['run_attempt', 'ci_provenance.run_attempt must be a non-empty string'],
      ['job', 'ci_provenance.job must be a non-empty string'],
      ['artifact_uri', 'ci_provenance.artifact_uri must be a non-empty string'],
      ['producer_repo', 'ci_provenance.producer_repo must be a non-empty string'],
      ['normalized_remote', 'ci_provenance.normalized_remote must be a non-empty string'],
      ['generated_at', 'ci_provenance.generated_at must be a non-empty string'],
      ['generator_command', 'ci_provenance.generator_command must be a non-empty string'],
      ['generator_version', 'ci_provenance.generator_version must be a non-empty string'],
    ];

    for (const [field, expected] of requiredCases) {
      const missing = buildAssemblyInput();
      delete (missing.ci_provenance as Partial<AgentSmithReleaseContractCiProvenanceInput>)[field];
      expectAssemblyToThrow(missing, expected);
    }
  });

  it('fails fast when a required CI provenance field exists only on the prototype', () => {
    const input = buildAssemblyInput();
    const ciProvenance = { ...input.ci_provenance };
    delete (ciProvenance as Partial<AgentSmithReleaseContractCiProvenanceInput>).run_id;
    Object.setPrototypeOf(ciProvenance, { run_id: input.ci_provenance.run_id });
    input.ci_provenance = ciProvenance;

    expectAssemblyToThrow(input, 'ci_provenance.run_id must be a non-empty string');
  });

  it('fails fast when CI provenance attestation is missing or undefined', () => {
    const missing = buildAssemblyInput();
    delete (missing.ci_provenance as Partial<AgentSmithReleaseContractCiProvenanceInput>).attestation;
    expectAssemblyToThrow(missing, 'ci_provenance.attestation is required');

    const undefinedAttestation = buildAssemblyInput();
    (undefinedAttestation.ci_provenance as Partial<AgentSmithReleaseContractCiProvenanceInput>).attestation =
      undefined;
    expectAssemblyToThrow(undefinedAttestation, 'ci_provenance.attestation is required');
  });

  it.each([
    [
      'product_images',
      [],
      'product_images must be assembled from buildManifestAggregate',
    ],
    [
      'managed_runner_image',
      {
        id: 'managed_runner',
        image: `ghcr.io/agentsmith-project/agentsmith-managed-runner:${RELEASE_ID}@sha256:${'c'.repeat(64)}`,
        digest: `sha256:${'c'.repeat(64)}`,
      },
      'managed_runner_image must be assembled from runnerImageLock',
    ],
    [
      'managed_runner_image',
      RUNNER_IMAGE_LOCK.image,
      'managed_runner_image must be assembled from runnerImageLock',
    ],
    [
      'deploy_image_inventory',
      [],
      'deploy_image_inventory must be generated by release contract generator',
    ],
    [
      'image_source_provenance',
      [],
      'image_source_provenance must be assembled from release source receipts',
    ],
    [
      'artifact_provenance',
      {},
      'artifact_provenance must be generated by release contract generator',
    ],
  ])('rejects caller-provided generator-owned %s', (field, value, expected) => {
    const input = {
      ...buildAssemblyInput(),
      [field]: value,
    } as AgentSmithReleaseContractGeneratorInputAssemblyInput;

    expect(() => assembleReleaseContractGeneratorInput(input)).toThrow(expected);
  });

  it('requires an explicit expected release_id binding for build manifest product images', () => {
    const aggregate = buildManifestAggregate();

    expect(() => {
      // @ts-expect-error build manifest product images require an expected release_id binding.
      buildProductImagesFromBuildManifest(aggregate);
    }).toThrow('expected release_id');
  });

  it('fails fast when the build manifest app target release_id drifts from the expected release_id', () => {
    const aggregate = buildManifestAggregate();

    expect(() => {
      buildProductImagesFromBuildManifest(
        {
          ...aggregate,
          release_id: '2026.05.23-other',
          targets: [{ ...aggregate.targets[0], release_id: '2026.05.23-other' }],
        },
        { expectedReleaseId: RELEASE_ID },
      );
    }).toThrow('build manifest app target release_id must match expected release_id');
  });

  it('fails fast when the build manifest app target release_alias_ref points at another release alias', () => {
    const aggregate = buildManifestAggregate();

    expect(() => {
      buildProductImagesFromBuildManifest(
        {
          ...aggregate,
          targets: [
            {
              ...aggregate.targets[0],
              release_alias_ref: 'ghcr.io/agentsmith-project/agentsmith-app:release-2026.05.22-p1',
            },
          ],
        },
        { expectedReleaseId: RELEASE_ID },
      );
    }).toThrow('build manifest app target release_alias_ref must match expected release_id');
  });

  it('accepts a release_id that already includes the release alias prefix', () => {
    const aggregate = buildManifestAggregate();
    const prefixedReleaseId = 'release-2026.05.23-p1';

    const productImages = buildProductImagesFromBuildManifest(
      {
        ...aggregate,
        release_id: prefixedReleaseId,
        targets: [
          {
            ...aggregate.targets[0],
            release_id: prefixedReleaseId,
            release_alias_ref: 'ghcr.io/agentsmith-project/agentsmith-app:release-2026.05.23-p1',
          },
        ],
      },
      { expectedReleaseId: prefixedReleaseId },
    );

    expect(productImages[0]?.image).toBe(
      `ghcr.io/agentsmith-project/agentsmith-app:release-2026.05.23-p1@${APP_DIGEST}`,
    );
  });

  it('maps the single app build manifest target into release contract product images', () => {
    const productImages = buildProductImagesFromBuildManifest(buildManifestAggregate(), {
      expectedReleaseId: RELEASE_ID,
    });

    expect(productImages).toEqual([
      {
        id: 'agentsmith_app',
        image: `ghcr.io/agentsmith-project/agentsmith-app:release-${RELEASE_ID}@${APP_DIGEST}`,
        digest: APP_DIGEST,
      },
    ]);

    const generatorInput = buildReleaseContractInput(productImages);
    const contract = generateAgentSmithReleaseContract(generatorInput, SOURCE_OPTIONS);

    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory.filter((image) => image.source === 'product_images')).toEqual([
      {
        ...productImages[0],
        source: 'product_images',
        source_provenance: sourceProvenanceFor(generatorInput.image_source_provenance, 'agentsmith_app'),
      },
    ]);
  });

  it('fails fast when the build manifest aggregate is schema invalid', () => {
    const aggregate = buildManifestAggregate();

    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        manifest_kind: 'legacy_build_manifest',
      },
      'build manifest aggregate is invalid',
    );
  });

  it('fails fast when the manifest has no app target', () => {
    const aggregate = {
      ...buildManifestAggregate(),
      targets: [],
    };

    expectBuildProductImagesToThrow(aggregate, 'build manifest must contain exactly one app target');
  });

  it('fails fast when the manifest has multiple app targets', () => {
    const aggregate = buildManifestAggregate();

    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        targets: [aggregate.targets[0], { ...aggregate.targets[0], decision: 'reused' }],
      },
      'build manifest must contain exactly one app target',
    );
  });

  it('fails fast when the app target release_id drifts from aggregate release_id', () => {
    const aggregate = buildManifestAggregate();

    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        targets: [{ ...aggregate.targets[0], release_id: 'release-other' }],
      },
      'target release_id must match aggregate release_id',
    );
  });

  it('fails fast when the app target image digest is invalid', () => {
    const aggregate = buildManifestAggregate();

    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        targets: [{ ...aggregate.targets[0], image_digest: 'sha256:BAD' }],
      },
      'manifest.targets[0].image_digest',
    );
  });

  it('fails fast when the release alias is not a release alias or already contains a digest', () => {
    const aggregate = buildManifestAggregate();

    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        targets: [{ ...aggregate.targets[0], release_alias_ref: 'ghcr.io/agentsmith-project/agentsmith-app:latest' }],
      },
      'release_alias_ref must use a release- alias tag',
    );
    expectBuildProductImagesToThrow(
      {
        ...aggregate,
        targets: [{
          ...aggregate.targets[0],
          release_alias_ref: `${aggregate.targets[0]?.release_alias_ref}@${APP_DIGEST}`,
        }],
      },
      'release_alias_ref must not include a digest',
    );
  });
});

describe('release contract assembly CLI', () => {
  it('assembles a validated release contract from assembly inputs and writes the default output', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const input = buildAssemblyInput();
    input.ci_provenance.generator_command = 'npm run release:contract:assemble';
    const inputPath = writeAssemblyInput(root, input);
    const outputPath = join(root, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractAssembleCli({
      argv: assemblyCliArgv(inputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(stderr).toEqual([]);
    expect(exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    const contract = JSON.parse(readFileSync(outputPath, 'utf8')) as unknown;
    const validation = validateAgentSmithReleaseContract(contract);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error('expected valid release contract');
    }

    const expectedProductImages = [
      ...buildProductImagesFromBuildManifest(input.buildManifestAggregate, {
        expectedReleaseId: RELEASE_ID,
      }),
    ];
    const expectedImageSourceProvenance = [
      buildAppImageSourceProvenance(expectedProductImages),
      ...(input.external_image_source_provenance ?? []),
    ];
    expect(validation.value.product_images).toEqual(expectedProductImages);
    expect(validation.value.deploy_template_digest).toBe(input.deployTemplatePackage.manifest_sha256);
    expect(validation.value.openapi_digest).toBe(sha256Digest(canonicalReleaseBoundaryJson(input.openapi_subject)));
    expect(validation.value.asyncapi_digest).toBe(sha256Digest(canonicalReleaseBoundaryJson(input.asyncapi_subject)));
    expect(validation.value.target_profiles).toEqual(input.target_profiles);
    expect(validation.value.deploy_image_inventory).toEqual([
      ...expectedProductImages.map((image) => ({
        ...image,
        source: 'product_images' as const,
        source_provenance: sourceProvenanceFor(expectedImageSourceProvenance, image.id),
      })),
      ...input.adopted_provider_images.map((image) => ({
        ...image,
        source: 'adopted_provider_images' as const,
        source_provenance: sourceProvenanceFor(expectedImageSourceProvenance, image.id),
      })),
      ...input.release_kit_prerequisite_images.map((image) => ({
        ...image,
        source: 'release_kit_prerequisite_images' as const,
      })),
      {
        id: 'managed_runner',
        image: RUNNER_IMAGE_LOCK.image.image,
        digest: RUNNER_IMAGE_LOCK.image.digest,
        source: 'managed_runner_image',
        source_provenance: sourceProvenanceFor(expectedImageSourceProvenance, 'managed_runner'),
      },
    ]);
    expect(validation.value.artifact_provenance.generator_command).toBe('npm run release:contract:assemble');
  });

  it('writes to an explicit output path', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const inputPath = writeAssemblyInput(root, buildAssemblyInput());
    const outputPath = join(root, 'nested', 'contract.json');

    const exitCode = runReleaseContractAssembleCli({
      argv: assemblyCliArgv(inputPath, outputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(validateAgentSmithReleaseContract(JSON.parse(readFileSync(outputPath, 'utf8')) as unknown).ok).toBe(true);
  });

  it.each([
    [
      'deploy_template_digest',
      `sha256:${'9'.repeat(64)}`,
      'deploy_template_digest must be assembled from deployTemplatePackage.manifest_sha256',
    ],
    [
      'deploy_image_inventory',
      [],
      'deploy_image_inventory must be generated by release contract generator',
    ],
    [
      'image_source_provenance',
      [],
      'image_source_provenance must be assembled from release source receipts',
    ],
    [
      'artifact_provenance',
      {},
      'artifact_provenance must be generated by release contract generator',
    ],
  ])('fails fast when assembly input provides generator-owned %s', (field, value, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const input = {
      ...buildAssemblyInput(),
      [field]: value,
    } as AgentSmithReleaseContractGeneratorInputAssemblyInput;
    const inputPath = writeAssemblyInput(root, input);
    const outputPath = join(root, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractAssembleCli({
      argv: assemblyCliArgv(inputPath, outputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
  });

  it.each([
    ['template package commit drift', (input: AgentSmithReleaseContractGeneratorInputAssemblyInput) => {
      input.deployTemplatePackage.artifact_provenance.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    }, 'deployTemplatePackage.artifact_provenance.commit_sha must match git_sha'],
    ['CI provenance commit drift', (input: AgentSmithReleaseContractGeneratorInputAssemblyInput) => {
      input.ci_provenance.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    }, 'ci_provenance.commit_sha must match git_sha'],
    ['local artifact URI', (input: AgentSmithReleaseContractGeneratorInputAssemblyInput) => {
      input.ci_provenance.artifact_uri =
        'file:///home/percy/works/mbos-v1/agentsmith/agentsmith-release-contract.json';
    }, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI'],
    ['local source URI', (input: AgentSmithReleaseContractGeneratorInputAssemblyInput) => {
      input.ci_provenance.subject_uri = 'file:///home/percy/works/mbos-v1/agentsmith/src/app/page.tsx';
    }, 'artifact_provenance.subject_uri must not point at local AgentSmith product source'],
  ])('fails without output for %s', (_name, mutate, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const input = buildAssemblyInput();
    mutate(input);
    const inputPath = writeAssemblyInput(root, input);
    const outputPath = join(root, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractAssembleCli({
      argv: assemblyCliArgv(inputPath, outputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
  });

  it.each([
    {
      name: 'env source sha',
      argvFor: (inputPath: string, outputPath: string) => ['--input', inputPath, '--output', outputPath],
      env: {
        AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
      },
    },
    {
      name: 'explicit source sha',
      argvFor: (inputPath: string, outputPath: string) => [
        '--source-git-sha',
        'ffffffffffffffffffffffffffffffffffffffff',
        '--input',
        inputPath,
        '--output',
        outputPath,
      ],
      env: {},
    },
  ])('uses runtime $name instead of payload sourceGitSha and fails stale self-certified payloads', ({ argvFor, env }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const inputPath = writeAssemblyInput(root, buildAssemblyInput());
    const outputPath = join(root, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractAssembleCli({
      argv: argvFor(inputPath, outputPath),
      cwd: root,
      env,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('git_sha must match');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('lets explicit --source-git-sha take precedence over source sha env vars', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const inputPath = writeAssemblyInput(root, buildAssemblyInput());
    const outputPath = join(root, 'agentsmith-release-contract.json');

    const exitCode = runReleaseContractAssembleCli({
      argv: assemblyCliArgv(inputPath, outputPath),
      cwd: root,
      env: {
        AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
        GITHUB_SHA: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(validateAgentSmithReleaseContract(JSON.parse(readFileSync(outputPath, 'utf8')) as unknown).ok).toBe(true);
  });

  it.each([
    {
      name: 'default output',
      outputPathFor: (root: string) => join(root, 'agentsmith-release-contract.json'),
      argvFor: (inputPath: string) => assemblyCliArgv(inputPath),
    },
    {
      name: 'explicit output',
      outputPathFor: (root: string) => join(root, 'nested', 'contract.json'),
      argvFor: (inputPath: string, outputPath: string) => assemblyCliArgv(inputPath, outputPath),
    },
  ])('removes stale $name when assembly fails', ({ outputPathFor, argvFor }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-assembly-'));
    const outputPath = outputPathFor(root);
    const validInputPath = writeAssemblyInput(root, buildAssemblyInput());

    expect(runReleaseContractAssembleCli({
      argv: argvFor(validInputPath, outputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    expect(validateAgentSmithReleaseContract(JSON.parse(readFileSync(outputPath, 'utf8')) as unknown).ok).toBe(true);

    const invalidInput = buildAssemblyInput();
    invalidInput.deployTemplatePackage.artifact_provenance.commit_sha =
      'ffffffffffffffffffffffffffffffffffffffff';
    const invalidInputPath = writeAssemblyInput(root, invalidInput);

    const stderr: string[] = [];
    const exitCode = runReleaseContractAssembleCli({
      argv: argvFor(invalidInputPath, outputPath),
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('deployTemplatePackage.artifact_provenance.commit_sha must match git_sha');
    expect(existsSync(outputPath)).toBe(false);
  });
});

describe('release contract CI artifact producer', () => {
  it('writes a consumable release contract artifact with GitHub CI provenance only', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const runnerGaHandoffReceiptPath = join(outputDir, RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME);
    const llmupImageSourceReceiptPath = join(outputDir, LLMUP_IMAGE_SOURCE_RECEIPT_NAME);
    const afscpImageSourceReceiptPath = join(outputDir, AFSCP_IMAGE_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: artifactProducerArgv(inputPath, outputDir, runnerMetadata, asbcpMetadata),
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(stderr).toEqual([]);
    expect(exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(runnerManifestReceiptPath)).toBe(true);
    expect(existsSync(runnerGaHandoffReceiptPath)).toBe(true);
    expect(existsSync(llmupImageSourceReceiptPath)).toBe(true);
    expect(existsSync(afscpImageSourceReceiptPath)).toBe(true);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(true);

    const contract = JSON.parse(readFileSync(outputPath, 'utf8')) as unknown;
    const runnerManifestReceipt = JSON.parse(readFileSync(runnerManifestReceiptPath, 'utf8')) as Record<string, unknown>;
    const runnerGaHandoffReceipt = JSON.parse(readFileSync(runnerGaHandoffReceiptPath, 'utf8')) as Record<string, unknown>;
    const llmupImageSourceReceipt = JSON.parse(
      readFileSync(llmupImageSourceReceiptPath, 'utf8'),
    ) as Record<string, unknown>;
    const afscpImageSourceReceipt = JSON.parse(
      readFileSync(afscpImageSourceReceiptPath, 'utf8'),
    ) as Record<string, unknown>;
    const asbcpFinalManifestReceipt = JSON.parse(
      readFileSync(asbcpFinalManifestReceiptPath, 'utf8'),
    ) as Record<string, unknown>;
    const expectedRunnerManifestCanonicalSha256 = sha256Digest(
      canonicalReleaseBoundaryJson(JSON.parse(readFileSync(runnerMetadata.manifestPath, 'utf8'))),
    );
    const validation = validateAgentSmithReleaseContract(contract);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error('expected valid release contract artifact');
    }

    expect(validation.value.artifact_provenance).toMatchObject({
      provenance_kind: 'ci_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      subject_name: 'agentsmith-release-contract',
      subject_uri: 'agentsmith-release-contract.json',
      workflow_name: 'Release Contract Artifact',
      run_id: '10001',
      run_attempt: '2',
      run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/2',
      job: 'generate-release-contract',
      artifact_uri: 'gh-artifact://agentsmith-project/agentsmith/release-contract/10001/agentsmith-release-contract.json',
      generated_at: GENERATED_AT,
      generator_command: 'npm run release:contract:ci-artifact',
      generator_version: 'p1.1-release-contract-artifact',
      attestation: 'none',
    });
    expect(validation.value.managed_runner_image).toEqual(RUNNER_IMAGE_LOCK.image);
    expect(validation.value.deploy_image_inventory).toContainEqual({
      id: 'managed_runner',
      image: RUNNER_IMAGE_LOCK.image.image,
      digest: RUNNER_IMAGE_LOCK.image.digest,
      source: 'managed_runner_image',
      source_provenance: {
        producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
        normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
        commit_sha: RUNNER_IMAGE_LOCK.git_sha,
        tag: 'release-locked-safety-008dbbd',
        run_id: '26866339967',
        run_attempt: '1',
        run_url: 'https://github.com/agentsmith-project/agentsmith-runner/actions/runs/26866339967/attempts/1',
        subject_name: MANAGED_RUNNER_SOURCE_SUBJECT_NAME,
        artifact_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/26866339967/agentsmith-managed-runner-image.oci',
        artifact_sha256: RUNNER_IMAGE_LOCK.image.digest,
        runner_release_manifest_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26866339967/runner-release-manifest.json',
        runner_release_manifest_subject_sha256: RUNNER_IMAGE_LOCK.manifest.subject_sha256,
        runner_release_manifest_artifact_sha256: RUNNER_IMAGE_LOCK.manifest.artifact_sha256,
        runner_ga_handoff_uri: RUNNER_IMAGE_LOCK.handoff.report_artifact_uri,
        runner_ga_handoff_manifest_input_sha256: runnerGaHandoffReceipt.manifest_input_sha256,
        runner_ga_handoff_report_sha256: runnerGaHandoffReceipt.report_sha256,
      },
    });
    const deployInventoryById = new Map(validation.value.deploy_image_inventory.map((entry) => [entry.id, entry]));
    expect(deployInventoryById.get('agentsmith_app')?.source_provenance).toEqual({
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      tag: `release-${RELEASE_ID}`,
      run_id: '10001',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1',
      subject_name: 'agentsmith-app-image',
      artifact_uri: 'gh-artifact://agentsmith-project/agentsmith/10001/agentsmith-app-image.oci',
      artifact_sha256: APP_DIGEST,
    });
    expect(deployInventoryById.get('llmup')?.source_provenance).toEqual({
      producer_repo: 'github.com/agentsmith-project/llm-universal-proxy',
      normalized_remote: 'github.com/agentsmith-project/llm-universal-proxy',
      commit_sha: LLMUP_COMMIT_SHA,
      tag: LLMUP_VERSION,
      run_id: LLMUP_SOURCE_RUN_ID,
      run_attempt: LLMUP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/llm-universal-proxy/actions/runs/${LLMUP_SOURCE_RUN_ID}/attempts/${LLMUP_SOURCE_RUN_ATTEMPT}`,
      subject_name: LLMUP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/llm-universal-proxy/${LLMUP_SOURCE_RUN_ID}/${LLMUP_SOURCE_SUBJECT_NAME}.oci`,
      artifact_sha256: LLMUP_DIGEST,
    });
    expect(deployInventoryById.get('afscp')?.source_provenance).toEqual({
      producer_repo: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      commit_sha: AFSCP_COMMIT_SHA,
      tag: AFSCP_VERSION,
      run_id: AFSCP_SOURCE_RUN_ID,
      run_attempt: AFSCP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/agentsmith-fs-control-plane/actions/runs/${AFSCP_SOURCE_RUN_ID}/attempts/${AFSCP_SOURCE_RUN_ATTEMPT}`,
      subject_name: AFSCP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/agentsmith-fs-control-plane/${AFSCP_SOURCE_RUN_ID}/${AFSCP_SOURCE_SUBJECT_NAME}.oci`,
      artifact_sha256: AFSCP_DIGEST,
    });
    expect(deployInventoryById.get('asbcp')?.source_provenance).toEqual({
      producer_repo: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      commit_sha: ASBCP_COMMIT_SHA,
      tag: ASBCP_VERSION,
      run_id: ASBCP_SOURCE_RUN_ID,
      run_attempt: ASBCP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/actions/runs/${ASBCP_SOURCE_RUN_ID}/attempts/${ASBCP_SOURCE_RUN_ATTEMPT}`,
      subject_name: ASBCP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/agentsmith-sandbox-control-plane/${ASBCP_SOURCE_RUN_ID}/${ASBCP_SOURCE_SUBJECT_NAME}.oci`,
      artifact_sha256: ASBCP_DIGEST,
    });
    expect(runnerManifestReceipt).toMatchObject({
      schema_version: RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
      source_kind: 'github_actions_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
      producer_repo_slug: 'agentsmith-project/agentsmith-runner',
      manifest_path: 'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json',
      manifest_digest_kind: 'stable_json_canonical_sha256',
      local_manifest_canonical_sha256: expectedRunnerManifestCanonicalSha256,
      remote_manifest_canonical_sha256: expectedRunnerManifestCanonicalSha256,
      manifest_canonical_digest_match: true,
      manifest_release_id: RUNNER_IMAGE_LOCK.release_id,
      manifest_git_sha: RUNNER_IMAGE_LOCK.git_sha,
      manifest_subject_sha256: RUNNER_IMAGE_LOCK.manifest.subject_sha256,
      manifest_provenance_artifact_sha256: RUNNER_IMAGE_LOCK.manifest.artifact_sha256,
      run_id: '26866339967',
      run_attempt: '1',
      workflow_name: 'Runner Image Publish',
      workflow_status: 'completed',
      workflow_conclusion: 'success',
      head_sha: RUNNER_IMAGE_LOCK.git_sha,
      artifact_name: 'runner-release-manifest',
      artifact_id: 987654321,
      artifact_expired: false,
      expires_at: '2026-08-29T13:39:29.000Z',
      remote_artifact_zip_digest: RUNNER_REMOTE_ARTIFACT_DIGEST,
      remote_artifact_zip_digest_source: 'github_actions_artifact.digest',
      adoption_gate: {
        command:
          'npm run contracts:check-runner-image-lock -- --adoption --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json --handoff-report scripts/governance/__fixtures__/release-boundary/runner-ga-handoff-report.valid.json',
        lock_path: 'release/agentsmith-runner-image.lock',
        manifest_path: 'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json',
        ok: true,
      },
      consumer: {
        repo: 'github.com/agentsmith-project/agentsmith',
        workflow_name: 'Release Contract Artifact',
        run_id: '10001',
        run_attempt: '2',
        job: 'generate-release-contract',
        commit_sha: GIT_SHA,
      },
      generated_at: GENERATED_AT,
    });
    expect(runnerManifestReceipt.remote_artifact_zip_digest).not.toBe(
      runnerManifestReceipt.local_manifest_canonical_sha256,
    );
    expect(runnerGaHandoffReceipt).toMatchObject({
      schema_version: RUNNER_GA_HANDOFF_SOURCE_RECEIPT_SCHEMA_VERSION,
      source_kind: 'github_actions_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
      producer_repo_slug: 'agentsmith-project/agentsmith-runner',
      report_schema_version: 'agentsmith.runner-ga-handoff-report/v1',
      report_scope: 'runner_ga_handoff_evidence',
      report_status: 'pass',
      report_path: runnerMetadata.handoffReportPath,
      report_sha256: RUNNER_IMAGE_LOCK.handoff.report_sha256,
      report_artifact_uri: RUNNER_IMAGE_LOCK.handoff.report_artifact_uri,
      manifest_input_sha256: RUNNER_IMAGE_LOCK.handoff.manifest_input_sha256,
      manifest_release_id: RUNNER_IMAGE_LOCK.release_id,
      manifest_git_sha: RUNNER_IMAGE_LOCK.git_sha,
      manifest_artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26866339967/runner-release-manifest.json',
      manifest_subject_sha256: RUNNER_IMAGE_LOCK.manifest.subject_sha256,
      manifest_provenance_artifact_sha256: RUNNER_IMAGE_LOCK.manifest.artifact_sha256,
      runner_image_digest: RUNNER_IMAGE_LOCK.image.digest,
      contract_package_uri:
        'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26866113545/mbos-agent-runner-contract-0.1.0.tgz',
      run_id: '26866339967',
      run_attempt: '1',
      workflow_name: 'Runner Image Publish',
      head_sha: RUNNER_IMAGE_LOCK.git_sha,
      consumer: {
        repo: 'github.com/agentsmith-project/agentsmith',
        workflow_name: 'Release Contract Artifact',
        run_id: '10001',
        run_attempt: '2',
        job: 'generate-release-contract',
        commit_sha: GIT_SHA,
      },
      generated_at: GENERATED_AT,
    });
    expect(llmupImageSourceReceipt).toMatchObject({
      schema_version: LLMUP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
      source_kind: 'github_release_tag_and_ghcr_manifest',
      provider_image_id: 'llmup',
      producer_repo: 'github.com/agentsmith-project/llm-universal-proxy',
      producer_repo_slug: 'agentsmith-project/llm-universal-proxy',
      lock_path: 'infra/deploy/shared/llmup-image.lock',
      lock_version: LLMUP_VERSION,
      lock_source_image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION}@${LLMUP_DIGEST}`,
      lock_digest: LLMUP_DIGEST,
      lock_commit_sha: LLMUP_COMMIT_SHA,
      release_url: LLMUP_RELEASE_URL,
      release_tag: LLMUP_VERSION,
      release_id: 331570298,
      release_html_url: LLMUP_RELEASE_URL,
      tag_ref: `refs/tags/${LLMUP_VERSION}`,
      tag_ref_object_type: 'tag',
      tag_ref_object_sha: '5bac2cd8cc316c27a42a4fbdd21b986600bfaadf',
      tag_commit_sha: LLMUP_COMMIT_SHA,
      tag_commit_sha_match: true,
      run_id: LLMUP_SOURCE_RUN_ID,
      run_attempt: LLMUP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/llm-universal-proxy/actions/runs/${LLMUP_SOURCE_RUN_ID}/attempts/${LLMUP_SOURCE_RUN_ATTEMPT}`,
      subject_name: LLMUP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/llm-universal-proxy/${LLMUP_SOURCE_RUN_ID}/${LLMUP_SOURCE_SUBJECT_NAME}.oci`,
      observed_ghcr_digest: LLMUP_DIGEST,
      ghcr_digest_match: true,
      check_command:
        `docker buildx imagetools inspect ${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION} --format '{{.Manifest.Digest}}'`,
      source_gate_path: 'llmup-image-source-metadata/source-gate.json',
      consumer: {
        repo: 'github.com/agentsmith-project/agentsmith',
        workflow_name: 'Release Contract Artifact',
        run_id: '10001',
        run_attempt: '2',
        job: 'generate-release-contract',
        commit_sha: GIT_SHA,
      },
      generated_at: GENERATED_AT,
    });
    expect(afscpImageSourceReceipt).toMatchObject({
      schema_version: AFSCP_IMAGE_SOURCE_RECEIPT_SCHEMA_VERSION,
      source_kind: 'github_release_tag_and_ghcr_manifest',
      provider_image_id: 'afscp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      producer_repo_slug: 'agentsmith-project/agentsmith-fs-control-plane',
      lock_path: 'infra/deploy/shared/afscp-image.lock',
      lock_version: AFSCP_VERSION,
      lock_source_image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:${AFSCP_VERSION}@${AFSCP_DIGEST}`,
      lock_digest: AFSCP_DIGEST,
      lock_commit_sha: AFSCP_COMMIT_SHA,
      release_url: AFSCP_RELEASE_URL,
      release_tag: AFSCP_VERSION,
      release_id: 326107668,
      release_html_url: AFSCP_RELEASE_URL,
      tag_ref: `refs/tags/${AFSCP_VERSION}`,
      tag_ref_object_type: 'tag',
      tag_ref_object_sha: '9f4f16a691049da6065a2bd45720c652e6fed171',
      tag_commit_sha: AFSCP_COMMIT_SHA,
      tag_commit_sha_match: true,
      run_id: AFSCP_SOURCE_RUN_ID,
      run_attempt: AFSCP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/agentsmith-fs-control-plane/actions/runs/${AFSCP_SOURCE_RUN_ID}/attempts/${AFSCP_SOURCE_RUN_ATTEMPT}`,
      subject_name: AFSCP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/agentsmith-fs-control-plane/${AFSCP_SOURCE_RUN_ID}/${AFSCP_SOURCE_SUBJECT_NAME}.oci`,
      observed_ghcr_digest: AFSCP_DIGEST,
      ghcr_digest_match: true,
      check_command:
        `docker buildx imagetools inspect ${AFSCP_PROVIDER_IMAGE_REPOSITORY}:${AFSCP_VERSION} --format '{{.Manifest.Digest}}'`,
      source_gate_path: 'afscp-image-source-metadata/source-gate.json',
      consumer: {
        repo: 'github.com/agentsmith-project/agentsmith',
        workflow_name: 'Release Contract Artifact',
        run_id: '10001',
        run_attempt: '2',
        job: 'generate-release-contract',
        commit_sha: GIT_SHA,
      },
      generated_at: GENERATED_AT,
    });
    expect(asbcpFinalManifestReceipt).toMatchObject({
      schema_version: ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_SCHEMA_VERSION,
      source_kind: 'github_release_asset',
      producer_repo: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      producer_repo_slug: 'agentsmith-project/agentsmith-sandbox-control-plane',
      lock_path: 'infra/deploy/shared/asbcp-image.lock',
      lock_source_image: `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:${ASBCP_VERSION}@${ASBCP_DIGEST}`,
      lock_commit_sha: ASBCP_COMMIT_SHA,
      manifest_path: 'asbcp-final-manifest-source-metadata/asbcp-final-manifest.json',
      release_url: ASBCP_RELEASE_URL,
      release_tag: ASBCP_VERSION,
      release_id: 975310864,
      release_html_url: ASBCP_RELEASE_URL,
      asset_id: 246802468,
      asset_name: ASBCP_FINAL_MANIFEST_ASSET_NAME,
      asset_content_type: 'application/json',
      api_asset_digest_source: 'github_release_asset.digest',
      api_asset_digest_match: true,
      run_id: ASBCP_SOURCE_RUN_ID,
      run_attempt: ASBCP_SOURCE_RUN_ATTEMPT,
      run_url:
        `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/actions/runs/${ASBCP_SOURCE_RUN_ID}/attempts/${ASBCP_SOURCE_RUN_ATTEMPT}`,
      subject_name: ASBCP_SOURCE_SUBJECT_NAME,
      artifact_uri:
        `gh-artifact://agentsmith-project/agentsmith-sandbox-control-plane/${ASBCP_SOURCE_RUN_ID}/${ASBCP_SOURCE_SUBJECT_NAME}.oci`,
      adoption_gate: {
        command:
          'npm run contracts:check-asbcp-adoption -- --manifest asbcp-final-manifest-source-metadata/asbcp-final-manifest.json',
        lock_path: 'infra/deploy/shared/asbcp-image.lock',
        manifest_path: 'asbcp-final-manifest-source-metadata/asbcp-final-manifest.json',
        ok: true,
      },
      consumer: {
        repo: 'github.com/agentsmith-project/agentsmith',
        workflow_name: 'Release Contract Artifact',
        run_id: '10001',
        run_attempt: '2',
        job: 'generate-release-contract',
        commit_sha: GIT_SHA,
      },
      generated_at: GENERATED_AT,
    });
    expect(asbcpFinalManifestReceipt.api_asset_digest).toBe(
      asbcpFinalManifestReceipt.downloaded_manifest_sha256,
    );
  });

  it('rejects remote runner manifest artifact content drift before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const remoteManifest = JSON.parse(readFileSync(runnerMetadata.remoteManifestPath, 'utf8')) as Record<string, unknown>;
    remoteManifest.release_id = 'locked-safety-drift';
    rehashRunnerManifestProvenance(remoteManifest);
    writeFileSync(runnerMetadata.remoteManifestPath, `${canonicalReleaseBoundaryJson(remoteManifest)}\n`);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: artifactProducerArgv(inputPath, outputDir, runnerMetadata, asbcpMetadata),
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('remote_manifest.canonical_sha256');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it('rejects LLMUP image source receipt digest mismatch before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const sourceGate = JSON.parse(readFileSync(asbcpMetadata.llmupSourceGatePath, 'utf8')) as Record<string, unknown>;
    sourceGate.observed_ghcr_digest = `sha256:${'9'.repeat(64)}`;
    writeFileSync(asbcpMetadata.llmupSourceGatePath, `${JSON.stringify(sourceGate, null, 2)}\n`);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const llmupImageSourceReceiptPath = join(outputDir, LLMUP_IMAGE_SOURCE_RECEIPT_NAME);
    const afscpImageSourceReceiptPath = join(outputDir, AFSCP_IMAGE_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: artifactProducerArgv(inputPath, outputDir, runnerMetadata, asbcpMetadata),
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('LLMUP image source freshness check failed');
    expect(stderr.join('\n')).toContain('source_gate.observed_ghcr_digest');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(llmupImageSourceReceiptPath)).toBe(false);
    expect(existsSync(afscpImageSourceReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it.each([
    {
      name: 'LLMUP image',
      mutate: (input: Record<string, unknown>) => {
        const adoptedProviderImages = input.adopted_provider_images as Array<Record<string, unknown>>;
        adoptedProviderImages[0] = {
          ...adoptedProviderImages[0],
          image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION}@sha256:${'8'.repeat(64)}`,
        };
      },
      expected:
        `adopted_provider_images[0].image: expected source image ${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${LLMUP_VERSION}@${LLMUP_DIGEST}`,
    },
    {
      name: 'AFSCP digest',
      mutate: (input: Record<string, unknown>) => {
        const adoptedProviderImages = input.adopted_provider_images as Array<Record<string, unknown>>;
        adoptedProviderImages[1] = {
          ...adoptedProviderImages[1],
          digest: `sha256:${'8'.repeat(64)}`,
        };
      },
      expected:
        `adopted_provider_images[1].digest: expected source digest ${AFSCP_DIGEST}; actual sha256:${'8'.repeat(64)}.`,
    },
  ])('rejects adopted provider $name drift before writing artifacts or receipts', ({ mutate, expected }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const input = buildArtifactProducerInput();
    mutate(input);
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const llmupImageSourceReceiptPath = join(outputDir, LLMUP_IMAGE_SOURCE_RECEIPT_NAME);
    const afscpImageSourceReceiptPath = join(outputDir, AFSCP_IMAGE_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: artifactProducerArgv(inputPath, outputDir, runnerMetadata, asbcpMetadata),
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('release contract adopted provider image source binding failed');
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(llmupImageSourceReceiptPath)).toBe(false);
    expect(existsSync(afscpImageSourceReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it.each([
    {
      name: 'missing LLMUP image',
      mutate: (input: Record<string, unknown>) => {
        const adoptedProviderImages = input.adopted_provider_images as Array<Record<string, unknown>>;
        input.adopted_provider_images = adoptedProviderImages.filter((image) => image.id !== 'llmup');
      },
      expected: 'adopted_provider_images.llmup: expected exactly one source-bound image; actual 0.',
    },
    {
      name: 'duplicate AFSCP image',
      mutate: (input: Record<string, unknown>) => {
        const adoptedProviderImages = input.adopted_provider_images as Array<Record<string, unknown>>;
        adoptedProviderImages.push({ ...adoptedProviderImages[1] });
      },
      expected: 'adopted_provider_images.afscp: expected exactly one source-bound image; actual 2.',
    },
  ])('rejects adopted provider $name before writing artifacts or receipts', ({ mutate, expected }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const input = buildArtifactProducerInput();
    mutate(input);
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const llmupImageSourceReceiptPath = join(outputDir, LLMUP_IMAGE_SOURCE_RECEIPT_NAME);
    const afscpImageSourceReceiptPath = join(outputDir, AFSCP_IMAGE_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: artifactProducerArgv(inputPath, outputDir, runnerMetadata, asbcpMetadata),
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('release contract adopted provider image source binding failed');
    expect(stderr.join('\n')).toContain('expected exactly one source-bound image');
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(llmupImageSourceReceiptPath)).toBe(false);
    expect(existsSync(afscpImageSourceReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it('does not synthesize a remote artifact digest from the runner manifest subject hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root, (metadata) => {
      delete metadata.artifactsApi.artifacts[0]?.digest;
    });
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);

    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    const receipt = JSON.parse(readFileSync(runnerManifestReceiptPath, 'utf8')) as Record<string, unknown>;
    expect(receipt.manifest_subject_sha256).toBe(RUNNER_IMAGE_LOCK.manifest.subject_sha256);
    expect(receipt.remote_artifact_zip_digest).toBeNull();
    expect(receipt.remote_artifact_zip_digest_source).toBe('not_provided_by_github');
  });

  it('does not synthesize an ASBCP release asset digest when GitHub omits it', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root, (metadata) => {
      delete metadata.assetApi.digest;
      const releaseAsset = { ...(metadata.releaseApi.assets[0] ?? {}) };
      delete releaseAsset.digest;
      metadata.releaseApi.assets[0] = releaseAsset;
    });
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    const receipt = JSON.parse(readFileSync(asbcpFinalManifestReceiptPath, 'utf8')) as Record<string, unknown>;
    expect(receipt.api_asset_digest).toBeNull();
    expect(receipt.api_asset_digest_source).toBe('not_provided_by_github');
    expect(receipt.downloaded_manifest_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('uses the ASBCP release asset digest from release metadata when asset API omits it', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root, (metadata) => {
      const releaseAssetDigest = metadata.assetApi.digest;
      delete metadata.assetApi.digest;
      metadata.releaseApi.assets[0] = {
        ...(metadata.releaseApi.assets[0] ?? {}),
        digest: releaseAssetDigest,
      };
    });
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    const receipt = JSON.parse(readFileSync(asbcpFinalManifestReceiptPath, 'utf8')) as Record<string, unknown>;
    expect(receipt.api_asset_digest).toBe(receipt.downloaded_manifest_sha256);
    expect(receipt.api_asset_digest_source).toBe('github_release_asset.digest');
    expect(receipt.api_asset_digest_match).toBe(true);
  });

  it('rejects ASBCP release asset digest drift before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root, (metadata) => {
      const releaseAssetDigest = metadata.assetApi.digest;
      metadata.assetApi.digest = `sha256:${'9'.repeat(64)}`;
      metadata.releaseApi.assets[0] = {
        ...(metadata.releaseApi.assets[0] ?? {}),
        digest: releaseAssetDigest,
      };
    });
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('asset_api.digest');
    expect(stderr.join('\n')).toContain('release_api.assets[].digest');
    expect(stderr.join('\n')).toContain('downloaded manifest sha256');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it('rejects ASBCP final manifest adoption drift before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root, (metadata) => {
      metadata.manifest.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
      delete metadata.assetApi.digest;
      const releaseAsset = { ...(metadata.releaseApi.assets[0] ?? {}) };
      delete releaseAsset.digest;
      metadata.releaseApi.assets[0] = releaseAsset;
    });
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('adoption_gate');
    expect(stderr.join('\n')).toContain('manifest.commit_sha');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it('fails fast without downloaded runner release manifest artifact content', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const envPaths = { ...artifactProducerSourceEnv(runnerMetadata, asbcpMetadata) };
    delete envPaths.RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH;

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(envPaths),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(
      '--runner-remote-manifest or RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH is required',
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it('fails fast without downloaded runner GA handoff report evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const envPaths = { ...artifactProducerSourceEnv(runnerMetadata, asbcpMetadata) };
    delete envPaths.RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH;

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(envPaths),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(
      '--runner-ga-handoff or RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH is required',
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it('fails fast without runner release manifest source metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv({
        RUNNER_RELEASE_MANIFEST_SOURCE_REMOTE_MANIFEST_PATH: runnerMetadata.remoteManifestPath,
        RUNNER_GA_HANDOFF_SOURCE_REPORT_PATH: runnerMetadata.handoffReportPath,
        ...asbcpFinalManifestSourceEnv(asbcpMetadata),
      }),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(
      '--runner-run-view or RUNNER_RELEASE_MANIFEST_SOURCE_RUN_VIEW_PATH is required',
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it('rejects expired runner release manifest source artifacts before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root, (metadata) => {
      metadata.artifactsApi.artifacts[0] = {
        ...metadata.artifactsApi.artifacts[0],
        expired: true,
      };
    });
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('artifact.expired: expected false');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
  });

  it.each([
    {
      name: 'run conclusion',
      mutate: (metadata: RunnerManifestSourceMetadataFixture) => {
        metadata.runView.conclusion = 'failure';
        metadata.runApi.conclusion = 'failure';
      },
      expected: 'run_api.conclusion: expected success; actual failure',
    },
    {
      name: 'head sha',
      mutate: (metadata: RunnerManifestSourceMetadataFixture) => {
        metadata.runView.headSha = 'ffffffffffffffffffffffffffffffffffffffff';
      },
      expected: 'run_view.headSha: expected 008dbbd3b232485cb77f3cae585d38955a8bf9fb; actual ffffffffffffffffffffffffffffffffffffffff',
    },
    {
      name: 'artifact missing',
      mutate: (metadata: RunnerManifestSourceMetadataFixture) => {
        metadata.artifactsApi.total_count = 0;
        metadata.artifactsApi.artifacts = [];
      },
      expected: 'artifacts_api.artifacts: expected exactly one runner-release-manifest artifact; actual 0',
    },
  ])('rejects runner release manifest source metadata drift: $name', ({ mutate, expected }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root, mutate);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
  });

  it('rejects runner GA handoff report drift before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const handoff = JSON.parse(readFileSync(runnerMetadata.handoffReportPath, 'utf8')) as Record<string, unknown>;
    handoff.git_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    writeFileSync(runnerMetadata.handoffReportPath, `${JSON.stringify(handoff, null, 2)}\n`);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const runnerGaHandoffReceiptPath = join(outputDir, RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('runner GA handoff source freshness check failed');
    expect(stderr.join('\n')).toContain('handoff.git_sha');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(runnerGaHandoffReceiptPath)).toBe(false);
  });

  it('rejects runner GA handoff report digest drift from the canonical lock before writing receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const handoff = JSON.parse(readFileSync(runnerMetadata.handoffReportPath, 'utf8')) as Record<string, unknown>;
    handoff.notes = [
      ...(Array.isArray(handoff.notes) ? handoff.notes : []),
      'Digest drift check fixture note.',
    ];
    writeFileSync(runnerMetadata.handoffReportPath, `${JSON.stringify(handoff, null, 2)}\n`);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const runnerGaHandoffReceiptPath = join(outputDir, RUNNER_GA_HANDOFF_SOURCE_RECEIPT_NAME);

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('runner GA handoff source freshness check failed');
    expect(stderr.join('\n')).toContain('runnerImageLock.handoff.report_sha256');
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(runnerGaHandoffReceiptPath)).toBe(false);
  });

  it.each([
    ['GITHUB_SHA', 'GITHUB_SHA is required.'],
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ID is required.'],
    ['GITHUB_JOB', 'GITHUB_JOB is required.'],
  ])('fails fast without %s and removes stale output', (envField, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');
    const runnerManifestReceiptPath = join(outputDir, RUNNER_RELEASE_MANIFEST_SOURCE_RECEIPT_NAME);
    const asbcpFinalManifestReceiptPath = join(outputDir, ASBCP_FINAL_MANIFEST_SOURCE_RECEIPT_NAME);

    expect(runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(runnerManifestReceiptPath)).toBe(true);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(true);

    const env = {
      ...githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      [envField]: undefined,
    };
    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(expected);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runnerManifestReceiptPath)).toBe(false);
    expect(existsSync(asbcpFinalManifestReceiptPath)).toBe(false);
  });

  it('rejects caller-provided provenance and source sha because CI env owns them', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const input = buildArtifactProducerInput();
    input.ci_provenance = buildAssemblyInput().ci_provenance;
    input.sourceGitSha = GIT_SHA;
    input.external_image_source_provenance = buildExternalImageSourceProvenance();
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('ci_provenance must be provided by GitHub CI env');
    expect(stderr.join('\n')).toContain('sourceGitSha must be provided by GitHub CI env');
    expect(stderr.join('\n')).toContain(
      'external_image_source_provenance must be provided by canonical source receipts',
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it('rejects caller-provided runnerImageLock because the canonical lock owns it', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const input = buildArtifactProducerInput();
    input.runnerImageLock = {
      ...buildRunnerImageLock(),
      image: {
        ...RUNNER_IMAGE_LOCK.image,
        digest: `sha256:${'9'.repeat(64)}`,
      },
    };
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('runnerImageLock must be provided by canonical agentsmith-runner-image.lock');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('fails fast for tag-only image inputs before publishing an artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const runnerMetadata = writeRunnerManifestSourceMetadata(root);
    const asbcpMetadata = writeAsbcpFinalManifestSourceMetadata(root);
    const input = buildArtifactProducerInput();
    const adoptedProviderImages = input.adopted_provider_images as Array<Record<string, unknown>>;
    adoptedProviderImages[0] = {
      ...adoptedProviderImages[0],
      image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${RELEASE_ID}`,
    };
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(artifactProducerSourceEnv(runnerMetadata, asbcpMetadata)),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('release contract adopted provider image source binding failed');
    expect(stderr.join('\n')).toContain('adopted_provider_images[0].image');
    expect(existsSync(outputPath)).toBe(false);
  });
});
