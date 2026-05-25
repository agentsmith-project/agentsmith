export const RUNNER_CONTRACT_VERSION = '0.1.0';

export const RUNNER_CONTRACT_ARTIFACT = {
  name: '@mbos/agent-runner-contract',
  version: RUNNER_CONTRACT_VERSION,
  artifact_kind: 'local_pack_manifest',
  formal_release_provenance: false,
  entrypoints: {
    version: './dist/artifact.js',
    schema: './dist/contract-schema.js',
    types: './dist/index.d.ts',
    fixtures: './dist/contract-schema.js',
  },
} as const;
