import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBuildManifestAggregate as buildBrokerManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
} from '../build-artifact-broker';
import {
  assembleReleaseContractGeneratorInput,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from '../release-contract-input';
import {
  generateAgentSmithReleaseContract,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';
import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateDeployTemplatePackage,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseImage,
} from '../current-release-boundary-schema';
import {
  DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME,
  DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME,
  generateDeployTemplatePackage,
  type DeployTemplatePackageGenerationInput,
} from '../deploy-template-package';

const REPO_ROOT = resolve(process.cwd());
const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-05-23T12:00:00.000Z';
const PACKAGE_URI =
  'gh-artifact://agentsmith/deploy-template-package/10001/agentsmith-deploy-template-package.tgz';
const APP_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST = `sha256:${'c'.repeat(64)}`;
const MANAGED_RUNNER_DIGEST = `sha256:${'b'.repeat(64)}`;
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'test',
  command: 'npm run build-artifact-broker',
  runtime: 'vitest',
};

function buildGenerationInput(
  overrides: Partial<DeployTemplatePackageGenerationInput> = {},
): DeployTemplatePackageGenerationInput {
  return {
    package_uri: PACKAGE_URI,
    git_sha: GIT_SHA,
    ci_provenance: {
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      job: 'package-deploy-template',
      generated_at: GENERATED_AT,
      generator_command: 'tsx scripts/governance/deploy-template-package.ts',
      generator_version: 'p1',
      attestation: 'none',
    },
    ...overrides,
  };
}

function outputRoot(): string {
  return mkdirTemp('agentsmith-deploy-template-package-output-');
}

function mkdirTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeTempRoot(): string {
  const root = mkdirTemp('agentsmith-deploy-template-package-root-');
  const deployRoot = join(root, 'infra/deploy/unified');
  mkdirSync(join(deployRoot, 'templates/app'), { recursive: true });
  mkdirSync(join(deployRoot, 'templates/local-kind-admin-preflight'), { recursive: true });
  writeFileSync(join(deployRoot, 'templates/app/rbac.yaml.tpl'), 'kind: Role\n');
  writeFileSync(
    join(deployRoot, 'templates/local-kind-admin-preflight/namespace.yaml.tpl'),
    'kind: Namespace\n',
  );
  writeFileSync(
    join(deployRoot, 'deployment.manifest.json'),
    `${JSON.stringify({
      schema_version: 'agentsmith.unified-deploy.manifest/v1',
      templates: {
        app: ['templates/app/rbac.yaml.tpl'],
        local_kind_admin_preflight: ['templates/local-kind-admin-preflight/namespace.yaml.tpl'],
      },
    }, null, 2)}\n`,
  );

  return root;
}

function archiveList(archivePath: string): string[] {
  return execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
}

function readArchiveMemberBytes(archivePath: string, memberPath: string): Buffer {
  return execFileSync('tar', ['-xOf', archivePath, memberPath]);
}

function readArchiveJson(archivePath: string, memberPath: string): Record<string, unknown> {
  return JSON.parse(readArchiveMemberBytes(archivePath, memberPath).toString('utf8')) as Record<
    string,
    unknown
  >;
}

function sha256FileDigest(path: string): string {
  return sha256BufferDigest(readFileSync(path));
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function descriptorSubject(descriptor: CurrentDeployTemplatePackage): Omit<
  CurrentDeployTemplatePackage,
  'artifact_provenance'
> {
  return {
    schema_version: descriptor.schema_version,
    package_uri: descriptor.package_uri,
    package_sha256: descriptor.package_sha256,
    manifest_sha256: descriptor.manifest_sha256,
  };
}

function readDeploymentManifestTemplates(repoRoot: string): string[] {
  const manifest = readJson(join(repoRoot, 'infra/deploy/unified/deployment.manifest.json'));
  const templates = manifest.templates;
  if (templates === null || typeof templates !== 'object' || Array.isArray(templates)) {
    throw new Error('test fixture deployment manifest templates must be an object');
  }

  return Object.values(templates)
    .flatMap((group) => Array.isArray(group) ? group : [])
    .filter((path): path is string => typeof path === 'string')
    .sort();
}

function expectPackageGenerationFailure(repoRoot: string, expected: string): void {
  const outputDir = outputRoot();

  expect(() => {
    generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir,
      sourceGitSha: GIT_SHA,
    });
  }).toThrow(expected);
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME))).toBe(false);
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME))).toBe(false);
}

function buildManifestAggregate() {
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

  return buildBrokerManifestAggregate({
    runId: 'build-run-20260523',
    releaseId: RELEASE_ID,
    versionPath: '/tmp/release/VERSION',
    mode: 'build',
    producer: BUILD_PRODUCER,
    generatedAt: GENERATED_AT,
    targets: [
      buildBuildManifestTarget({
        target: 'app',
        releaseId: RELEASE_ID,
        imageName: 'ghcr.io/agentsmith-project/agentsmith-app',
        contentKey,
        imageDigest: APP_DIGEST,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }),
    ],
  });
}

