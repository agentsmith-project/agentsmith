import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';
import {
  buildMinimalLeaseStatusShadow,
  resolveMinimalLeaseStatusShadow,
  validateMinimalLeaseStatusShadow,
} from '../lease-status-shadow';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const SECRET_VALUE = 'sk-live-do-not-print';
const SNAPSHOT_OWNER_SECRET = 'sk-lease-owner-secret-1234567';
const SNAPSHOT_TICKET_SECRET = 'ticket=lease-ticket-raw-value';
const SNAPSHOT_API_KEY_SECRET = 'api_key=lease-api-key-raw-value';
const SNAPSHOT_PASSWORD_SECRET = 'password=lease-password-raw-value';
const PREBUILT_SCOPE_KIND_SECRET = 'sk-prebuilt-scope-kind-secret-1234567';
const PREBUILT_MODE_SECRET = 'api_key=prebuilt-mode-api-key-raw-value';

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
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY', 'MISSING_SECRET'],
      env: {
        PRESET_ENDPOINT_API_KEY: SECRET_VALUE,
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
    expect(shadow.secret_profile_lock.profile).toEqual({
      present: true,
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(shadow.secret_profile_lock).not.toHaveProperty('profiles');

    const rotated = buildMinimalLeaseStatusShadow({
      activeLeases: [],
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY', 'MISSING_SECRET'],
      env: {
        PRESET_ENDPOINT_API_KEY: 'sk-live-rotated-do-not-print',
      },
      generatedAt: GENERATED_AT,
    });
    expect(rotated.secret_profile_lock.profile.digest).toBe(shadow.secret_profile_lock.profile.digest);

    const serialized = JSON.stringify(shadow);
    expect(serialized).not.toContain('PRESET_ENDPOINT_API_KEY');
    expect(serialized).not.toContain('MISSING_SECRET');
    expect(serialized).not.toContain(SECRET_VALUE);
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

  it('resolves an existing active lease snapshot from a read-only JSON path', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-lease-shadow-provider-'));
    try {
      const snapshotPath = join(root, 'active-leases.json');
      writeFileSync(snapshotPath, `${JSON.stringify({
        activeLeases: [
          lease({}),
          lease({
            leaseId: 'lease-provider-destructive',
            lockId: 'destructive-lifecycle',
            scopeKind: 'local_host',
            scopeKey: 'localhost',
            ownerStepId: 'local-real-reset',
          }),
          lease({
            leaseId: 'lease-provider-ports',
            lockId: 'fixed-local-ports',
            scopeKind: 'local_host',
            scopeKey: 'local-real:ports',
            ownerStepId: 'local-real-up',
          }),
          lease({
            leaseId: 'lease-provider-secret',
            lockId: 'provider-secret-profile',
            scopeKind: 'provider_profile',
            scopeKey: 'backend-real-managed-secret',
            ownerStepId: 'gate-release',
          }),
        ],
      }, null, 2)}\n`);

      const shadow = resolveMinimalLeaseStatusShadow({
        snapshotPath,
        requiredSecretNames: ['PRESET_ENDPOINT_API_KEY'],
        env: {
          PRESET_ENDPOINT_API_KEY: SECRET_VALUE,
        },
        generatedAt: GENERATED_AT,
      });

      expect(shadow).not.toBe(null);
      expect(shadow?.active_run?.run_id).toBe('run-001');
      expect(shadow?.destructive_command_lock.present).toBe(true);
      expect(shadow?.port_family.present).toBe(true);
      expect(shadow?.secret_profile_lock.present).toBe(true);
      expect(shadow?.secret_profile_lock.profile).toEqual({
        present: true,
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(shadow?.leases_acquired).toBe(false);
      expect(shadow?.leases_released).toBe(false);
      expect(JSON.stringify(shadow)).not.toContain(SECRET_VALUE);
      expect(validateMinimalLeaseStatusShadow(shadow)).toMatchObject({ ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades malformed runtime snapshots to null instead of returning invalid shadows', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-lease-shadow-malformed-'));
    try {
      const snapshotPath = join(root, 'active-leases.json');
      writeFileSync(snapshotPath, `${JSON.stringify({
        activeLeases: [
          lease({ acquiredAt: 'not-an-iso-date' }),
        ],
      }, null, 2)}\n`);

      const shadow = resolveMinimalLeaseStatusShadow({
        snapshotPath,
        generatedAt: GENERATED_AT,
      });

      expect(shadow).toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('redacts snapshot-owned lease strings while keeping the built shadow schema-valid', () => {
    const shadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({
          leaseId: `lease-${SNAPSHOT_OWNER_SECRET}`,
          lockId: 'release-campaign-root-writes',
          scopeKey: `/tmp/${SNAPSHOT_API_KEY_SECRET}`,
          ownerGroup: `release-full|${SNAPSHOT_OWNER_SECRET}|${SNAPSHOT_TICKET_SECRET}`,
          ownerAttemptId: `attempt-${SNAPSHOT_TICKET_SECRET}`,
          ownerStepId: `gate-release-${SNAPSHOT_OWNER_SECRET}`,
          campaignId: `release-${SNAPSHOT_OWNER_SECRET}`,
          runId: `run-${SNAPSHOT_OWNER_SECRET}`,
          campaignRoot: `/tmp/${SNAPSHOT_PASSWORD_SECRET}`,
        }),
        lease({
          leaseId: `lease-secret-${SNAPSHOT_OWNER_SECRET}`,
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: `backend-real-${SNAPSHOT_API_KEY_SECRET}`,
          ownerGroup: `provider|${SNAPSHOT_OWNER_SECRET}`,
          ownerAttemptId: `attempt-secret-${SNAPSHOT_TICKET_SECRET}`,
          ownerStepId: `gate-release-${SNAPSHOT_OWNER_SECRET}`,
        }),
      ],
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY'],
      env: {
        PRESET_ENDPOINT_API_KEY: SECRET_VALUE,
      },
      generatedAt: GENERATED_AT,
    });

    const serialized = JSON.stringify(shadow);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain(SNAPSHOT_OWNER_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_TICKET_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_API_KEY_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_PASSWORD_SECRET);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(validateMinimalLeaseStatusShadow(shadow)).toEqual({ ok: true, value: shadow });
  });

  it('redacts prebuilt shadow owner scope_kind and mode before returning it', () => {
    const prebuilt = buildMinimalLeaseStatusShadow({
      activeLeases: [lease({})],
      requiredSecretNames: [],
      generatedAt: GENERATED_AT,
    });
    const polluted = {
      ...prebuilt,
      active_run: prebuilt.active_run
        ? {
            ...prebuilt.active_run,
            owner_group: `owner-${SNAPSHOT_OWNER_SECRET}`,
            owner_step_id: `step-${SNAPSHOT_TICKET_SECRET}`,
          }
        : null,
      active_leases: prebuilt.active_leases.map((owner) => ({
        ...owner,
        scope_kind: PREBUILT_SCOPE_KIND_SECRET,
        mode: PREBUILT_MODE_SECRET,
        scope_key: `scope-${SNAPSHOT_API_KEY_SECRET}`,
        owner_group: `owner-${SNAPSHOT_OWNER_SECRET}`,
        owner_attempt_id: `attempt-${SNAPSHOT_TICKET_SECRET}`,
        owner_step_id: `step-${SNAPSHOT_OWNER_SECRET}`,
      })),
    };

    const shadow = resolveMinimalLeaseStatusShadow({
      snapshotJson: JSON.stringify(polluted),
      generatedAt: GENERATED_AT,
    });

    expect(shadow).not.toBe(null);
    const serialized = JSON.stringify(shadow);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain(PREBUILT_SCOPE_KIND_SECRET);
    expect(serialized).not.toContain(PREBUILT_MODE_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_OWNER_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_TICKET_SECRET);
    expect(serialized).not.toContain(SNAPSHOT_API_KEY_SECRET);
    expect(shadow?.active_leases[0]?.scope_kind).toContain('[redacted]');
    expect(shadow?.active_leases[0]?.mode).toContain('[redacted]');
    expect(validateMinimalLeaseStatusShadow(shadow)).toMatchObject({ ok: true });
  });

  it('rejects secret-looking shadow pollution and raw secret fields', () => {
    const shadow = buildMinimalLeaseStatusShadow({
      activeLeases: [],
      requiredSecretNames: ['PRESET_ENDPOINT_API_KEY'],
      env: {
        PRESET_ENDPOINT_API_KEY: SECRET_VALUE,
      },
      generatedAt: GENERATED_AT,
    });

    expect(validateMinimalLeaseStatusShadow({
      ...shadow,
      secret_profile_lock: {
        ...shadow.secret_profile_lock,
        profiles: [{ name: 'PRESET_ENDPOINT_API_KEY', value_digest: SECRET_VALUE }],
        profile: {
          ...shadow.secret_profile_lock.profile,
          value: SECRET_VALUE,
        },
      },
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'shadow.secret_profile_lock.profiles' }),
        expect.objectContaining({ path: 'shadow.secret_profile_lock.profile.value' }),
      ]),
    });

    expect(JSON.stringify(shadow)).not.toContain(SECRET_VALUE);
  });
});
