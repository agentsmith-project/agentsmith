import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CONSUMER_INSTALL_NPM_FLAGS,
  createConsumerInstallNpmArgs,
  createSanitizedRunnerContractPackageJson,
  validateDescriptorArtifactBytes,
  validateFormalTarballEntryList,
  validateFormalTarballMetadata,
  validateFormalArtifactTextBoundary,
  validatePackageMetadata,
  validatePackFileList,
} from './check-agent-runner-contract-artifact';
import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
  type CurrentRunnerContractArtifactDescriptor,
} from '../governance/current-release-boundary-schema';

const expectedPackFiles = [
  'contract-artifact.json',
  'dist/artifact.d.ts',
  'dist/artifact.js',
  'dist/contract-schema.d.ts',
  'dist/contract-schema.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/protocol.d.ts',
  'dist/protocol.js',
  'dist/runner-spec.d.ts',
  'dist/runner-spec.js',
  'package.json',
] as const;

describe('check-agent-runner-contract-artifact', () => {
  it('accepts only the expected pack artifact files', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles], errors);

    expect(errors).toEqual([]);
  });

  it('rejects stale dist files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'dist/stale.js'], errors);

    expect(errors).toContain('pack tarball contains unexpected artifact file: dist/stale.js');
  });

  it('rejects source files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'src/index.ts'], errors);

    expect(errors).toContain('pack tarball must not include source tests or source files: src/index.ts');
    expect(errors).toContain('pack tarball contains unexpected artifact file: src/index.ts');
  });

  it('rejects test files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'dist/index.test.js'], errors);

    expect(errors).toContain('pack tarball must not include source tests or source files: dist/index.test.js');
    expect(errors).toContain('pack tarball contains unexpected artifact file: dist/index.test.js');
  });

  it('rejects local and sibling paths from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([
      ...expectedPackFiles,
      '/home/percy/works/mbos-v1/agentsmith/packages/agent-runner-contract/dist/index.js',
      '../agentsmith-runner/dist/index.js',
    ], errors);

    expect(errors).toContain(
      'pack tarball must not include workspace/local/sibling paths: /home/percy/works/mbos-v1/agentsmith/packages/agent-runner-contract/dist/index.js',
    );
    expect(errors).toContain(
      'pack tarball must not include workspace/local/sibling paths: ../agentsmith-runner/dist/index.js',
    );
  });

  it('rejects formal artifact descriptor or tarball metadata that leaks pre-GA runner shim/runtime fields', () => {
    const errors: string[] = [];

    validateFormalArtifactTextBoundary(
      'runner-contract-artifact.json',
      JSON.stringify({
        package: {
          name: '@mbos/agent-runner-contract',
        },
        legacyShim: '@mbos/agent-runner',
        legacyRuntime: 'buildAgentRuntimeEnv',
        localPath: '/home/percy/works/mbos-v1/agentsmith/packages/agent-runner/dist/index.js',
        siblingPath: '../agentsmith-runner/dist/index.js',
      }),
      errors,
    );

    expect(errors).toEqual([
      'runner-contract-artifact.json must not reference legacy @mbos/agent-runner package names',
      'runner-contract-artifact.json must not reference buildAgentRuntimeEnv',
      'runner-contract-artifact.json must not include workspace/local/sibling paths',
    ]);
  });

  it('allows the formal artifact descriptor to name only @mbos/agent-runner-contract', () => {
    const errors: string[] = [];

    validateFormalArtifactTextBoundary(
      'runner-contract-artifact.json',
      JSON.stringify({
        package: {
          name: '@mbos/agent-runner-contract',
        },
        artifact: {
          uri: 'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
        },
      }),
      errors,
    );

    expect(errors).toEqual([]);
  });

  it('rejects install-affecting lifecycle scripts and local dependency specs in source package metadata', () => {
    const packageJson = createPackageJsonForMetadata();
    const errors: string[] = [];

    packageJson.scripts = {
      ...(packageJson.scripts as Record<string, string>),
      preinstall: 'node preinstall.js',
      install: 'node install.js',
      postinstall: 'node postinstall.js',
      prepare: 'node prepare.js',
    };
    packageJson.dependencies = {
      local: 'file:../local-package',
    };
    packageJson.devDependencies = {
      workspaceTool: 'workspace:*',
    };
    packageJson.peerDependencies = {
      linkedPeer: 'link:../linked-peer',
    };

    validatePackageMetadata(packageJson, errors);

    expect(errors).toEqual(expect.arrayContaining([
      'scripts.preinstall must not be present on the source package',
      'scripts.install must not be present on the source package',
      'scripts.postinstall must not be present on the source package',
      'scripts.prepare must not be present on the source package',
      'dependencies.local must not use a workspace/local path spec',
      'devDependencies.workspaceTool must not use a workspace/local path spec',
      'peerDependencies.linkedPeer must not use a workspace/local path spec',
    ]));
  });

  it('builds sanitized package metadata for default local pack and install validation', () => {
    const packageJson = createSanitizedRunnerContractPackageJson({
      ...createPackageJsonForMetadata(),
      private: false,
      dependencies: {
        local: 'file:../local-package',
      },
      devDependencies: {
        typescript: '^5.9.3',
      },
    });

    expect(packageJson).toEqual(createSanitizedPackageJsonForMetadata());
    expect(packageJson).not.toHaveProperty('private');
    expect(packageJson).not.toHaveProperty('scripts');
    expect(packageJson).not.toHaveProperty('dependencies');
    expect(packageJson).not.toHaveProperty('devDependencies');
  });

  it('installs tarball consumers with npm lifecycle scripts disabled', () => {
    expect(CONSUMER_INSTALL_NPM_FLAGS).toEqual([
      '--ignore-scripts',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
    ]);
    expect(createConsumerInstallNpmArgs('/tmp/runner-contract.tgz')).toEqual([
      'install',
      '--ignore-scripts',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      '/tmp/runner-contract.tgz',
    ]);
  });

  it('checks descriptor sha256 and npm SRI integrity against the referenced tgz bytes', () => {
    const artifactBytes = Buffer.from('runner contract tgz bytes');
    const descriptor = createDescriptorForBytes(artifactBytes);
    const errors: string[] = [];

    validateDescriptorArtifactBytes(descriptor, artifactBytes, errors);

    expect(errors).toEqual([]);
  });

  it('rejects descriptor digest or npm SRI integrity drift', () => {
    const artifactBytes = Buffer.from('runner contract tgz bytes');
    const descriptor = createDescriptorForBytes(Buffer.from('different bytes'));
    const errors: string[] = [];

    validateDescriptorArtifactBytes(descriptor, artifactBytes, errors);

    expect(errors).toEqual([
      `runner contract artifact sha256 must match descriptor artifact.sha256 ${descriptor.artifact.sha256}`,
      `runner contract artifact integrity must match descriptor artifact.integrity ${descriptor.artifact.integrity}`,
    ]);
  });

  it('rejects formal tarball entries outside package root or with unsafe path forms', () => {
    const errors: string[] = [];

    validateFormalTarballEntryList([
      { path: 'package/package.json', type: '-' },
      { path: 'README.md', type: '-' },
      { path: 'package/../evil.js', type: '-' },
      { path: '/package/dist/index.js', type: '-' },
      { path: 'package\\dist\\index.js', type: '-' },
    ], errors);

    expect(errors).toEqual(expect.arrayContaining([
      'formal tarball entry must stay under package/: README.md',
      'formal tarball entry must not contain traversal segments: package/../evil.js',
      'formal tarball entry must not be absolute: /package/dist/index.js',
      'formal tarball entry must not contain backslashes: package\\dist\\index.js',
    ]));
  });

  it('rejects formal tarball symlink and hardlink entries before extraction', () => {
    const errors: string[] = [];

    validateFormalTarballEntryList([
      { path: 'package/package.json', type: '-' },
      { path: 'package/dist/link.js', type: 'l' },
      { path: 'package/dist/hardlink.js', type: 'h' },
    ], errors);

    expect(errors).toEqual(expect.arrayContaining([
      'formal tarball entry must not be a symlink or hardlink: package/dist/link.js',
      'formal tarball entry must not be a symlink or hardlink: package/dist/hardlink.js',
    ]));
  });

  it('cross-checks formal tarball package metadata against the descriptor', () => {
    const descriptor = createDescriptorForBytes(Buffer.from('runner contract tgz bytes'));
    const packageJson = createPackageJsonForMetadata();
    const artifactManifest = createArtifactManifestForMetadata();
    const errors: string[] = [];

    packageJson.version = '0.1.1';
    artifactManifest.package = {
      name: '@mbos/agent-runner-contract',
      version: '0.1.1',
    };
    artifactManifest.entrypoints = {
      ...descriptor.entrypoints,
      schema: './dist/index.js',
    };

    validateFormalTarballMetadata(descriptor, packageJson, artifactManifest, errors);

    expect(errors).toEqual(expect.arrayContaining([
      'tarball package.version must match descriptor package.version "0.1.0", got "0.1.1"',
      'tarball contract-artifact.package.version must match descriptor package.version "0.1.0", got "0.1.1"',
      'tarball contract-artifact.entrypoints must match descriptor entrypoints.',
    ]));
  });

  it('rejects legacy local pack manifest metadata and tgz provenance fields inside the package manifest', () => {
    const descriptor = createDescriptorForBytes(Buffer.from('runner contract tgz bytes'));
    const packageJson = createSanitizedPackageJsonForMetadata();
    const artifactManifest = {
      name: '@mbos/agent-runner-contract',
      version: '0.1.0',
      artifact_kind: 'local_pack_manifest',
      formal_release_provenance: false,
      provenance_note: 'Local pack metadata only.',
      artifact: {
        sha256: `sha256:${'a'.repeat(64)}`,
        integrity: 'sha512-test',
      },
      artifact_provenance: {
        artifact_sha256: `sha256:${'a'.repeat(64)}`,
      },
      entrypoints: descriptor.entrypoints,
    };
    const errors: string[] = [];

    validateFormalTarballMetadata(descriptor, packageJson, artifactManifest, errors);

    expect(errors).toEqual(expect.arrayContaining([
      'contract-artifact.json must use package manifest v1, not legacy local_pack_manifest',
      'contract-artifact.schema_version must be "agentsmith.runner-contract-package-manifest/v1", got undefined',
      'contract-artifact.metadata_kind must be "runner_contract_package_manifest", got undefined',
      'contract-artifact.name must not be present in package manifest',
      'contract-artifact.version must not be present in package manifest',
      'contract-artifact.formal_release_provenance must not be present in package manifest',
      'contract-artifact.provenance_note must not be present in package manifest',
      'contract-artifact.artifact must not be present in package manifest',
      'contract-artifact.artifact_provenance must not be present in package manifest',
      'contract-artifact.package must be an object.',
      'contract-artifact.release_provenance must be {"kind":"external_descriptor","descriptor_name":"runner-contract-artifact.json"}, got undefined',
    ]));
  });

  it('rejects install-affecting lifecycle scripts and dependency sections in formal tarball package metadata', () => {
    const descriptor = createDescriptorForBytes(Buffer.from('runner contract tgz bytes'));
    const packageJson = createPackageJsonForMetadata();
    const artifactManifest = createArtifactManifestForMetadata();
    const errors: string[] = [];

    packageJson.dependencies = {
      zod: '^4.3.6',
    };
    packageJson.devDependencies = {
      typescript: '^5.9.3',
    };

    validateFormalTarballMetadata(descriptor, packageJson, artifactManifest, errors);

    expect(errors).toEqual(expect.arrayContaining([
      'formal tarball package scripts.prepack must not be present.',
      'formal tarball package dependencies must not be present.',
      'formal tarball package devDependencies must not be present.',
    ]));
  });

  it('accepts sanitized runtime package metadata in the formal tarball', () => {
    const descriptor = createDescriptorForBytes(Buffer.from('runner contract tgz bytes'));
    const packageJson = createSanitizedPackageJsonForMetadata();
    const artifactManifest = createArtifactManifestForMetadata();
    const errors: string[] = [];

    validateFormalTarballMetadata(descriptor, packageJson, artifactManifest, errors);

    expect(errors).toEqual([]);
  });
});

