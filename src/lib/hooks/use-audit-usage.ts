/**
 * Audit & Usage React Hooks
 *
 * Custom hooks for Audit and Usage API operations using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient, AuditAPI, UsageAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
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
    queryKey: queryKeys.audit.list(workspaceId, projectId, params),
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
    queryKey: queryKeys.usage.kpi(workspaceId, projectId, startTime || '', endTime || '', endUserId),
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
    queryKey: queryKeys.usage.list(workspaceId, projectId, params),
    queryFn: () => usageAPI.list(workspaceId, projectId, params),
    enabled,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query usage/cost timeseries data
 */
export function useUsageTimeseries(
  workspaceId: string,
  projectId: string,
  params: {
    start_time: string;
    end_time: string;
    granularity?: 'hour' | 'day' | 'week' | 'month';
    metric?: 'tokens' | 'requests' | 'cost' | 'bytes';
    resource_type?: 'endpoint' | 'source_library' | 'agent';
  },
  options?: { enabled?: boolean },
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled =
    (options?.enabled ?? true) &&
    !!workspaceId &&
    !!projectId &&
    !!params.start_time &&
    !!params.end_time;

  return useQuery({
    queryKey: queryKeys.usage.timeseries(workspaceId, projectId, params),
    queryFn: () => usageAPI.getTimeseries(workspaceId, projectId, params),
    enabled,
    staleTime: 10000,
  });
}

/**
 * Hook to query quota summary data
 */
export function useQuotaSummary(
  workspaceId: string,
  projectId: string,
  options?: { enabled?: boolean },
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled = (options?.enabled ?? true) && !!workspaceId && !!projectId;

  return useQuery({
    queryKey: queryKeys.usage.quotaSummary(workspaceId, projectId),
    queryFn: () => usageAPI.getQuotaSummary(workspaceId, projectId),
    enabled,
    staleTime: 30000,
  });
}

/**
 * Hook to query runtime observability summary (fallback/error/cost distribution)
 */
export function useRuntimeObservability(
  workspaceId: string,
  projectId: string,
  params: {
    start_time: string;
    end_time: string;
  },
  options?: { enabled?: boolean },
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled =
    (options?.enabled ?? true) &&
    !!workspaceId &&
    !!projectId &&
    !!params.start_time &&
    !!params.end_time;

  return useQuery({
    queryKey: queryKeys.usage.runtimeObservability(workspaceId, projectId, params),
    queryFn: () => usageAPI.getRuntimeObservability(workspaceId, projectId, params),
    enabled,
    staleTime: 10000,
  });
}