function buildManagedRunnerImage(): CurrentReleaseImage {
  return {
    id: 'managed_runner',
    image: `ghcr.io/agentsmith-project/agentsmith-managed-runner:${RELEASE_ID}@${MANAGED_RUNNER_DIGEST}`,
    digest: MANAGED_RUNNER_DIGEST,
  };
}

function buildReleaseContractAssemblyInput(
  deployTemplatePackage: CurrentDeployTemplatePackage,
): AgentSmithReleaseContractGeneratorInputAssemblyInput {
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
    sourceGitSha: GIT_SHA,
    buildManifestAggregate: buildManifestAggregate(),
    managed_runner_image: buildManagedRunnerImage(),
    deployTemplatePackage,
    openapi_subject: openapiSubject,
    openapi_digest: sha256Digest(canonicalReleaseBoundaryJson(openapiSubject)),
    asyncapi_subject: asyncapiSubject,
    asyncapi_digest: sha256Digest(canonicalReleaseBoundaryJson(asyncapiSubject)),
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

describe('deploy template package generator', () => {
  it('generates a validated descriptor and deterministic archive with non-self-referential provenance', () => {
    const outputDir = outputRoot();
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir,
      sourceGitSha: GIT_SHA,
    });

    expect(result.archivePath).toBe(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME));
    expect(result.descriptorPath).toBe(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME));
    expect(validateDeployTemplatePackage(result.descriptor).ok).toBe(true);

    const manifestJson = canonicalReleaseBoundaryJson(result.manifest);
    const archivedManifestBytes = readArchiveMemberBytes(result.archivePath, 'manifest.json');
    expect(archivedManifestBytes.toString('utf8')).toBe(`${manifestJson}\n`);
    expect(result.descriptor.manifest_sha256).toBe(sha256BufferDigest(archivedManifestBytes));
    expect(result.descriptor.package_sha256).toBe(sha256FileDigest(result.archivePath));
    expect(readArchiveJson(result.archivePath, 'manifest.json')).toEqual(result.manifest);
    expect(readJson(result.descriptorPath)).toEqual(result.descriptor);
    expect(result.manifest.source_deployment_manifest.sha256).toBe(
      sha256FileDigest(join(REPO_ROOT, 'infra/deploy/unified/deployment.manifest.json')),
    );
    expect(result.manifest.package_files.map((file) => file.path)).toContain('deployment.manifest.json');
    expect(new Set(result.manifest.package_files.map((file) => file.path)).size).toBe(
      result.manifest.package_files.length,
    );

    const subject = descriptorSubject(result.descriptor);
    expect(result.descriptor.artifact_provenance.subject_sha256).toBe(
      sha256Digest(canonicalReleaseBoundaryJson(subject)),
    );
    expect(result.descriptor.artifact_provenance.subject_sha256).not.toBe(
      sha256Digest(canonicalReleaseBoundaryJson(result.descriptor)),
    );
    expect(result.descriptor.artifact_provenance.artifact_uri).toBe(result.descriptor.package_uri);
    expect(result.descriptor.artifact_provenance.artifact_sha256).toBe(result.descriptor.package_sha256);
    expect(result.descriptor.artifact_provenance.commit_sha).toBe(GIT_SHA);
    expect(result.descriptor.artifact_provenance.producer_repo).toBe(
      'github.com/agentsmith-project/agentsmith',
    );
  });

  it('binds manifest_sha256 to the exact manifest.json archive member bytes', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const archivedManifestBytes = readArchiveMemberBytes(result.archivePath, 'manifest.json');

    expect(result.descriptor.manifest_sha256).toBe(sha256BufferDigest(archivedManifestBytes));
  });

  it('archives only manifest.json, deployment.manifest.json, and deployment manifest declared templates', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const templates = readDeploymentManifestTemplates(REPO_ROOT);
    const entries = archiveList(result.archivePath);

    expect(entries).toEqual([
      'deployment.manifest.json',
      'manifest.json',
      ...templates,
    ].sort());
    for (const forbidden of [
      'env/site.env.example',
      'substrate/connection.env',
      'substrate/docker-compose.yml',
      'package.json',
    ]) {
      expect(entries).not.toContain(forbidden);
    }
    expect(entries.some((entry) => entry.startsWith('scripts/'))).toBe(false);
    expect(entries.some((entry) => entry.includes('node_modules'))).toBe(false);
  });

  it('repeats the same manifest and archive digests for identical input', () => {
    const first = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const second = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    expect(second.descriptor.manifest_sha256).toBe(first.descriptor.manifest_sha256);
    expect(second.descriptor.package_sha256).toBe(first.descriptor.package_sha256);
  });

  it('changes manifest_sha256 when a declared template changes', () => {
    const repoRoot = makeTempRoot();
    const first = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    writeFileSync(
      join(repoRoot, 'infra/deploy/unified/templates/app/rbac.yaml.tpl'),
      'kind: Role\nmetadata:\n  name: changed\n',
    );
    const second = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    expect(second.descriptor.manifest_sha256).not.toBe(first.descriptor.manifest_sha256);
  });

  it.each([
    ['absolute path', ['/tmp/rbac.yaml.tpl'], 'safe relative path'],
    ['parent traversal', ['templates/../rbac.yaml.tpl'], 'safe relative path'],
    ['backslash path', ['templates\\app\\rbac.yaml.tpl'], 'safe relative path'],
    [
      'duplicate path',
      ['templates/app/rbac.yaml.tpl', 'templates/app/rbac.yaml.tpl'],
      'declared more than once',
    ],
    ['reserved package manifest path', ['manifest.json'], 'reserved package path'],
    ['reserved deployment manifest path', ['deployment.manifest.json'], 'reserved package path'],
    ['non-template env example', ['env/site.env.example'], 'must start with templates/ and end with .tpl'],
    [
      'non-template connection env',
      ['substrate/connection.env'],
      'must start with templates/ and end with .tpl',
    ],
    ['missing file', ['templates/app/missing.yaml.tpl'], 'does not exist'],
  ])('rejects unsafe template manifest entries: %s', (_name, paths, expected) => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    writeFileSync(
      join(deployRoot, 'deployment.manifest.json'),
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: paths,
        },
      }, null, 2)}\n`,
    );

    expect(() => {
      generateDeployTemplatePackage(buildGenerationInput(), {
        repoRoot,
        outputDir: outputRoot(),
        sourceGitSha: GIT_SHA,
      });
    }).toThrow(expected);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects prototype-polluting template group name %s before packaging',
    (templateGroupName) => {
      const repoRoot = makeTempRoot();
      const deployRoot = join(repoRoot, 'infra/deploy/unified');
      writeFileSync(
        join(deployRoot, 'deployment.manifest.json'),
        `${JSON.stringify({
          schema_version: 'agentsmith.unified-deploy.manifest/v1',
          templates: Object.fromEntries([[templateGroupName, ['templates/app/rbac.yaml.tpl']]]),
        })}\n`,
      );

      expectPackageGenerationFailure(repoRoot, 'template group name');
    },
  );

  it('rejects template paths whose parent directory is a symlink escape', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-outside-');
    mkdirSync(join(outsideRoot, 'escaped'), { recursive: true });
    writeFileSync(join(outsideRoot, 'escaped/rbac.yaml.tpl'), 'kind: Escaped\n');
    symlinkSync(join(outsideRoot, 'escaped'), join(deployRoot, 'templates/escaped'), 'dir');
    writeFileSync(
      join(deployRoot, 'deployment.manifest.json'),
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: ['templates/escaped/rbac.yaml.tpl'],
        },
      }, null, 2)}\n`,
    );

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects template paths whose final file component is a symlink', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-final-symlink-outside-');
    const outsideTemplate = join(outsideRoot, 'rbac.yaml.tpl');
    writeFileSync(outsideTemplate, 'kind: Escaped\n');
    rmSync(join(deployRoot, 'templates/app/rbac.yaml.tpl'), { force: true });
    symlinkSync(outsideTemplate, join(deployRoot, 'templates/app/rbac.yaml.tpl'), 'file');

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects deploy root path segments that are symlink escapes', () => {
    const repoRoot = mkdirTemp('agentsmith-deploy-template-package-root-symlink-');
    const outsideDeployRoot = makeTempRoot();
    mkdirSync(join(repoRoot, 'infra/deploy'), { recursive: true });
    symlinkSync(
      join(outsideDeployRoot, 'infra/deploy/unified'),
      join(repoRoot, 'infra/deploy/unified'),
      'dir',
    );

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects deployment.manifest.json when it is a symlink escape', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-manifest-outside-');
    const outsideManifest = join(outsideRoot, 'deployment.manifest.json');
    writeFileSync(
      outsideManifest,
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: ['templates/app/rbac.yaml.tpl'],
        },
      }, null, 2)}\n`,
    );
    rmSync(join(deployRoot, 'deployment.manifest.json'), { force: true });
    symlinkSync(outsideManifest, join(deployRoot, 'deployment.manifest.json'), 'file');

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/agentsmith-deploy-template-package.tgz',
    './agentsmith-deploy-template-package.tgz',
    'local://deploy-template-package/agentsmith-deploy-template-package.tgz',
  ])('rejects local, relative, or file package_uri %s', (packageUri) => {
    expect(() => {
      generateDeployTemplatePackage(buildGenerationInput({ package_uri: packageUri }), {
        repoRoot: REPO_ROOT,
        outputDir: outputRoot(),
        sourceGitSha: GIT_SHA,
      });
    }).toThrow('package_uri must be a remote/CI artifact URI');
  });

  it('keeps release contract assembly bound to the generated deploy template manifest digest', () => {
    const packageResult = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const generatorInput = assembleReleaseContractGeneratorInput(
      buildReleaseContractAssemblyInput(packageResult.descriptor),
    );
    const contract = generateAgentSmithReleaseContract(generatorInput, {
      sourceGitSha: GIT_SHA,
    });

    expect((generatorInput as AgentSmithReleaseContractGeneratorInput).deploy_template_digest).toBe(
      packageResult.descriptor.manifest_sha256,
    );
    expect(contract.deploy_template_digest).toBe(packageResult.descriptor.manifest_sha256);
  });
});