function createDescriptorForBytes(bytes: Buffer): CurrentRunnerContractArtifactDescriptor {
  const sha256 = sha256Digest(bytes.toString('utf8'));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const descriptor = {
    schema_version: 'agentsmith.runner-contract-artifact/v1',
    package: {
      name: '@mbos/agent-runner-contract',
      version: '0.1.0',
    },
    artifact: {
      filename: 'mbos-agent-runner-contract-0.1.0.tgz',
      uri: 'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
      sha256,
      integrity,
    },
    entrypoints: {
      version: './dist/artifact.js',
      schema: './dist/contract-schema.js',
      types: './dist/index.d.ts',
      fixtures: './dist/contract-schema.js',
    },
    artifact_provenance: {
      schema_version: 'agentsmith.artifact-provenance/v1',
      provenance_kind: 'ci_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: '1'.repeat(40),
      subject_name: 'runner-contract-artifact',
      subject_sha256: `sha256:${'0'.repeat(64)}`,
      subject_uri: 'runner-contract-artifact.json',
      workflow_name: 'Runner Contract Artifact',
      run_id: '123',
      run_attempt: '1',
      job: 'produce-runner-contract-artifact',
      artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
      artifact_sha256: sha256,
      generated_at: '2026-05-25T00:00:00.000Z',
      generator_command: 'npx tsx scripts/governance/runner-contract-artifact.ts',
      generator_version: 'p4-runner-contract-artifact',
      attestation: 'none',
    },
  } satisfies CurrentRunnerContractArtifactDescriptor;
  const subject = structuredClone(descriptor) as Record<string, unknown>;
  delete subject.artifact_provenance;

  return {
    ...descriptor,
    artifact_provenance: {
      ...descriptor.artifact_provenance,
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(subject)),
    },
  };
}

