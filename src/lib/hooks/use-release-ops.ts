import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient, ReleaseOpsAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useReleaseReportList(
  params?: { workspaceId?: string; projectId?: string },
  options?: { enabled?: boolean },
) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.list(params?.workspaceId ?? '', params?.projectId ?? ''),
    queryFn: () => api.listReports(params),
    enabled: options?.enabled ?? true,
    staleTime: 10000,
  });
}

export function useReleaseReportDetail(
  name?: string,
  params?: { workspaceId?: string; projectId?: string },
  options?: { enabled?: boolean },
) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.detail(name ?? '', params?.workspaceId ?? '', params?.projectId ?? ''),
    queryFn: () => api.getReport(name ?? '', params),
    enabled: (options?.enabled ?? true) && !!name,
    staleTime: 10000,
  });
}

export function useReleaseGateRunList(
  params?: { workspaceId?: string; projectId?: string },
  options?: { enabled?: boolean },
) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.runs(params?.workspaceId ?? '', params?.projectId ?? ''),
    queryFn: () => api.listRuns(params),
    enabled: options?.enabled ?? true,
    staleTime: 10000,
  });
}

export function useReleaseGateRunDetail(
  id?: string,
  params?: { workspaceId?: string; projectId?: string },
  options?: { enabled?: boolean },
) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.runDetail(id ?? '', params?.workspaceId ?? '', params?.projectId ?? ''),
    queryFn: () => api.getRun(id ?? '', params),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 10000,
  });
}

export function useReleaseGateRunnerStatus(options?: { enabled?: boolean; refetchInterval?: number }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.runner(),
    queryFn: () => api.getGateRunnerStatus(),
    enabled: options?.enabled ?? true,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useTriggerReleaseGateRun() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { mode: 'full' | 'failed_only'; source_run_id?: string; notes?: string }) =>
      api.triggerGateRun(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.runner() });
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.runs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.list() });
    },
  });
}

export function useReleaseEscalationList(options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.escalations(),
    queryFn: () => api.listEscalations(),
    enabled: options?.enabled ?? true,
    staleTime: 10000,
  });
}

export function useReleaseEscalationDetail(id?: string, options?: { enabled?: boolean }) {
  const api = new ReleaseOpsAPI(getApiClient());
  return useQuery({
    queryKey: queryKeys.releaseOps.escalationDetail(id ?? ''),
    queryFn: () => api.getEscalation(id ?? ''),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 10000,
  });
}

export function useAcknowledgeReleaseEscalation() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { escalationId: string }) => api.acknowledgeEscalation(payload.escalationId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalations() });
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalationDetail(result.id) });
    },
  });
}

export function useResolveReleaseEscalation() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      escalationId: string;
      status: 'open' | 'resolved';
      reason?: string;
      category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    }) =>
      api.resolveEscalation(payload.escalationId, {
        status: payload.status,
        reason: payload.reason,
        category: payload.category,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalations() });
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalationDetail(result.id) });
    },
  });
}

export function useAssignReleaseEscalation() {
  const api = new ReleaseOpsAPI(getApiClient());
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      escalationId: string;
      assignee_user_id: string;
      assignee_name?: string;
      due_at?: string;
    }) =>
      api.assignEscalation(payload.escalationId, {
        assignee_user_id: payload.assignee_user_id,
        assignee_name: payload.assignee_name,
        due_at: payload.due_at,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalations() });
      queryClient.invalidateQueries({ queryKey: queryKeys.releaseOps.escalationDetail(result.id) });
    },
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
      reason_category: 'upstream_transient' | 'known_acceptable_risk' | 'rollout_exception' | 'governance_window';
      reason: string;
      expires_at: string;
    }) => api.createOverride(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.overrides(payload.workspace_id, payload.project_id, payload.report_name),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.list(payload.workspace_id, payload.project_id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.detail(payload.report_name, payload.workspace_id, payload.project_id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.runs(payload.workspace_id, payload.project_id),
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.list(payload.workspaceId, payload.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.detail(payload.reportName, payload.workspaceId, payload.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.releaseOps.runs(payload.workspaceId, payload.projectId),
      });
    },
  });
}
