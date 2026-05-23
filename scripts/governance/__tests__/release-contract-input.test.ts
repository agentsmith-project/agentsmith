import { describe, expect, it } from 'vitest';

import {
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  type CurrentBuildManifestAggregate,
} from '../build-artifact-broker';
import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  type CurrentDeployTemplatePackage,
} from '../current-release-boundary-schema';
import {
  assembleReleaseContractGeneratorInput,
  buildProductImagesFromBuildManifest,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from '../release-contract-input';
import {
  generateAgentSmithReleaseContract,
  type AgentSmithReleaseContractCiProvenanceInput,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';

const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-05-23T12:00:00.000Z';
const SOURCE_OPTIONS = { sourceGitSha: GIT_SHA } as const;
const APP_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST = `sha256:${'b'.repeat(64)}`;
const MANAGED_RUNNER_DIGEST = `sha256:${'c'.repeat(64)}`;
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'test',
  command: 'npm run build-artifact-broker',
  runtime: 'vitest',
};

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

function buildManagedRunnerImage() {
  return {
    id: 'managed_runner',
    image: `ghcr.io/agentsmith-project/agentsmith-managed-runner:${RELEASE_ID}@${MANAGED_RUNNER_DIGEST}`,
    digest: MANAGED_RUNNER_DIGEST,
  };
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
        image: `ghcr.io/agentsmith-project/llmup:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
        digest: `sha256:${'3'.repeat(64)}`,
      },
    ],
    release_kit_prerequisite_images: [
      {
        id: 'ingress_nginx_controller',
        image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
        digest: `sha256:${'4'.repeat(64)}`,
      },
    ],
    deploy_template_digest: `sha256:${'7'.repeat(64)}`,
    deploy_template_package: buildDeployTemplatePackage(),
    openapi_subject: openapiSubject,
    openapi_digest: sha256Digest(canonicalReleaseBoundaryJson(openapiSubject)),
    asyncapi_subject: asyncapiSubject,
    asyncapi_digest: sha256Digest(canonicalReleaseBoundaryJson(asyncapiSubject)),
    target_profiles: [
      {
        target_cluster: 'existing_kubernetes',
        substrate_source: 'external_declared',
        distribution: 'online',
        required: true,
        prerequisites: {
          namespace: 'agentsmith',
          rbac: 'namespace_admin',
          ingress: 'operator_provided',
          tls: 'required',
          storage_class: 'operator_provided',
          registry: 'ghcr_or_operator_mirror',
          pull_secret_ref: 'operator_secret_ref',
        },
      },
      {
        target_cluster: 'kind_rehearsal',
        substrate_source: 'kit_installed',
        distribution: 'online',
        required: false,
        prerequisites: {
          namespace: 'agentsmith',
          rbac: 'local_admin',
          ingress: 'local',
          tls: 'optional',
          storage_class: 'standard',
          registry: 'local_kind_import',
          pull_secret_ref: 'not_required',
        },
      },
    ],
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
    managed_runner_image: buildManagedRunnerImage(),
    deployTemplatePackage: buildDeployTemplatePackage(),
    openapi_subject: buildOpenApiSubject(),
    asyncapi_subject: buildAsyncApiSubject(),
    adopted_provider_images: [
      {
        id: 'llmup',
        image: `ghcr.io/agentsmith-project/llmup:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
        digest: `sha256:${'3'.repeat(64)}`,
      },
    ],
    release_kit_prerequisite_images: [
      {
        id: 'ingress_nginx_controller',
        image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
        digest: `sha256:${'4'.repeat(64)}`,
      },
    ],
    target_profiles: [
      {
        target_cluster: 'existing_kubernetes',
        substrate_source: 'external_declared',
        distribution: 'online',
        required: true,
        prerequisites: {
          namespace: 'agentsmith',
          rbac: 'namespace_admin',
          ingress: 'operator_provided',
          tls: 'required',
          storage_class: 'operator_provided',
          registry: 'ghcr_or_operator_mirror',
          pull_secret_ref: 'operator_secret_ref',
        },
      },
      {
        target_cluster: 'kind_rehearsal',
        substrate_source: 'kit_installed',
        distribution: 'online',
        required: false,
        prerequisites: {
          namespace: 'agentsmith',
          rbac: 'local_admin',
          ingress: 'local',
          tls: 'optional',
          storage_class: 'standard',
          registry: 'local_kind_import',
          pull_secret_ref: 'not_required',
        },
      },
    ],
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