function createPackageJsonForMetadata(): Record<string, unknown> {
  return {
    name: '@mbos/agent-runner-contract',
    version: '0.1.0',
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
      './artifact': {
        types: './dist/artifact.d.ts',
        import: './dist/artifact.js',
        default: './dist/artifact.js',
      },
      './contract-artifact.json': './contract-artifact.json',
      './package.json': './package.json',
    },
    files: ['dist', 'contract-artifact.json'],
    scripts: {
      clean: 'rm -rf dist',
      build: 'npm run clean && tsc -p tsconfig.json',
      prepack: 'npm run build',
    },
  };
}

function createSanitizedPackageJsonForMetadata(): Record<string, unknown> {
  const packageJson = createPackageJsonForMetadata();
  delete packageJson.scripts;
  return packageJson;
}

function createArtifactManifestForMetadata(): Record<string, unknown> {
  return {
    schema_version: 'agentsmith.runner-contract-package-manifest/v1',
    metadata_kind: 'runner_contract_package_manifest',
    package: {
      name: '@mbos/agent-runner-contract',
      version: '0.1.0',
    },
    entrypoints: {
      version: './dist/artifact.js',
      schema: './dist/contract-schema.js',
      types: './dist/index.d.ts',
      fixtures: './dist/contract-schema.js',
    },
    release_provenance: {
      kind: 'external_descriptor',
      descriptor_name: 'runner-contract-artifact.json',
    },
  };
}
