import { describe, expect, it } from 'vitest';
import { authorityAllowsDestructiveCleanup, buildJanitorDecision } from '@mbos/domain';
import {
  buildGatewayOwnerEvidence,
  buildGatewayOwnerScope,
  classifyGatewayManagedProcessAuthority,
  classifyPersistedGatewayJanitorAuthority,
  type GatewayOwnerEvidence,
  type GatewayPidAuthorityStatus,
} from './file-library-gateway-ownership.js';

function buildOwnerEvidence(overrides: Partial<GatewayOwnerEvidence> = {}): GatewayOwnerEvidence {
  return {
    localInstanceId: 'instance-a',
    scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>(),
    ...overrides,
  };
}

describe('file-library gateway ownership', () => {
  it('classifies the current boot as current_active', () => {
    const currentOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-current');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: currentOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope,
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[currentOwnerScope, 'active']]),
      }),
      pidAuthorityStatus: 'confirmed',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'current_active',
      reason: 'current_owner_scope',
    });
  });

  it('classifies an active foreign boot as foreign_active', () => {
    const foreignOwnerScope = buildGatewayOwnerScope('instance-b', 'boot-foreign');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: foreignOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence(),
      pidAuthorityStatus: 'confirmed',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'foreign_active',
      reason: 'foreign_owner_scope',
    });
  });

  it('classifies a stale boot with confirmed pid authority as stale_reclaimable', () => {
    const staleOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-old');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: staleOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[staleOwnerScope, 'stale']]),
      }),
      pidAuthorityStatus: 'confirmed',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'stale_reclaimable',
      reason: 'owner_boot_stale',
    });
  });

  it('classifies confirmed ownerless state as ownerless_adoptable', () => {
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: null,
      ownerProcessPid: null,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence(),
      pidAuthorityStatus: 'confirmed',
      processExists: () => false,
    });

    expect(authority).toEqual({
      authority: 'ownerless_adoptable',
      reason: 'owner_pid_missing',
    });
  });

  it('classifies a same-instance unknown boot as unverified', () => {
    const unknownOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-unknown');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: unknownOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[buildGatewayOwnerScope('instance-a', 'boot-current'), 'active']]),
      }),
      pidAuthorityStatus: 'confirmed',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'unverified',
      reason: 'owner_scope_unverified',
    });
  });

  it('classifies pid authority drift as unverified even when the boot is otherwise stale', () => {
    const staleOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-old');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: staleOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[staleOwnerScope, 'stale']]),
      }),
      pidAuthorityStatus: 'unverified',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'unverified',
      reason: 'pid_authority_unverified',
    });
  });

  it('classifies an explicitly released boot as released', () => {
    const releasedOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-released');
    const authority = classifyPersistedGatewayJanitorAuthority({
      ownerScope: releasedOwnerScope,
      ownerProcessPid: 4100,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[releasedOwnerScope, 'released']]),
      }),
      pidAuthorityStatus: 'confirmed',
      processExists: (pid) => pid === 4100,
    });

    expect(authority).toEqual({
      authority: 'released',
      reason: 'owner_boot_released',
    });
  });

  it('classifies a managed process from a stale boot as stale_reclaimable', () => {
    const staleOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-old');
    const authority = classifyGatewayManagedProcessAuthority({
      ownerScope: staleOwnerScope,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[staleOwnerScope, 'stale']]),
      }),
    });

    expect(authority).toEqual({
      authority: 'stale_reclaimable',
      reason: 'owner_boot_stale',
    });
  });

  it('classifies a managed process from a released boot as released', () => {
    const releasedOwnerScope = buildGatewayOwnerScope('instance-a', 'boot-released');
    const authority = classifyGatewayManagedProcessAuthority({
      ownerScope: releasedOwnerScope,
      currentOwnerScope: buildGatewayOwnerScope('instance-a', 'boot-current'),
      ownerEvidence: buildOwnerEvidence({
        scopeStatusByScope: new Map([[releasedOwnerScope, 'released']]),
      }),
    });

    expect(authority).toEqual({
      authority: 'released',
      reason: 'owner_boot_released',
    });
  });

  it('keeps current ownership conservative by default while allowing released cleanup', () => {
    expect(authorityAllowsDestructiveCleanup('foreign_active')).toBe(false);
    expect(authorityAllowsDestructiveCleanup('unverified')).toBe(false);

    expect(buildJanitorDecision({
      authority: 'current_active',
      reason: 'current_owner_scope',
    })).toEqual({
      authority: 'current_active',
      reason: 'current_owner_scope',
      action: 'keep',
    });

    expect(buildJanitorDecision({
      authority: 'released',
      reason: 'owner_boot_released',
    })).toEqual({
      authority: 'released',
      reason: 'owner_boot_released',
      action: 'destructive_cleanup',
    });
  });
});
