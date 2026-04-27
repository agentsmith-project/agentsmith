import { describe, expect, it } from 'vitest';

import {
  CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS,
  CURRENT_REHEARSAL_METADATA_SCHEMA,
  CURRENT_REHEARSAL_METADATA_VERSION,
  buildCurrentRehearsalMetadata,
  validateCurrentRehearsalMetadata,
} from '../current-rehearsal-metadata-schema';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;

function validMetadata() {
  return buildCurrentRehearsalMetadata({
    rehearsalMode: 'release-fidelity',
    resetLevel: 'data',
    generatedAt: '2026-04-27T12:00:00.000Z',
    worldIdentity: {
      runtime_line: 'demo-rehearsal',
      world_root: 'artifacts/runtime/scenario/demo-rehearsal',
      world_id: 'demo-rehearsal-world',
      kind_cluster_name: 'agentsmith-demo',
      registry_name: 'agentsmith-registry',
      public_base_origin: 'http://127.0.0.1:3000',
      port_family: 'demo',
      service_ports: {
        web: 3000,
        api: 20000,
        keycloak: 18080,
        registry: 5001,
      },
      kind_config_digest: SHA_A,
      image_manifest_digest: SHA_B,
      deploy_scripts_digest: SHA_C,
      health_check_ref: 'scripts/governance/sentinel-preflight.ts',
    },
    skipInvalidation: {
      target: 'docker-image-load',
      operation: 'skip-if-image-manifest-unchanged',
      input_digest: SHA_A,
      existing_artifact_digest: SHA_B,
      skip_reason: 'image_manifest_digest_matches',
      validator: 'current-rehearsal-metadata-schema',
    },
  });
}

describe('current rehearsal metadata schema', () => {
  it('builds and validates read-only rehearsal metadata without creating verdict or evidence truth', () => {
    const metadata = validMetadata();

    expect(metadata).toMatchObject({
      schema: CURRENT_REHEARSAL_METADATA_SCHEMA,
      version: CURRENT_REHEARSAL_METADATA_VERSION,
      projection_kind: 'read_only_rehearsal_metadata',
      rehearsal_mode: 'release-fidelity',
      reset_level: 'data',
      produces_release_verdict: false,
      participates_in_evidence_completeness: false,
      writes_canonical_result: false,
    });
    expect(metadata).not.toHaveProperty('mode');
    expect(metadata.world_identity.runtime_line).toBe('demo-rehearsal');
    expect(Object.keys(metadata.skip_invalidation)).toEqual([
      'target',
      'operation',
      'input_digest',
      'existing_artifact_digest',
      'skip_reason',
      'validator',
    ]);
    expect(metadata.skip_invalidation).not.toHaveProperty('reason');
    expect(JSON.stringify(metadata.skip_invalidation)).not.toMatch(/verdict|claim_id|reusable|passed|result_status/);
    expect(validateCurrentRehearsalMetadata(metadata)).toEqual({
      ok: true,
      value: metadata,
    });
  });

  it.each([
    ['rehearsal_mode', { rehearsal_mode: 'debug' }],
    ['reset_level', { reset_level: 'full' }],
    ['runtime_line', { world_identity: { runtime_line: 'local-real' } }],
  ])('rejects invalid %s values', (_field, patch) => {
    const metadata = validMetadata();
    const polluted = {
      ...metadata,
      ...patch,
      world_identity: {
        ...metadata.world_identity,
        ...('world_identity' in patch ? patch.world_identity : {}),
      },
    };

    const result = validateCurrentRehearsalMetadata(polluted);

    expect(result.ok).toBe(false);
  });

  it('rejects legacy mode and reason field names', () => {
    const metadata = validMetadata();
    const { rehearsal_mode: _rehearsalMode, ...withoutRehearsalMode } = metadata;
    const { skip_reason: _skipReason, ...withoutSkipReason } = metadata.skip_invalidation;

    expect(validateCurrentRehearsalMetadata({
      ...withoutRehearsalMode,
      mode: 'release-fidelity',
    }).ok).toBe(false);
    expect(validateCurrentRehearsalMetadata({
      ...metadata,
      skip_invalidation: {
        ...withoutSkipReason,
        reason: 'legacy_reason_field',
      },
    }).ok).toBe(false);
  });

  it.each(CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS)(
    'rejects forbidden verdict/evidence field %s anywhere in the metadata',
    (field) => {
      const metadata = validMetadata();

      expect(validateCurrentRehearsalMetadata({ ...metadata, [field]: 'forbidden' }).ok).toBe(false);
      expect(
        validateCurrentRehearsalMetadata({
          ...metadata,
          skip_invalidation: {
            ...metadata.skip_invalidation,
            [field]: 'forbidden',
          },
        }).ok,
      ).toBe(false);
    },
  );

  it('rejects raw secret fields and raw secret-looking values', () => {
    const metadata = validMetadata();

    expect(
      validateCurrentRehearsalMetadata({
        ...metadata,
        world_identity: {
          ...metadata.world_identity,
          api_key: 'sk-raw-secret-value',
        },
      }).ok,
    ).toBe(false);

    expect(
      validateCurrentRehearsalMetadata({
        ...metadata,
        world_identity: {
          ...metadata.world_identity,
          world_id: 'Bearer raw-token-value',
        },
      }).ok,
    ).toBe(false);
  });

  it.each([
    'managed_credentials: {"feishu":"raw-secret"}',
    '{"password":"raw-secret"}',
    "value: 'raw-secret'",
  ])('rejects object-ish raw secret string %s', (secretishReason) => {
    const metadata = validMetadata();

    expect(
      validateCurrentRehearsalMetadata({
        ...metadata,
        skip_invalidation: {
          ...metadata.skip_invalidation,
          skip_reason: secretishReason,
        },
      }).ok,
    ).toBe(false);
  });

  it('builder allowlists world identity output so wider secret-bearing input does not leak', () => {
    const widerWorldIdentity = {
      runtime_line: 'demo-rehearsal' as const,
      world_root: 'artifacts/runtime/scenario/demo-rehearsal',
      service_ports: {
        web: 3000,
      },
      api_key: 'sk-builder-raw-secret-value',
      ticket: 'ticket=builder-raw-ticket',
      managed_credentials: {
        feishu: 'raw-secret',
      },
    };

    const metadata = buildCurrentRehearsalMetadata({
      rehearsalMode: 'fast',
      resetLevel: 'none',
      generatedAt: '2026-04-27T12:00:00.000Z',
      worldIdentity: widerWorldIdentity,
      skipInvalidation: {
        target: 'rollout',
        operation: 'skip-if-inputs-unchanged',
        input_digest: SHA_A,
        existing_artifact_digest: SHA_B,
        skip_reason: 'input_digest_matches',
        validator: 'current-rehearsal-metadata-schema',
      },
    });

    expect(metadata.world_identity).not.toHaveProperty('api_key');
    expect(metadata.world_identity).not.toHaveProperty('ticket');
    expect(metadata.world_identity).not.toHaveProperty('managed_credentials');
    expect(JSON.stringify(metadata)).not.toContain('raw-secret');
    expect(validateCurrentRehearsalMetadata(metadata).ok).toBe(true);
  });
});
