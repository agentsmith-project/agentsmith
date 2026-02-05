import { useQuery } from '@tanstack/react-query';
import { getApiClient, UserdataAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const getUserdataAPI = () => new UserdataAPI(getApiClient());

export function useUserdataSummary(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.userdata.summary(workspaceId, projectId),
    queryFn: () => getUserdataAPI().getSummary(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}

export function useUserdataEndUsers(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.userdata.endUsers(workspaceId, projectId),
    queryFn: () => getUserdataAPI().listEndUsers(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}
