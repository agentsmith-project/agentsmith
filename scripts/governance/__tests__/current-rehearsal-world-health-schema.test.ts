import { describe, expect, it } from 'vitest';

import {
  CURRENT_REHEARSAL_WORLD_HEALTH_FORBIDDEN_FIELDS,
  CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA,
  CURRENT_REHEARSAL_WORLD_HEALTH_VERSION,
  buildCurrentRehearsalWorldHealthSnapshot,
  validateCurrentRehearsalWorldHealthSnapshot,
} from '../current-rehearsal-world-health-schema';

function validSnapshot() {
  return buildCurrentRehearsalWorldHealthSnapshot({
    generatedAt: '2026-04-27T12:00:00.000Z',
    runtimeLine: 'demo-rehearsal',
    rehearsalMode: 'release-fidelity',
    healthStatus: 'degraded',
    worldIdentity: {
      runtime_line: 'demo-rehearsal',
      world_root: 'artifacts/runtime/scenario/demo-rehearsal',
      world_id: 'demo-rehearsal:agentsmith-demo:agentsmith-demo-registry:33001:40000',
      active_scenario: 'demo-rehearsal',
      phase: 'deploy_completed',
      release_id: 'demo-release-20260427',
      public_bases: {
        web: 'http://localhost:33001',
        api: 'http://localhost:40000',
        keycloak: 'http://localhost:38080',
        sandbox: 'http://127.0.0.1:29280',
      },
      ports: {
        web: 33001,
        api: 40000,
        keycloak: 38080,
        sandbox: 29280,
        registry: 5003,
      },
      kind_cluster: {
        name: 'agentsmith-demo',
        present: 'present',
      },
      registry: {
        name: 'agentsmith-demo-registry',
        host: '127.0.0.1',
        host_port: 5003,
        present: 'present',
      },
    },
    componentHealth: {
      world_root: 'present',
      state_file: 'present',
      current_release: 'present',
      web: { status: 'healthy', observed: '200' },
      api: { status: 'unhealthy', observed: '500' },
      keycloak: { status: 'healthy', observed: '200' },
      sandbox: { status: 'healthy', observed: '200' },
    },
    safeResetLevel: 'world',
    safeNextCommand: 'make demo-rehearsal-reset && npm run rehearse:demo',
    safeResetReason: 'api service health is unhealthy; reset the rehearsal world before rerun.',
    authorityPaths: {
      world_root: 'artifacts/runtime/scenario/demo-rehearsal',
      active_scenario_lock: 'artifacts/runtime/active-scenario.lock',
      active_scenario_state: 'artifacts/runtime/active-scenario.env',
      state_file: 'artifacts/runtime/scenario/demo-rehearsal/state/deploy-state.json',
      site_env: 'artifacts/runtime/scenario/demo-rehearsal/config/site.env',
      registry_env: 'artifacts/runtime/scenario/demo-rehearsal/config/registry.env',
      current_release: 'artifacts/runtime/scenario/demo-rehearsal/current',
      reports: 'artifacts/runtime/scenario/demo-rehearsal/reports',
    },
    notes: [
      'read-only diagnostics only',
      'release-fidelity and offline-package still run the full reset/stage sequence',
    ],
  });
}

describe('current rehearsal world health schema', () => {
  it('builds and validates a read-only world health snapshot without evidence or release truth fields', () => {
    const snapshot = validSnapshot();

    expect(snapshot).toMatchObject({
      schema: CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA,
      version: CURRENT_REHEARSAL_WORLD_HEALTH_VERSION,
      projection_kind: 'read_only_rehearsal_world_health_snapshot',
      runtime_line: 'demo-rehearsal',
      rehearsal_mode: 'release-fidelity',
      health_status: 'degraded',
      safe_reset_level: 'world',
      safe_next_command: 'make demo-rehearsal-reset && npm run rehearse:demo',
      diagnostic_only: true,
      mutates_world: false,
      writes_canonical_result: false,
      participates_in_evidence_completeness: false,
    });
    expect(snapshot.world_identity.ports).toMatchObject({
      web: 33001,
      api: 40000,
      registry: 5003,
    });
    expect(validateCurrentRehearsalWorldHealthSnapshot(snapshot)).toEqual({
      ok: true,
      value: snapshot,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/verdict|failure_class|claim_id|release_decision|reusable/);
  });

  it.each(CURRENT_REHEARSAL_WORLD_HEALTH_FORBIDDEN_FIELDS)(
    'rejects forbidden field %s anywhere in the snapshot',
    (field) => {
      const snapshot = validSnapshot();

      expect(validateCurrentRehearsalWorldHealthSnapshot({ ...snapshot, [field]: 'forbidden' }).ok).toBe(false);
      expect(
        validateCurrentRehearsalWorldHealthSnapshot({
          ...snapshot,
          world_identity: {
            ...snapshot.world_identity,
            [field]: 'forbidden',
          },
        }).ok,
      ).toBe(false);
    },
  );

  it('rejects raw secret field names and raw secret-looking values', () => {
    const snapshot = validSnapshot();

    expect(
      validateCurrentRehearsalWorldHealthSnapshot({
        ...snapshot,
        world_identity: {
          ...snapshot.world_identity,
          api_key: 'sk-world-health-raw-secret-value',
        },
      }).ok,
    ).toBe(false);
    expect(
      validateCurrentRehearsalWorldHealthSnapshot({
        ...snapshot,
        authority_paths: {
          ...snapshot.authority_paths,
          site_env: '/tmp/site.env?access_token=world-health-query-token',
        },
      }).ok,
    ).toBe(false);
    expect(
      validateCurrentRehearsalWorldHealthSnapshot({
        ...snapshot,
        notes: [
          'managed_credentials: {"feishu":"world-health-managed-credential-raw-value"}',
        ],
      }).ok,
    ).toBe(false);
  });

  it('keeps snapshot semantics independent from real skip or reuse decisions', () => {
    const snapshot = validSnapshot();

    expect(snapshot.safe_reset_level).toBe('world');
    expect(snapshot.safe_next_command).not.toContain('SKIP_');
    expect(snapshot.safe_next_command).not.toContain('reuse');
    expect(snapshot.notes.join('\n')).toContain('full reset/stage sequence');
    expect(JSON.stringify(snapshot)).not.toMatch(/skip_invalidation|cache_hit|claim_reuse|reusable/);
  });
});
