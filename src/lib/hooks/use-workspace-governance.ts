'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';

type GovernanceGroup = 'wheel' | 'user';
type GovernanceMap = Record<string, GovernanceGroup>;

const KEY_PREFIX = 'mbos.workspace.governance';

function storageKey(workspaceId: string, userId: string): string {
  return `${KEY_PREFIX}.${workspaceId}.${userId}`;
}

export function useWorkspaceGovernance(workspaceId: string) {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const [overrides, setOverrides] = useState<GovernanceMap>({});

  useEffect(() => {
    try {
      // Lazy-load auth store to avoid test-time module side effects.
      const { useAuthStore } = require('@/lib/stores/authStore') as typeof import('@/lib/stores/authStore');
      setUserId(useAuthStore.getState().user?.id);
      const unsubscribe = useAuthStore.subscribe((state) => setUserId(state.user?.id));
      return unsubscribe;
    } catch {
      setUserId(undefined);
      return () => undefined;
    }
  }, []);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    try {
      const raw = localStorage.getItem(storageKey(workspaceId, userId));
      setOverrides(raw ? (JSON.parse(raw) as GovernanceMap) : {});
    } catch {
      setOverrides({});
    }
  }, [workspaceId, userId]);

  const getMemberGovernanceGroup = useCallback(
    (
      member: {
        id: string;
        role: 'owner' | 'admin' | 'developer' | 'user';
        governance_group?: GovernanceGroup;
        permissions?: string[];
      }
    ) => {
      const saved = overrides[member.id];
      if (saved) return saved;
      if (member.governance_group) return member.governance_group;
      const permissions = new Set(member.permissions ?? []);
      return permissions.has('workspace:governance:update') ? 'wheel' : 'user';
    },
    [overrides]
  );

  const updateMemberGovernanceGroup = useCallback(
    (memberId: string, group: GovernanceGroup) => {
      if (!workspaceId || !userId) return;
      setOverrides((prev) => {
        const next = { ...prev, [memberId]: group };
        try {
          localStorage.setItem(storageKey(workspaceId, userId), JSON.stringify(next));
        } catch {
          // ignore persistence errors in prototype mode
        }
        return next;
      });
    },
    [workspaceId, userId]
  );

  return {
    members,
    getMemberGovernanceGroup,
    updateMemberGovernanceGroup,
  };
}
