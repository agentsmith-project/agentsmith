import { useQuery } from '@tanstack/react-query';
import { getApiClient, UserdataAPI } from '@/lib/api';

const getUserdataAPI = () => new UserdataAPI(getApiClient());

export function useUserdataSummary(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['userdata', workspaceId, projectId, 'summary'],
    queryFn: () => getUserdataAPI().getSummary(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}

export function useUserdataEndUsers(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['userdata', workspaceId, projectId, 'end-users'],
    queryFn: () => getUserdataAPI().listEndUsers(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });
}
