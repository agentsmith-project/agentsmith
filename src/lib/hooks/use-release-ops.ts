import { useQuery } from '@tanstack/react-query';
import { getApiClient, ReleaseOpsAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useReleaseReportList(options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.list(),
    queryFn: () => api.listReports(),
    enabled: options?.enabled ?? true,
    staleTime: 10000,
  });
}

export function useReleaseReportDetail(name?: string, options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.detail(name ?? ''),
    queryFn: () => api.getReport(name ?? ''),
    enabled: (options?.enabled ?? true) && !!name,
    staleTime: 10000,
  });
}
