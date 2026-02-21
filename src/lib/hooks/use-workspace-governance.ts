'use client';

import { useCallback } from 'react';
import { useWorkspaceMembers, useUpdateWorkspaceMemberGovernanceGroup } from '@/lib/hooks/use-workspaces';

type GovernanceGroup = 'wheel' | 'user';
export function useWorkspaceGovernance(workspaceId: string) {
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const updateGovernanceMutation = useUpdateWorkspaceMemberGovernanceGroup(workspaceId);

  const getMemberGovernanceGroup = useCallback(
    (
      member: {
        id: string;
        role: 'owner' | 'admin' | 'developer' | 'user';
        governance_group?: GovernanceGroup;
        permissions?: string[];
      }
    ) => {
      // Use API governance_group when present; fallback inferred from permissions until backend returns it (see workspace-governance-backend-contract.md).
      if (member.governance_group) return member.governance_group;
      const permissions = new Set(member.permissions ?? []);
      return permissions.has('workspace:governance:update') ? 'wheel' : 'user';
    },
    []
  );

  const updateMemberGovernanceGroup = useCallback(
    async (memberId: string, group: GovernanceGroup) => {
      if (!workspaceId) return;
      await updateGovernanceMutation.mutateAsync({ memberId, governanceGroup: group });
    },
    [workspaceId, updateGovernanceMutation]
  );

  return {
    members,
    getMemberGovernanceGroup,
    updateMemberGovernanceGroup,
    isUpdating: updateGovernanceMutation.isPending,
  };
}
