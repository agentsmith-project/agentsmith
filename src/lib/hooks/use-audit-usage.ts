/**
 * Audit & Usage React Hooks
 *
 * Custom hooks for Audit and Usage API operations using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient, AuditAPI, UsageAPI } from '@/lib/api';
import type { AuditListParams, UsageListParams } from '@/lib/api/types';

/**
 * Hook to query audit events
 */
export function useAuditEvents(
  workspaceId: string,
  projectId: string,
  params: AuditListParams,
  options?: { enabled?: boolean }
) {
  const auditAPI = new AuditAPI(getApiClient());
  const enabled =
    (options?.enabled ?? true) &&
    !!workspaceId &&
    !!projectId &&
    !!params.start_time &&
    !!params.end_time;

  return useQuery({
    queryKey: ['audit', workspaceId, projectId, params],
    queryFn: () => auditAPI.list(workspaceId, projectId, params),
    enabled,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query usage KPI summary
 */
export function useUsageKPI(
  workspaceId: string,
  projectId: string,
  startTime?: string,
  endTime?: string,
  endUserId?: string,
  options?: { enabled?: boolean }
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled =
    (options?.enabled ?? true) && !!workspaceId && !!projectId;

  return useQuery({
    queryKey: ['usage-kpi', workspaceId, projectId, startTime, endTime, endUserId],
    queryFn: () =>
      usageAPI.getKPI(workspaceId, projectId, startTime, endTime, endUserId),
    enabled,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to query usage records
 */
export function useUsageRecords(
  workspaceId: string,
  projectId: string,
  params: UsageListParams,
  options?: { enabled?: boolean }
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled =
    (options?.enabled ?? true) &&
    !!workspaceId &&
    !!projectId &&
    !!params.start_time &&
    !!params.end_time;

  return useQuery({
    queryKey: ['usage', workspaceId, projectId, params],
    queryFn: () => usageAPI.list(workspaceId, projectId, params),
    enabled,
    staleTime: 10000, // 10 seconds
  });
}
