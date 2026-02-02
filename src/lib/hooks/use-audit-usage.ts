/**
 * Audit & Usage React Hooks
 *
 * Custom hooks for Audit and Usage API operations using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient, AuditAPI, UsageAPI } from '@/lib/api';
import { handleErrorForToast } from '@/lib/api/errors';
import type { AuditListParams, UsageListParams } from '@/lib/api/types';

/**
 * Hook to query audit events
 */
export function useAuditEvents(
  workspaceId: string,
  projectId: string,
  params: AuditListParams,
) {
  const auditAPI = new AuditAPI(getApiClient());

  return useQuery({
    queryKey: ['audit', workspaceId, projectId, params],
    queryFn: () => auditAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId && !!params.start_time && !!params.end_time,
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
) {
  const usageAPI = new UsageAPI(getApiClient());

  return useQuery({
    queryKey: ['usage-kpi', workspaceId, projectId, startTime, endTime],
    queryFn: () => usageAPI.getKPI(workspaceId, projectId, startTime, endTime),
    enabled: !!workspaceId && !!projectId,
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
) {
  const usageAPI = new UsageAPI(getApiClient());

  return useQuery({
    queryKey: ['usage', workspaceId, projectId, params],
    queryFn: () => usageAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId && !!params.start_time && !!params.end_time,
    staleTime: 10000, // 10 seconds
  });
}