describe('release contract input adapter', () => {
  it('assembles generator input from explicit build, template, contract subject, image and CI inputs', () => {
    const input = buildAssemblyInput();
    const generatorInput = assembleReleaseContractGeneratorInput(input);
    const contract = generateAgentSmithReleaseContract(generatorInput, SOURCE_OPTIONS);
    const appProductImages = buildProductImagesFromBuildManifest(input.buildManifestAggregate, {
      expectedReleaseId: RELEASE_ID,
    });

    expect(generatorInput.product_images).toEqual([...appProductImages, buildManagedRunnerImage()]);
    expect(generatorInput.deploy_template_package).toBe(input.deployTemplatePackage);
    expect(generatorInput.deploy_template_digest).toBe(input.deployTemplatePackage.manifest_sha256);
    expect(generatorInput.openapi_subject).toBe(input.openapi_subject);
    expect(generatorInput.asyncapi_subject).toBe(input.asyncapi_subject);
    expect('deploy_image_inventory' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect('artifact_provenance' in (generatorInput as unknown as Record<string, unknown>)).toBe(false);
    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory).toContainEqual({
      ...buildManagedRunnerImage(),
      source: 'product_images',
    });
  });

  it('fails fast when the explicit managed runner image is missing or not an object', () => {
    const missing = buildAssemblyInput() as Partial<AgentSmithReleaseContractGeneratorInputAssemblyInput>;
    delete missing.managed_runner_image;
    expectAssemblyToThrow(
      missing as AgentSmithReleaseContractGeneratorInputAssemblyInput,
      'managed_runner_image must be an object',
    );

    const notObject = {
      ...buildAssemblyInput(),
      managed_runner_image: 'ghcr.io/agentsmith-project/agentsmith-managed-runner:tag',
    } as unknown as AgentSmithReleaseContractGeneratorInputAssemblyInput;
    expectAssemblyToThrow(notObject, 'managed_runner_image must be an object');
  });

  it('fails fast when the explicit managed runner image id is not managed_runner', () => {
    const input = buildAssemblyInput();
    input.managed_runner_image = {
      ...buildManagedRunnerImage(),
      id: 'agent_task_runner',
    };

    expectAssemblyToThrow(input, 'managed_runner_image.id must be "managed_runner"');
  });

  it('leaves managed runner required image and digest validation to the release contract boundary', () => {
    const missingImage = buildAssemblyInput();
    delete (missingImage.managed_runner_image as Partial<ReturnType<typeof buildManagedRunnerImage>>).image;
    expect(() => {
      generateAgentSmithReleaseContract(assembleReleaseContractGeneratorInput(missingImage), SOURCE_OPTIONS);
    }).toThrow('product_images[3].image must be a non-empty string');

    const missingDigest = buildAssemblyInput();
    delete (missingDigest.managed_runner_image as Partial<ReturnType<typeof buildManagedRunnerImage>>).digest;
    expect(() => {
      generateAgentSmithReleaseContract(assembleReleaseContractGeneratorInput(missingDigest), SOURCE_OPTIONS);
    }).toThrow('image digest is required');
  });

  it('leaves managed runner digest pinning and digest mismatch validation to the release contract boundary', () => {
    const tagOnly = buildAssemblyInput();
    tagOnly.managed_runner_image = {
      ...buildManagedRunnerImage(),
      image: `ghcr.io/agentsmith-project/agentsmith-managed-runner:${RELEASE_ID}`,
    };
    expect(() => {
      generateAgentSmithReleaseContract(assembleReleaseContractGeneratorInput(tagOnly), SOURCE_OPTIONS);
    }).toThrow('image must be pinned by digest');

    const digestMismatch = buildAssemblyInput();
    digestMismatch.managed_runner_image = {
      ...buildManagedRunnerImage(),
      image: `ghcr.io/agentsmith-project/agentsmith-managed-runner:${RELEASE_ID}@sha256:${'d'.repeat(64)}`,
    };
    expect(() => {
      generateAgentSmithReleaseContract(assembleReleaseContractGeneratorInput(digestMismatch), SOURCE_OPTIONS);
    }).toThrow('image digest must match the image ref digest');
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

  it('rejects caller-provided generator-owned inventory and artifact provenance fields', () => {
    const inventoryInput = {
      ...buildAssemblyInput(),
      deploy_image_inventory: [],
    } as AgentSmithReleaseContractGeneratorInputAssemblyInput & { deploy_image_inventory: unknown[] };

    expect(() => assembleReleaseContractGeneratorInput(inventoryInput)).toThrow(
      'deploy_image_inventory must be generated by release contract generator',
    );

    const provenanceInput = {
      ...buildAssemblyInput(),
      artifact_provenance: {},
    } as AgentSmithReleaseContractGeneratorInputAssemblyInput & { artifact_provenance: Record<string, never> };

    expect(() => assembleReleaseContractGeneratorInput(provenanceInput)).toThrow(
      'artifact_provenance must be generated by release contract generator',
    );
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
        id: 'web',
        image: `ghcr.io/agentsmith-project/agentsmith-app:release-${RELEASE_ID}@${APP_DIGEST}`,
        digest: APP_DIGEST,
      },
      {
        id: 'api',
        image: `ghcr.io/agentsmith-project/agentsmith-app:release-${RELEASE_ID}@${APP_DIGEST}`,
        digest: APP_DIGEST,
      },
      {
        id: 'product_schema_bootstrap',
        image: `ghcr.io/agentsmith-project/agentsmith-app:release-${RELEASE_ID}@${APP_DIGEST}`,
        digest: APP_DIGEST,
      },
    ]);

    const contract = generateAgentSmithReleaseContract(buildReleaseContractInput(productImages), SOURCE_OPTIONS);

    expect(validateAgentSmithReleaseContract(contract).ok).toBe(true);
    expect(contract.deploy_image_inventory.filter((image) => image.source === 'product_images')).toEqual([
      { ...productImages[0], source: 'product_images' },
      { ...productImages[1], source: 'product_images' },
      { ...productImages[2], source: 'product_images' },
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
