'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';

type GovernanceGroup = 'wheel' | 'user';
type GovernanceMap = Record<string, GovernanceGroup>;

const KEY_PREFIX = 'mbos.workspace.governance';

function storageKey(workspaceId: string): string {
  return `${KEY_PREFIX}.${workspaceId}`;
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
    if (!workspaceId) return;
    try {
      const raw = localStorage.getItem(storageKey(workspaceId));
      setOverrides(raw ? (JSON.parse(raw) as GovernanceMap) : {});
    } catch {
      setOverrides({});
    }
  }, [workspaceId]);

  const getMemberGovernanceGroup = useCallback(
    (member: { id: string; role: 'owner' | 'admin' | 'developer' | 'user'; governance_group?: GovernanceGroup }) => {
      const saved = overrides[member.id];
      if (saved) return saved;
      if (member.governance_group) return member.governance_group;
      return member.role === 'owner' || member.role === 'admin' ? 'wheel' : 'user';
    },
    [overrides]
  );

  const updateMemberGovernanceGroup = useCallback(
    (memberId: string, group: GovernanceGroup) => {
      if (!workspaceId) return;
      setOverrides((prev) => {
        const next = { ...prev, [memberId]: group };
        try {
          localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
        } catch {
          // ignore persistence errors in prototype mode
        }
        return next;
      });
    },
    [workspaceId]
  );

  const currentMember = useMemo(
    () => members.find((member) => member.user_id === userId),
    [members, userId]
  );

  const isWorkspaceAdmin = currentMember?.role === 'owner' || currentMember?.role === 'admin';
  const isWheelUser = currentMember ? getMemberGovernanceGroup(currentMember) === 'wheel' : false;

  return {
    members,
    currentMember,
    isWorkspaceAdmin,
    isWheelUser,
    canManageGovernance: isWorkspaceAdmin,
    canViewCredentials: isWheelUser,
    getMemberGovernanceGroup,
    updateMemberGovernanceGroup,
  };
}
