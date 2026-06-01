import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  type CurrentAgentSmithReleaseContract,
  type CurrentDeploymentTargetProfile,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseImageSourceProvenanceBinding,
  type CurrentRunnerImageLock,
} from '../current-release-boundary-schema';
import {
  generateAgentSmithReleaseContract,
  runReleaseContractCli,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';

const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const SOURCE_OPTIONS = { sourceGitSha: GIT_SHA } as const;
const CANONICAL_LLMUP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/llm-universal-proxy';
const NON_CANONICAL_LLMUP_PROVIDER_IMAGE_REPOSITORY = ['ghcr.io/agentsmith-project', 'llmup'].join('/');
const AFSCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-fs-control-plane';
const ASBCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const LLMUP_COMMIT_SHA = '9c8208d3a12e8070c4edb0ee07469d023cfe38ad';
const AFSCP_COMMIT_SHA = '0fec35424500b6b5d9075edafb997778f1803e19';
const ASBCP_COMMIT_SHA = '291a0195aeab392ca7265460573670e41e5f058b';
const REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS = [
  'afscp',
  'agentsmith_app',
  'asbcp',
  'ingress_nginx_certgen',
  'ingress_nginx_controller',
  'llmup',
  'managed_runner',
] as const;
const RELEASE_BOUNDARY_PROVIDER_IMAGE_GUARD_FILES = [
  'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
  'scripts/governance/__tests__/release-contract.test.ts',
  'scripts/governance/__tests__/release-contract-input.test.ts',
  'scripts/governance/__tests__/deploy-template-package.test.ts',
] as const;

const PRODUCT_IMAGES = [
  {
    id: 'agentsmith_app',
    image: `ghcr.io/agentsmith-project/agentsmith-app:${RELEASE_ID}@sha256:${'1'.repeat(64)}`,
    digest: `sha256:${'1'.repeat(64)}`,
  },
] as const;

const ADOPTED_PROVIDER_IMAGES = [
  {
    id: 'llmup',
    image: `${CANONICAL_LLMUP_PROVIDER_IMAGE_REPOSITORY}:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
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
] as const;

const RELEASE_KIT_PREREQUISITE_IMAGES = [
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
] as const;
const RUNNER_IMAGE_LOCK = {
  schema_version: 'agentsmith.runner-image-lock/v1',
  runner: 'agentsmith-runner',
  release_id: 'locked-safety-35ada93',
  git_sha: '35ada93cbba0102e9f099c3d47eeb8a48bc89e6f',
  runner_contract_version: '0.1.0',
  runner_protocol_version: '1.0',
  image: {
    id: 'agentsmith-runner',
    image:
      'ghcr.io/agentsmith-project/agentsmith-runner:release-locked-safety-35ada93@sha256:435415e9824550161dc1b0ddcb221fbc4a995b33742e0509879c3ff90f8a0efb',
    digest: 'sha256:435415e9824550161dc1b0ddcb221fbc4a995b33742e0509879c3ff90f8a0efb',
  },
  manifest: {
    producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
    subject_sha256: 'sha256:d39893f31f6f67200a2b06fe993473956ebbadce479fe502261d3d4394211672',
    artifact_sha256: 'sha256:d39893f31f6f67200a2b06fe993473956ebbadce479fe502261d3d4394211672',
  },
} as const satisfies CurrentRunnerImageLock;

function buildDeployTemplatePackage(): CurrentDeployTemplatePackage {
  const subject: Omit<CurrentDeployTemplatePackage, 'artifact_provenance'> = {
    schema_version: 'agentsmith.deploy-template-package/v1',
    package_uri: 'gh-artifact://agentsmith/deploy-template-package/10001/agentsmith-deploy-template-package.tgz',
    package_sha256: `sha256:${'a'.repeat(64)}`,
    manifest_sha256: `sha256:${'6'.repeat(64)}`,
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
      generated_at: '2026-05-23T12:00:00.000Z',
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function buildTargetProfiles(): AgentSmithReleaseContractGeneratorInput['target_profiles'] {
  return structuredClone(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES);
}

function buildRunnerImageLock(): CurrentRunnerImageLock {
  return structuredClone(RUNNER_IMAGE_LOCK);
}

function buildImageSourceProvenance(): CurrentReleaseImageSourceProvenanceBinding[] {
  return [
    {
      image_id: 'agentsmith_app',
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      tag: RELEASE_ID,
      run_id: '10001',
      run_attempt: '1',
      artifact_sha256: PRODUCT_IMAGES[0].digest,
    },
    {
      image_id: 'llmup',
      producer_repo: 'github.com/agentsmith-project/llm-universal-proxy',
      normalized_remote: 'github.com/agentsmith-project/llm-universal-proxy',
      commit_sha: LLMUP_COMMIT_SHA,
      tag: RELEASE_ID,
      run_id: '10001',
      run_attempt: '1',
      artifact_sha256: ADOPTED_PROVIDER_IMAGES[0].digest,
    },
    {
      image_id: 'afscp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      commit_sha: AFSCP_COMMIT_SHA,
      tag: 'v1.0.7',
      run_id: '10001',
      run_attempt: '1',
      artifact_sha256: ADOPTED_PROVIDER_IMAGES[1].digest,
    },
    {
      image_id: 'asbcp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      commit_sha: ASBCP_COMMIT_SHA,
      tag: 'v2.0.7',
      run_id: '10001',
      run_attempt: '1',
      artifact_sha256: ADOPTED_PROVIDER_IMAGES[2].digest,
    },
    {
      image_id: 'managed_runner',
      producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
      commit_sha: RUNNER_IMAGE_LOCK.git_sha,
      tag: 'release-locked-safety-35ada93',
      run_id: '26714141935',
      run_attempt: '1',
      artifact_sha256: RUNNER_IMAGE_LOCK.image.digest,
    },
  ];
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
    artifact_sha256: binding.artifact_sha256,
  };
}

function buildInput(): AgentSmithReleaseContractGeneratorInput {
  const openapiSubject = {
    openapi: '3.1.0',
    info: {
      title: 'AgentSmith API',
      version: RELEASE_ID,
    },
    paths: {},
  };
  const asyncapiSubject = {
    asyncapi: '3.0.0',
    info: {
      title: 'AgentSmith AsyncAPI',
      version: RELEASE_ID,
    },
    channels: {},
  };

  return {
    release_id: RELEASE_ID,
    git_sha: GIT_SHA,
    product_images: PRODUCT_IMAGES,
    adopted_provider_images: ADOPTED_PROVIDER_IMAGES,
    release_kit_prerequisite_images: RELEASE_KIT_PREREQUISITE_IMAGES,
    image_source_provenance: buildImageSourceProvenance(),
    runnerImageLock: buildRunnerImageLock(),
    deploy_template_digest: `sha256:${'6'.repeat(64)}`,
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
      generated_at: '2026-05-23T12:00:00.000Z',
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function expectThrowsWithMessage(input: AgentSmithReleaseContractGeneratorInput, expected: string): void {
  expect(() => generateAgentSmithReleaseContract(input, SOURCE_OPTIONS)).toThrow(expected);
}

function cloneAsRecord<T>(value: T): Record<string, unknown> {
  return structuredClone(value) as unknown as Record<string, unknown>;
}

function releaseContractOmitArtifactShaProjectionSubject(contract: CurrentAgentSmithReleaseContract): unknown {
  const subject = cloneAsRecord(contract);
  const provenance = subject.artifact_provenance as Record<string, unknown>;
  delete provenance.artifact_sha256;
  return subject;
}

function targetProfileKey(
  profile: Pick<CurrentDeploymentTargetProfile, 'target_cluster' | 'substrate_source' | 'distribution'>,
): string {
  return `${profile.target_cluster}|${profile.substrate_source}|${profile.distribution}`;
}

describe('release contract generator', () => {
  it('keeps release contract fixtures and tests off the non-canonical llmup image repository', () => {
    for (const relativePath of RELEASE_BOUNDARY_PROVIDER_IMAGE_GUARD_FILES) {
      const content = readFileSync(join(process.cwd(), relativePath), 'utf8');

      expect(content, `${relativePath} must use ${CANONICAL_LLMUP_PROVIDER_IMAGE_REPOSITORY}`).not.toContain(
        NON_CANONICAL_LLMUP_PROVIDER_IMAGE_REPOSITORY,
      );
    }
  });

  it('keeps CI handoff target profiles on the formal online/airgap substrate matrix', () => {
    const targetProfilesFixture = JSON.parse(
      readFileSync(join(process.cwd(), 'scripts/governance/release-contract-target-profiles.json'), 'utf8'),
    ) as readonly CurrentDeploymentTargetProfile[];
    const workflowSource = readFileSync(join(process.cwd(), '.github/workflows/image-publish.yml'), 'utf8');
    const canonicalCandidateKeys = CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map(targetProfileKey);
    const expectedHandoffKeys = [
      'existing_kubernetes|external_declared|online',
      'existing_kubernetes|kit_installed|online',
      'existing_kubernetes|external_declared|airgap',
      'existing_kubernetes|kit_installed|airgap',
    ];

    expect(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES.map(targetProfileKey)).toEqual(expectedHandoffKeys);
    expect(expectedHandoffKeys.every((key) => canonicalCandidateKeys.includes(key))).toBe(true);
    expect(expectedHandoffKeys).not.toContain('kind_rehearsal|kit_installed|online');
    expect(expectedHandoffKeys).not.toEqual(canonicalCandidateKeys);
    expect(targetProfilesFixture).toEqual(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES);
    expect(targetProfilesFixture.map(targetProfileKey)).toEqual(expectedHandoffKeys);
    expect(targetProfilesFixture.every((profile) => profile.required === false)).toBe(true);
    expect(workflowSource).toContain("readJson('scripts/governance/release-contract-target-profiles.json')");
    expect(workflowSource).toContain('target_profiles: targetProfiles');
  });

  it('generates a validated contract with mechanical image inventory and deterministic provenance hashes', () => {
    const input = buildInput();
    const contract = generateAgentSmithReleaseContract(input, SOURCE_OPTIONS);

    expect(contract.deploy_image_inventory).toEqual([
      {
        ...PRODUCT_IMAGES[0],
        source: 'product_images',
        source_provenance: sourceProvenanceFor(input.image_source_provenance, 'agentsmith_app'),
      },
      ...ADOPTED_PROVIDER_IMAGES.map((image) => ({
        ...image,
        source: 'adopted_provider_images' as const,
        source_provenance: sourceProvenanceFor(input.image_source_provenance, image.id),
      })),
      ...RELEASE_KIT_PREREQUISITE_IMAGES.map((image) => ({
        ...image,
        source: 'release_kit_prerequisite_images' as const,
      })),
      {
        id: 'managed_runner',
        image: RUNNER_IMAGE_LOCK.image.image,
        digest: RUNNER_IMAGE_LOCK.image.digest,
        source: 'managed_runner_image',
        source_provenance: sourceProvenanceFor(input.image_source_provenance, 'managed_runner'),
      },
    ]);
    expect(contract.managed_runner_image).toEqual(RUNNER_IMAGE_LOCK.image);
    expect(contract.deploy_image_inventory).toContainEqual({
      id: 'managed_runner',
      image: RUNNER_IMAGE_LOCK.image.image,
      digest: RUNNER_IMAGE_LOCK.image.digest,
      source: 'managed_runner_image',
      source_provenance: sourceProvenanceFor(input.image_source_provenance, 'managed_runner'),
    });
    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);

    const contractSubject = cloneAsRecord(contract);
    delete contractSubject.artifact_provenance;
    expect(contract.artifact_provenance.subject_sha256).toBe(
      sha256Digest(canonicalReleaseBoundaryJson(contractSubject)),
    );
    expect(contract.artifact_provenance.artifact_sha256).toBe(
      sha256Digest(canonicalReleaseBoundaryJson(releaseContractOmitArtifactShaProjectionSubject(contract))),
    );
  });

  it('records artifact_sha256 as the omit-artifact-sha projection digest', () => {
    const contract = generateAgentSmithReleaseContract(buildInput(), SOURCE_OPTIONS);
    const projectionDigest = sha256Digest(
      canonicalReleaseBoundaryJson(releaseContractOmitArtifactShaProjectionSubject(contract)),
    );

    expect(contract.artifact_provenance.artifact_sha256).toBe(projectionDigest);
  });

  it('rejects tag-only images before writing a contract', () => {
    const input = buildInput();
    input.product_images = [
      {
        ...PRODUCT_IMAGES[0],
        image: `ghcr.io/agentsmith-project/agentsmith-app:${RELEASE_ID}`,
      },
    ];

    expectThrowsWithMessage(input, 'image must be pinned by digest');
  });

  it('rejects duplicate image ids across release image groups', () => {
    const input = buildInput();
    input.adopted_provider_images = [
      {
        ...ADOPTED_PROVIDER_IMAGES[0],
        id: PRODUCT_IMAGES[0].id,
      },
    ];

    expectThrowsWithMessage(input, 'image id "agentsmith_app" is declared more than once');
  });

  it('rejects generated deploy image inventory entries that are not required by the deploy template package', () => {
    const input = buildInput();
    input.release_kit_prerequisite_images = [
      ...RELEASE_KIT_PREREQUISITE_IMAGES,
      {
        id: 'unused_prerequisite',
        image: `registry.k8s.io/example/unused-prerequisite:v1.0.0@sha256:${'8'.repeat(64)}`,
        digest: `sha256:${'8'.repeat(64)}`,
      },
    ];

    expectThrowsWithMessage(
      input,
      'deploy image inventory id "unused_prerequisite" is not required by deploy_template_package.required_image_ids',
    );
  });

  it('rejects missing GA image source provenance before writing a contract', () => {
    const input = buildInput();
    input.image_source_provenance = input.image_source_provenance.filter((entry) => entry.image_id !== 'llmup');

    expectThrowsWithMessage(input, 'source_provenance is required for GA image id "llmup"');
  });

  it('rejects GA image source provenance digest drift from the image digest', () => {
    const input = buildInput();
    input.image_source_provenance = input.image_source_provenance.map((entry) => entry.image_id === 'asbcp'
      ? { ...entry, artifact_sha256: `sha256:${'9'.repeat(64)}` }
      : entry);

    expectThrowsWithMessage(input, 'source_provenance.artifact_sha256 must match image.digest');
  });

  it('rejects GA image source provenance repo mismatch', () => {
    const input = buildInput();
    input.image_source_provenance = input.image_source_provenance.map((entry) => entry.image_id === 'afscp'
      ? { ...entry, producer_repo: 'github.com/agentsmith-project/agentsmith' }
      : entry);

    expectThrowsWithMessage(
      input,
      'canonical repo identity must be github.com/agentsmith-project/agentsmith-fs-control-plane',
    );
  });

  it('rejects deploy template digest drift from package manifest digest', () => {
    const input = buildInput();
    input.deploy_template_digest = `sha256:${'7'.repeat(64)}`;

    expectThrowsWithMessage(input, 'deploy_template_digest must match deploy_template_package.manifest_sha256');
  });

  it('rejects deploy template package provenance commit drift from release git sha', () => {
    const input = buildInput();
    input.deploy_template_package.artifact_provenance.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';

    expectThrowsWithMessage(
      input,
      'deploy_template_package.artifact_provenance.commit_sha must match git_sha',
    );
  });

  it('rejects ci provenance commit drift from release git sha', () => {
    const input = buildInput();
    input.ci_provenance.commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';

    expectThrowsWithMessage(input, 'ci_provenance.commit_sha must match git_sha');
  });

  it('rejects missing ci provenance commit sha', () => {
    const input = buildInput();
    delete (input.ci_provenance as Partial<AgentSmithReleaseContractGeneratorInput['ci_provenance']>).commit_sha;

    expectThrowsWithMessage(input, 'ci_provenance.commit_sha must be a non-empty string');
  });

  it('rejects release git sha drift from the bound source git sha', () => {
    const input = buildInput();

    expect(() => generateAgentSmithReleaseContract(input, {
      sourceGitSha: 'ffffffffffffffffffffffffffffffffffffffff',
    })).toThrow('git_sha must match source git sha');
  });

  it('requires an explicit source git sha binding', () => {
    const input = buildInput();

    expect(() => generateAgentSmithReleaseContract(
      input,
      undefined as unknown as typeof SOURCE_OPTIONS,
    )).toThrow('sourceGitSha is required');
  });

  it('rejects local artifact URIs and provenance repo mismatch through the shared validator', () => {
    const localUriInput = buildInput();
    localUriInput.ci_provenance.artifact_uri =
      'file:///home/percy/works/mbos-v1/agentsmith/agentsmith-release-contract.json';
    expectThrowsWithMessage(localUriInput, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');

    const repoMismatchInput = buildInput();
    repoMismatchInput.ci_provenance.normalized_remote = 'github.com/agentsmith-project/not-agentsmith';
    expectThrowsWithMessage(repoMismatchInput, 'canonical repo identity must be github.com/agentsmith-project/agentsmith');
  });

  it.each([
    'http://localhost/artifacts/agentsmith-release-contract.json',
    'http://127.0.0.1/artifacts/agentsmith-release-contract.json',
    'local://release-contract/agentsmith-release-contract.json',
  ])('rejects local ci_provenance artifact_uri %s through the shared validator', (artifactUri) => {
    const input = buildInput();
    input.ci_provenance.artifact_uri = artifactUri;

    expectThrowsWithMessage(input, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
  });

  it('rejects OpenAPI and AsyncAPI subject hash mismatch', () => {
    const input = buildInput();
    input.openapi_digest = `sha256:${'9'.repeat(64)}`;

    expectThrowsWithMessage(input, 'openapi_digest must match openapi_subject canonical digest');
  });

  it('rejects digest-only OpenAPI and AsyncAPI generator input', () => {
    const openapiDigestOnly = buildInput();
    delete openapiDigestOnly.openapi_subject;
    expectThrowsWithMessage(openapiDigestOnly, 'openapi_subject is required');

    const asyncapiDigestOnly = buildInput();
    delete asyncapiDigestOnly.asyncapi_subject;
    expectThrowsWithMessage(asyncapiDigestOnly, 'asyncapi_subject is required');
  });

  it('does not accept caller-provided inventory or artifact provenance', () => {
    const input = {
      ...buildInput(),
      deploy_image_inventory: [],
    } as AgentSmithReleaseContractGeneratorInput & { deploy_image_inventory: unknown[] };
    expectThrowsWithMessage(input, 'deploy_image_inventory must be generated, not provided by input');

    const provenanceInput = {
      ...buildInput(),
      artifact_provenance: {},
    } as AgentSmithReleaseContractGeneratorInput & { artifact_provenance: Record<string, never> };
    expectThrowsWithMessage(provenanceInput, 'artifact_provenance must be generated, not provided by input');
  });

  it('requires runnerImageLock and rejects caller-provided managed_runner_image', () => {
    const missingLock = buildInput() as Partial<AgentSmithReleaseContractGeneratorInput>;
    delete missingLock.runnerImageLock;
    expect(() => generateAgentSmithReleaseContract(
      missingLock as AgentSmithReleaseContractGeneratorInput,
      SOURCE_OPTIONS,
    )).toThrow('runnerImageLock is required');

    const callerProvided = {
      ...buildInput(),
      managed_runner_image: RUNNER_IMAGE_LOCK.image,
    } as AgentSmithReleaseContractGeneratorInput & { managed_runner_image: unknown };
    expectThrowsWithMessage(callerProvided, 'managed_runner_image must be assembled from runnerImageLock');
  });

  it('rejects invalid runnerImageLock protocol and digest drift', () => {
    const protocolDrift = buildInput();
    protocolDrift.runnerImageLock.runner_protocol_version = '0.9';
    expectThrowsWithMessage(protocolDrift, 'runner_protocol_version must exactly equal "1.0"');

    const digestDrift = buildInput();
    digestDrift.runnerImageLock.image.digest = `sha256:${'9'.repeat(64)}`;
    expectThrowsWithMessage(digestDrift, 'image.image digest must match image.digest');
  });

  it('rejects missing required image arrays with validation failures instead of TypeError', () => {
    const input = buildInput() as Partial<AgentSmithReleaseContractGeneratorInput>;
    delete input.product_images;

    expect(() => generateAgentSmithReleaseContract(
      input as AgentSmithReleaseContractGeneratorInput,
      SOURCE_OPTIONS,
    )).toThrow('product_images must be an array');
  });
});

describe('release contract CLI', () => {
  it('writes the generated contract to an explicit output path', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-'));
    const inputPath = join(root, 'input.json');
    const outputPath = join(root, 'agentsmith-release-contract.json');
    writeFileSync(inputPath, `${JSON.stringify(buildInput(), null, 2)}\n`);

    const stderr: string[] = [];
    const exitCode = runReleaseContractCli({
      argv: ['--input', inputPath, '--output', outputPath],
      env: {
        AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA: GIT_SHA,
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(stderr).toEqual([]);
    expect(exitCode).toBe(0);
    const contract = JSON.parse(readFileSync(outputPath, 'utf8')) as unknown;
    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
  });

  it('exits non-zero without leaving output when validation fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-'));
    const inputPath = join(root, 'input.json');
    const outputPath = join(root, 'agentsmith-release-contract.json');
    const input = buildInput();
    input.product_images = [
      {
        ...PRODUCT_IMAGES[0],
        image: `ghcr.io/agentsmith-project/agentsmith-app:${RELEASE_ID}`,
      },
    ];
    writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);

    const stderr: string[] = [];
    const exitCode = runReleaseContractCli({
      argv: ['--input', inputPath, '--output', outputPath],
      env: {
        AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA: GIT_SHA,
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('image must be pinned by digest');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('uses the env source git sha and does not write output when it mismatches input git_sha', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-contract-'));
    const inputPath = join(root, 'input.json');
    const outputPath = join(root, 'agentsmith-release-contract.json');
    writeFileSync(inputPath, `${JSON.stringify(buildInput(), null, 2)}\n`);

    const stderr: string[] = [];
    const exitCode = runReleaseContractCli({
      argv: ['--input', inputPath, '--output', outputPath],
      env: {
        AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('git_sha must match source git sha');
    expect(existsSync(outputPath)).toBe(false);
  });
});
