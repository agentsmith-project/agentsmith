'use client';

import { useCallback } from 'react';
import { useWorkspaceMembers, useUpdateWorkspaceMemberGovernanceGroup } from '@/lib/hooks/use-workspaces';
import { getWorkspaceAccessGroupLabel } from '@/lib/governance/member-groups';

type GovernanceGroup = 'wheel' | 'user';
export function useWorkspaceGovernance(workspaceId: string) {
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const updateGovernanceMutation = useUpdateWorkspaceMemberGovernanceGroup(workspaceId);

  const getMemberGovernanceGroup = useCallback(
    (
      member: {
        id: string;
        groups?: Array<{ id: string; name?: string; permission_template_id?: string; system_key?: string }>;
        permissions?: string[];
      }
    ) => {
      const accessGroup = getWorkspaceAccessGroupLabel({
        groups: member.groups?.map((group) => ({
          id: group.id,
          name: group.name ?? group.id,
          permission_template_id: group.permission_template_id ?? '',
          system_key: group.system_key,
        })),
        permissions: member.permissions,
      });
      return accessGroup === 'owner' ? 'wheel' : 'user';
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
