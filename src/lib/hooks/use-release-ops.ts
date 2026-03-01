import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useReleaseGateRunList(options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.runs(),
    queryFn: () => api.listRuns(),
    enabled: options?.enabled ?? true,
    staleTime: 10000,
  });
}

export function useReleaseGateRunDetail(id?: string, options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.runDetail(id ?? ''),
    queryFn: () => api.getRun(id ?? ''),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 10000,
  });
}

export function useReleasePolicyOverrides(
  workspaceId: string,
  projectId: string,
  reportName?: string,
  options?: { enabled?: boolean },
) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.overrides(workspaceId, projectId, reportName ?? ''),
    queryFn: () => api.listOverrides({ workspaceId, projectId, reportName: reportName ?? '' }),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!reportName,
    staleTime: 10000,
  });
}

export function useCreateReleasePolicyOverride() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      project_id: string;
      report_name: string;
      issue_id: string;
      issue_source: 'execution' | 'runtime' | 'usage';
      issue_message: string;
      reason: string;
    }) => api.createOverride(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.overrides(payload.workspace_id, payload.project_id, payload.report_name),
      });
    },
  });
}

export function useDecideReleasePolicyOverride() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      overrideId: string;
      workspaceId: string;
      projectId: string;
      reportName: string;
      status: 'approved' | 'rejected';
    }) => api.decideOverride(payload.overrideId, { status: payload.status }),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.overrides(payload.workspaceId, payload.projectId, payload.reportName),
      });
    },
  });
}
