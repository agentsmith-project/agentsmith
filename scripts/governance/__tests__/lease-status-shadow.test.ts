import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';
import {
  buildMinimalLeaseStatusShadow,
  validateMinimalLeaseStatusShadow,
} from '../lease-status-shadow';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const SECRET_VALUE = 'sk-live-do-not-print';

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function lease(overrides: Partial<GovernanceRuntimeLockLease>): GovernanceRuntimeLockLease {
  return {
    leaseId: overrides.leaseId ?? 'lease-000001',
    lockId: overrides.lockId ?? 'release-campaign-root-writes',
    scopeKind: overrides.scopeKind ?? 'campaign_root',
    scopeKey: overrides.scopeKey ?? '/tmp/release-run',
    ownerGroup: overrides.ownerGroup ?? 'release-full|run-001|/tmp/release-run',
    ownerAttemptId: overrides.ownerAttemptId ?? 'attempt-001',
    ownerStepId: overrides.ownerStepId ?? 'gate-default',
    mode: overrides.mode ?? 'exclusive',
    campaignId: overrides.campaignId ?? 'release-full',
    runId: overrides.runId ?? 'run-001',
    campaignRoot: overrides.campaignRoot ?? '/tmp/release-run',
    acquiredAt: overrides.acquiredAt ?? GENERATED_AT,
  };
}

describe('minimal lease/status shadow', () => {
  it('summarizes active run, destructive command, port family, and secret profile locks without acquiring leases', () => {
    const shadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({}),
        lease({
          leaseId: 'lease-destructive',
          lockId: 'destructive-lifecycle',
          scopeKind: 'local_host',
          scopeKey: 'localhost',
          ownerStepId: 'local-real-reset',
          campaignId: null,
          runId: 'local-real-run',
          campaignRoot: null,
        }),
        lease({
          leaseId: 'lease-ports',
          lockId: 'fixed-local-ports',
          scopeKind: 'local_host',
          scopeKey: 'local-real:ports',
          ownerStepId: 'local-real-up',
          campaignId: null,
          runId: 'local-real-run',
          campaignRoot: null,
        }),
        lease({
          leaseId: 'lease-secret',
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: 'backend-real-managed-secret',
          ownerStepId: 'lane-backend-real-release',
        }),
      ],
      requiredSecretNames: ['BACKEND_REAL_API_KEY', 'MISSING_SECRET'],
      env: {
        BACKEND_REAL_API_KEY: SECRET_VALUE,
      },
      generatedAt: GENERATED_AT,
    });

    expect(shadow).toMatchObject({
      schema: 'agentsmith_lease_status_shadow/v1',
      version: 1,
      projection_kind: 'read_only_shadow',
      leases_acquired: false,
      leases_released: false,
      active_run: {
        run_id: 'run-001',
        campaign_id: 'release-full',
        campaign_root: '/tmp/release-run',
      },
      destructive_command_lock: {
        present: true,
        lock_id: 'destructive-lifecycle',
      },
      port_family: {
        present: true,
      },
      secret_profile_lock: {
        present: true,
        lock_id: 'provider-secret-profile',
      },
    });
    expect(shadow.port_family.owners.map((owner) => owner.lock_id)).toContain('fixed-local-ports');
    expect(shadow.secret_profile_lock.profiles).toEqual([
      {
        name: 'BACKEND_REAL_API_KEY',
        present: true,
        digest: digest(SECRET_VALUE),
      },
      {
        name: 'MISSING_SECRET',
        present: false,
        digest: null,
      },
    ]);
    expect(JSON.stringify(shadow)).not.toContain(SECRET_VALUE);
    expect(validateMinimalLeaseStatusShadow(shadow)).toEqual({ ok: true, value: shadow });
  });

  it('is read-only by API shape and implementation: it consumes active lease snapshots, never acquire/release managers', () => {
    const source = readFileSync('scripts/governance/lease-status-shadow.ts', 'utf8');
    expect(source).not.toMatch(/\.acquire\s*\(/);
    expect(source).not.toMatch(/\.release(?:Many)?\s*\(/);
    expect(source).not.toContain('new GovernanceLockLeaseManager');

    const shadow = buildMinimalLeaseStatusShadow({
      activeLeases: [],
      requiredSecretNames: [],
      generatedAt: GENERATED_AT,
    });

    expect(shadow.active_leases).toEqual([]);
    expect(shadow.active_run).toBe(null);
    expect(shadow.leases_acquired).toBe(false);
    expect(shadow.leases_released).toBe(false);
    expect(validateMinimalLeaseStatusShadow(shadow)).toEqual({ ok: true, value: shadow });
  });

  it('rejects secret-looking shadow pollution and raw secret fields', () => {
    const shadow = buildMinimalLeaseStatusShadow({
      activeLeases: [],
      requiredSecretNames: ['BACKEND_REAL_API_KEY'],
      env: {
        BACKEND_REAL_API_KEY: SECRET_VALUE,
      },
      generatedAt: GENERATED_AT,
    });

    expect(validateMinimalLeaseStatusShadow({
      ...shadow,
      secret_profile_lock: {
        ...shadow.secret_profile_lock,
        profiles: [
          {
            name: 'BACKEND_REAL_API_KEY',
            present: true,
            digest: digest(SECRET_VALUE),
            value: SECRET_VALUE,
          },
        ],
      },
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'shadow.secret_profile_lock.profiles[0].value' }),
      ]),
    });

    expect(JSON.stringify(shadow)).not.toContain(SECRET_VALUE);
  });
});
