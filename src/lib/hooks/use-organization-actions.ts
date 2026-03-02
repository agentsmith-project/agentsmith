'use client';

import { useEffect, useMemo } from 'react';
import { selectCurrentUser, useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api/client';
import { OrganizationActionsAPI } from '@/lib/api/endpoints/organization-actions';
import type { OrganizationGovernanceActionItem } from '@/lib/organization-governance-rollup';
import {
  type OrganizationActionStatus,
  useOrganizationActionsStore,
} from '@/lib/stores/organization-actions-store';

export function useOrganizationActions(actionsQueue: OrganizationGovernanceActionItem[]) {
  const user = useAuthStore(selectCurrentUser);
  const records = useOrganizationActionsStore((state) => state.records);
  const hydrateQueue = useOrganizationActionsStore((state) => state.hydrateQueue);
  const hydrateFromServer = useOrganizationActionsStore((state) => state.hydrateFromServer);
  const setActionStatus = useOrganizationActionsStore((state) => state.setActionStatus);

  const actionIds = useMemo(() => actionsQueue.map((action) => action.id), [actionsQueue]);

  useEffect(() => {
    hydrateQueue(actionIds);
  }, [actionIds, hydrateQueue]);

  useEffect(() => {
    if (actionIds.length === 0) {
      return;
    }
    let active = true;
    const api = new OrganizationActionsAPI(getApiClient());
    void api.list(actionIds).then((result) => {
      if (!active) {
        return;
      }
      hydrateFromServer(result.items ?? []);
    }).catch(() => {
      // Keep local mirror when backend endpoint is unavailable.
    });
    return () => {
      active = false;
    };
  }, [actionIds, hydrateFromServer]);

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
    const actorId = user?.id ?? 'system';
    const actorName = user?.name ?? user?.email ?? 'System';
    setActionStatus({
      actionId,
      status,
      note,
      actorId,
      actorName,
    });
    const api = new OrganizationActionsAPI(getApiClient());
    void api.updateStatus(actionId, {
      status,
      note,
      actor_user_id: actorId,
      actor_name: actorName,
    }).then((record) => {
      hydrateFromServer([record]);
    }).catch(() => {
      // Preserve optimistic local state for degraded upstream cases.
    });
  };

  return {
    actionsWithState,
    updateActionStatus,
  };
}
