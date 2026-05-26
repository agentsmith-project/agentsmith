export const RUNNER_CONTRACT_VERSION = '0.1.0';

export const RUNNER_CONTRACT_ARTIFACT = {
  schema_version: 'agentsmith.runner-contract-package-manifest/v1',
  metadata_kind: 'runner_contract_package_manifest',
  package: {
    name: '@mbos/agent-runner-contract',
    version: RUNNER_CONTRACT_VERSION,
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
} as const;
