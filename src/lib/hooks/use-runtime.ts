import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient, RuntimeAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { handleErrorForToast } from '@/lib/api/errors';
import type {
  CreateRuntimeModelAliasRequest,
  CreateRuntimeModelCatalogEntryRequest,
  CreateRuntimeModelComboRequest,
  CreateRuntimePricingVersionRequest,
  CreateRuntimeProviderConnectionRequest,
  RuntimeImpactPreviewRequest,
  RuntimeRoutingDryRunRequest,
  RuntimeUnifiedChatRequest,
  RuntimePricingMap,
  UpdateRuntimeModelAliasRequest,
  UpdateRuntimeModelCatalogEntryRequest,
  UpdateRuntimeModelComboRequest,
  UpdateRuntimeProviderConnectionRequest,
} from '@/lib/api';

const getRuntimeAPI = () => new RuntimeAPI(getApiClient());

export function useRuntimeProviders(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.runtime.providers(workspaceId, projectId),
    queryFn: () => getRuntimeAPI().listProviders(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateRuntimeProvider(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRuntimeProviderConnectionRequest) =>
      getRuntimeAPI().createProvider(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.providers(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useCreateRuntimeProvider'),
  });
}

export function useUpdateRuntimeProvider(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerConnectionId,
      payload,
    }: {
      providerConnectionId: string;
      payload: UpdateRuntimeProviderConnectionRequest;
    }) => getRuntimeAPI().updateProvider(workspaceId, projectId, providerConnectionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.providers(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateRuntimeProvider'),
  });
}

export function useDeleteRuntimeProvider(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerConnectionId: string) =>
      getRuntimeAPI().deleteProvider(workspaceId, projectId, providerConnectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.providers(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteRuntimeProvider'),
  });
}

export function useRuntimeModels(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.runtime.models(workspaceId, projectId),
    queryFn: () => getRuntimeAPI().listModels(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateRuntimeModel(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRuntimeModelCatalogEntryRequest) =>
      getRuntimeAPI().createModel(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.models(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useCreateRuntimeModel'),
  });
}

export function useUpdateRuntimeModel(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      modelId,
      payload,
    }: {
      provider: string;
      modelId: string;
      payload: UpdateRuntimeModelCatalogEntryRequest;
    }) => getRuntimeAPI().updateModel(workspaceId, projectId, provider, modelId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.models(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateRuntimeModel'),
  });
}

export function useDeleteRuntimeModel(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, modelId }: { provider: string; modelId: string }) =>
      getRuntimeAPI().deleteModel(workspaceId, projectId, provider, modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.models(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteRuntimeModel'),
  });
}

export function useRuntimeAliases(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.runtime.aliases(workspaceId, projectId),
    queryFn: () => getRuntimeAPI().listAliases(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateRuntimeAlias(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRuntimeModelAliasRequest) =>
      getRuntimeAPI().createAlias(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.aliases(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useCreateRuntimeAlias'),
  });
}

export function useUpdateRuntimeAlias(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      alias,
      payload,
    }: {
      alias: string;
      payload: UpdateRuntimeModelAliasRequest;
    }) => getRuntimeAPI().updateAlias(workspaceId, projectId, alias, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.aliases(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateRuntimeAlias'),
  });
}

export function useDeleteRuntimeAlias(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alias: string) =>
      getRuntimeAPI().deleteAlias(workspaceId, projectId, alias),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.aliases(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteRuntimeAlias'),
  });
}

export function useRuntimeCombos(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.runtime.combos(workspaceId, projectId),
    queryFn: () => getRuntimeAPI().listCombos(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateRuntimeCombo(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRuntimeModelComboRequest) =>
      getRuntimeAPI().createCombo(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.combos(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useCreateRuntimeCombo'),
  });
}

export function useUpdateRuntimeCombo(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      combo,
      payload,
    }: {
      combo: string;
      payload: UpdateRuntimeModelComboRequest;
    }) => getRuntimeAPI().updateCombo(workspaceId, projectId, combo, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.combos(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateRuntimeCombo'),
  });
}

export function useDeleteRuntimeCombo(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (combo: string) =>
      getRuntimeAPI().deleteCombo(workspaceId, projectId, combo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.combos(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteRuntimeCombo'),
  });
}

export function useRuntimePricing(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.runtime.pricing(workspaceId, projectId),
    queryFn: () => getRuntimeAPI().getPricing(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function usePatchRuntimePricing(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RuntimePricingMap) =>
      getRuntimeAPI().patchPricing(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.pricing(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'usePatchRuntimePricing'),
  });
}

export function useRuntimePricingVersions(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: [...queryKeys.runtime.pricing(workspaceId, projectId), 'versions'],
    queryFn: () => getRuntimeAPI().listPricingVersions(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateRuntimePricingVersion(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRuntimePricingVersionRequest) =>
      getRuntimeAPI().createPricingVersion(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.pricing(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.runtime.pricing(workspaceId, projectId), 'versions'] });
    },
    onError: (error) => handleErrorForToast(error, 'useCreateRuntimePricingVersion'),
  });
}

export function useActivateRuntimePricingVersion(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      getRuntimeAPI().activatePricingVersion(workspaceId, projectId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runtime.pricing(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.runtime.pricing(workspaceId, projectId), 'versions'] });
    },
    onError: (error) => handleErrorForToast(error, 'useActivateRuntimePricingVersion'),
  });
}

export function useCompareRuntimePricingVersions(workspaceId: string, projectId: string) {
  return useMutation({
    mutationFn: (payload: { baseline_version_id: string; candidate_version_id: string }) =>
      getRuntimeAPI().comparePricingVersions(workspaceId, projectId, payload),
    onError: (error) => handleErrorForToast(error, 'useCompareRuntimePricingVersions'),
  });
}

export function useRuntimeUnifiedChatProbe(workspaceId: string, projectId: string) {
  return useMutation({
    mutationFn: (payload: RuntimeUnifiedChatRequest) =>
      getRuntimeAPI().probeUnifiedChat(workspaceId, projectId, payload),
    onError: (error) => handleErrorForToast(error, 'useRuntimeUnifiedChatProbe'),
  });
}

export function useRuntimeRoutingDryRun(workspaceId: string, projectId: string) {
  return useMutation({
    mutationFn: (payload: RuntimeRoutingDryRunRequest) =>
      getRuntimeAPI().dryRunRouting(workspaceId, projectId, payload),
    onError: (error) => handleErrorForToast(error, 'useRuntimeRoutingDryRun'),
  });
}

export function useRuntimeImpactPreview(workspaceId: string, projectId: string) {
  return useMutation({
    mutationFn: (payload: RuntimeImpactPreviewRequest) =>
      getRuntimeAPI().previewImpact(workspaceId, projectId, payload),
    onError: (error) => handleErrorForToast(error, 'useRuntimeImpactPreview'),
  });
}
