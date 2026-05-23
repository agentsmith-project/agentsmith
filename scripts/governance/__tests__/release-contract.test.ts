import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  type CurrentAgentSmithReleaseContract,
  type CurrentDeployTemplatePackage,
} from '../current-release-boundary-schema';
import {
  generateAgentSmithReleaseContract,
  runReleaseContractCli,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';

const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const SOURCE_OPTIONS = { sourceGitSha: GIT_SHA } as const;

const PRODUCT_IMAGES = [
  {
    id: 'web',
    image: `ghcr.io/agentsmith-project/agentsmith-web:${RELEASE_ID}@sha256:${'1'.repeat(64)}`,
    digest: `sha256:${'1'.repeat(64)}`,
  },
  {
    id: 'api',
    image: `ghcr.io/agentsmith-project/agentsmith-api:${RELEASE_ID}@sha256:${'2'.repeat(64)}`,
    digest: `sha256:${'2'.repeat(64)}`,
  },
] as const;

const ADOPTED_PROVIDER_IMAGES = [
  {
    id: 'llmup',
    image: `ghcr.io/agentsmith-project/llmup:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
    digest: `sha256:${'3'.repeat(64)}`,
  },
] as const;

const RELEASE_KIT_PREREQUISITE_IMAGES = [
  {
    id: 'ingress_nginx_controller',
    image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
    digest: `sha256:${'4'.repeat(64)}`,
  },
] as const;

function buildDeployTemplatePackage(): CurrentDeployTemplatePackage {
  const subject: Omit<CurrentDeployTemplatePackage, 'artifact_provenance'> = {
    schema_version: 'agentsmith.deploy-template-package/v1',
    package_uri: 'gh-artifact://agentsmith/deploy-template-package/10001/agentsmith-deploy-template-package.tgz',
    package_sha256: `sha256:${'a'.repeat(64)}`,
    manifest_sha256: `sha256:${'6'.repeat(64)}`,
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
  return [
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
  ];
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

describe('release contract generator', () => {
  it('generates a validated contract with mechanical image inventory and deterministic provenance hashes', () => {
    const contract = generateAgentSmithReleaseContract(buildInput(), SOURCE_OPTIONS);

    expect(contract.deploy_image_inventory).toEqual([
      { ...PRODUCT_IMAGES[0], source: 'product_images' },
      { ...PRODUCT_IMAGES[1], source: 'product_images' },
      { ...ADOPTED_PROVIDER_IMAGES[0], source: 'adopted_provider_images' },
      { ...RELEASE_KIT_PREREQUISITE_IMAGES[0], source: 'release_kit_prerequisite_images' },
    ]);
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
        image: `ghcr.io/agentsmith-project/agentsmith-web:${RELEASE_ID}`,
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

    expectThrowsWithMessage(input, 'image id "web" is declared more than once');
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
        image: `ghcr.io/agentsmith-project/agentsmith-web:${RELEASE_ID}`,
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
