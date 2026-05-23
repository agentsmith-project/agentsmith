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
import { buildProductImagesFromBuildManifest } from '../release-contract-input';
import {
  generateAgentSmithReleaseContract,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';

const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-05-23T12:00:00.000Z';
const SOURCE_OPTIONS = { sourceGitSha: GIT_SHA } as const;
const APP_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST = `sha256:${'b'.repeat(64)}`;
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

function buildReleaseContractInput(
  productImages: AgentSmithReleaseContractGeneratorInput['product_images'],
): AgentSmithReleaseContractGeneratorInput {
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

function expectBuildProductImagesToThrow(value: unknown, expected: string): void {
  expect(() => buildProductImagesFromBuildManifest(value)).toThrow(expected);
}

describe('release contract input adapter', () => {
  it('maps the single app build manifest target into release contract product images', () => {
    const productImages = buildProductImagesFromBuildManifest(buildManifestAggregate());

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
