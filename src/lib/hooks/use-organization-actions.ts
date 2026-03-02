'use client';

import { useEffect, useMemo } from 'react';
import { selectCurrentUser, useAuthStore } from '@/lib/stores/authStore';
import type { OrganizationGovernanceActionItem } from '@/lib/organization-governance-rollup';
import {
  type OrganizationActionStatus,
  useOrganizationActionsStore,
} from '@/lib/stores/organization-actions-store';

export function useOrganizationActions(actionsQueue: OrganizationGovernanceActionItem[]) {
  const user = useAuthStore(selectCurrentUser);
  const records = useOrganizationActionsStore((state) => state.records);
  const hydrateQueue = useOrganizationActionsStore((state) => state.hydrateQueue);
  const setActionStatus = useOrganizationActionsStore((state) => state.setActionStatus);

  const actionIds = useMemo(() => actionsQueue.map((action) => action.id), [actionsQueue]);

  useEffect(() => {
    hydrateQueue(actionIds);
  }, [actionIds, hydrateQueue]);

  const actionsWithState = useMemo(
    () =>
      actionsQueue.map((action) => {
        const record = records[action.id];
        return {
          ...action,
          currentStatus: record?.status ?? 'pending',
          updatedAt: record?.updatedAt,
          history: record?.history ?? [],
        };
      }),
    [actionsQueue, records],
  );

  const updateActionStatus = (actionId: string, status: OrganizationActionStatus, note?: string) => {
    setActionStatus({
      actionId,
      status,
      note,
      actorId: user?.id ?? 'system',
      actorName: user?.name ?? user?.email ?? 'System',
    });
  };

  return {
    actionsWithState,
    updateActionStatus,
  };
}
