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
  type CurrentRunnerImageLock,
} from '../current-release-boundary-schema';
import {
  assembleReleaseContractGeneratorInput,
  buildProductImagesFromBuildManifest,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from '../release-contract-input';
import { runReleaseContractArtifactCli } from '../release-contract-artifact';
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
  release_id: 'locked-safety-ce7cdde',
  git_sha: 'ce7cdde4f48ad46494df91f9b19d4e626d557b83',
  runner_contract_version: '0.1.0',
  runner_protocol_version: '1.0',
  image: {
    id: 'agentsmith-runner',
    image:
      'ghcr.io/agentsmith-project/agentsmith-runner:release-locked-safety-ce7cdde@sha256:df90f6583f25e1f45260d662bf1c9aee88462c758c303fb3083f4c93f3ebdcb5',
    digest: 'sha256:df90f6583f25e1f45260d662bf1c9aee88462c758c303fb3083f4c93f3ebdcb5',
  },
  manifest: {
    producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
    subject_sha256: 'sha256:6ef5e1b2e5cfd2e62d56c2ec57efeb82ca9fd6c77e66775f3931fe4886747306',
    artifact_sha256: 'sha256:6ef5e1b2e5cfd2e62d56c2ec57efeb82ca9fd6c77e66775f3931fe4886747306',
  },
} as const satisfies CurrentRunnerImageLock;
const CANONICAL_RUNNER_IMAGE_LOCK_PATH = join(
  process.cwd(),
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
  'agentsmith-runner-image.lock',
);
const CANONICAL_RUNNER_IMAGE_LOCK_RELATIVE_PATH = join(
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
  'agentsmith-runner-image.lock',
);

function buildRunnerImageLock(): CurrentRunnerImageLock {
  return structuredClone(RUNNER_IMAGE_LOCK);
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
        image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
        digest: `sha256:${'3'.repeat(64)}`,
      },
      {
        id: 'afscp',
        image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:v1.0.7@sha256:${'5'.repeat(64)}`,
        digest: `sha256:${'5'.repeat(64)}`,
      },
      {
        id: 'asbcp',
        image: `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:v2.0.7@sha256:${'6'.repeat(64)}`,
        digest: `sha256:${'6'.repeat(64)}`,
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
        image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
        digest: `sha256:${'3'.repeat(64)}`,
      },
      {
        id: 'afscp',
        image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:v1.0.7@sha256:${'5'.repeat(64)}`,
        digest: `sha256:${'5'.repeat(64)}`,
      },
      {
        id: 'asbcp',
        image: `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:v2.0.7@sha256:${'6'.repeat(64)}`,
        digest: `sha256:${'6'.repeat(64)}`,
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
  return input;
}

function writeCanonicalRunnerImageLock(root: string): void {
  const lockPath = join(root, CANONICAL_RUNNER_IMAGE_LOCK_RELATIVE_PATH);
  mkdirSync(join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary'), { recursive: true });
  writeFileSync(lockPath, readFileSync(CANONICAL_RUNNER_IMAGE_LOCK_PATH, 'utf8'), 'utf8');
}

function writeArtifactProducerInput(root: string, input: Record<string, unknown>): string {
  const inputPath = join(root, 'release-contract-input.json');
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return inputPath;
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
    expect(generatorInput.openapi_subject).toBe(input.openapi_subject);
    expect(generatorInput.asyncapi_subject).toBe(input.asyncapi_subject);
    expect('deploy_image_inventory' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect('artifact_provenance' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory).toContainEqual({
      ...appProductImages[0],
      source: 'product_images',
    });
    expect(contract.managed_runner_image).toEqual(RUNNER_IMAGE_LOCK.image);
    expect(contract.deploy_image_inventory).toContainEqual({
      id: 'managed_runner',
      image: RUNNER_IMAGE_LOCK.image.image,
      digest: RUNNER_IMAGE_LOCK.image.digest,
      source: 'managed_runner_image',
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

    const contract = generateAgentSmithReleaseContract(buildReleaseContractInput(productImages), SOURCE_OPTIONS);

    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory.filter((image) => image.source === 'product_images')).toEqual([
      { ...productImages[0], source: 'product_images' },
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
    expect(validation.value.product_images).toEqual(expectedProductImages);
    expect(validation.value.deploy_template_digest).toBe(input.deployTemplatePackage.manifest_sha256);
    expect(validation.value.openapi_digest).toBe(sha256Digest(canonicalReleaseBoundaryJson(input.openapi_subject)));
    expect(validation.value.asyncapi_digest).toBe(sha256Digest(canonicalReleaseBoundaryJson(input.asyncapi_subject)));
    expect(validation.value.target_profiles).toEqual(input.target_profiles);
    expect(validation.value.deploy_image_inventory).toEqual([
      ...expectedProductImages.map((image) => ({ ...image, source: 'product_images' as const })),
      ...input.adopted_provider_images.map((image) => ({
        ...image,
        source: 'adopted_provider_images' as const,
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
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(),
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
    });
  });

  it.each([
    ['GITHUB_SHA', 'GITHUB_SHA is required.'],
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ID is required.'],
    ['GITHUB_JOB', 'GITHUB_JOB is required.'],
  ])('fails fast without %s and removes stale output', (envField, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const inputPath = writeArtifactProducerInput(root, buildArtifactProducerInput());
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    expect(runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    const env = { ...githubReleaseContractEnv(), [envField]: undefined };
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
  });

  it('rejects caller-provided provenance and source sha because CI env owns them', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
    const input = buildArtifactProducerInput();
    input.ci_provenance = buildAssemblyInput().ci_provenance;
    input.sourceGitSha = GIT_SHA;
    const inputPath = writeArtifactProducerInput(root, input);
    const outputDir = join(root, 'artifacts', 'release-contract');
    const outputPath = join(outputDir, 'agentsmith-release-contract.json');

    const stderr: string[] = [];
    const exitCode = runReleaseContractArtifactCli({
      argv: ['--input', inputPath, '--output-dir', outputDir],
      cwd: root,
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('ci_provenance must be provided by GitHub CI env');
    expect(stderr.join('\n')).toContain('sourceGitSha must be provided by GitHub CI env');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('rejects caller-provided runnerImageLock because the canonical lock owns it', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-artifact-'));
    writeCanonicalRunnerImageLock(root);
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
      env: githubReleaseContractEnv(),
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
      env: githubReleaseContractEnv(),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('image must be pinned by digest');
    expect(existsSync(outputPath)).toBe(false);
  });
});
