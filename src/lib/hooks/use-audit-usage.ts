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

export function useUsageFacts(
  workspaceId: string,
  projectId: string,
  params: Omit<UsageListParams, 'group_by' | 'sort_by'>,
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
    queryKey: queryKeys.usage.facts(workspaceId, projectId, params),
    queryFn: () => usageAPI.listFacts(workspaceId, projectId, params),
    enabled,
    staleTime: 10000,
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
    resource_type?: 'endpoint' | 'file_library' | 'agent';
    resource_id?: string;
    end_user_id?: string;
  },
  options?: { enabled?: boolean; refetchInterval?: number | false },
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
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Hook to query limits summary data
 */
export function useLimitsSummary(
  workspaceId: string,
  projectId: string,
  params?: { end_user_id?: string },
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  const usageAPI = new UsageAPI(getApiClient());
  const enabled = (options?.enabled ?? true) && !!workspaceId && !!projectId;

  return useQuery({
    queryKey: queryKeys.usage.limitsSummary(workspaceId, projectId, params),
    queryFn: () => usageAPI.getLimitsSummary(workspaceId, projectId, params),
    enabled,
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useUsageOperationsSummary(
  workspaceId: string,
  projectId: string,
  params: {
    start_time: string;
    end_time: string;
    resource_type?: string;
    resource_id?: string;
    end_user_id?: string;
    provider?: string;
    model?: string;
    result?: 'ok' | 'error';
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
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
    queryKey: queryKeys.usage.operationsSummary(workspaceId, projectId, params),
    queryFn: () => usageAPI.getOperationsSummary(workspaceId, projectId, params),
    enabled,
    staleTime: 10000,
  });
}
