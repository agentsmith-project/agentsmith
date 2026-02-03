/**
 * Recipe React Hooks
 *
 * Custom hooks for Recipe API operations using React Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { getApiClient, RecipeAPI } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { handleErrorForToast } from '@/lib/api/errors';
import type {
  Recipe,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  RecipeListParams,
} from '@/lib/types/recipe';
import { toast } from '@/components/ui/toast';

/**
 * Hook to query recipes list
 */
export function useRecipes(
  workspaceId: string,
  projectId: string,
  params?: RecipeListParams,
) {
  const recipeAPI = new RecipeAPI(getApiClient());

  return useQuery({
    queryKey: ['recipes', workspaceId, projectId, params],
    queryFn: () => recipeAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query a single recipe
 */
export function useRecipe(
  workspaceId: string,
  projectId: string,
  recipeId: string,
): UseQueryResult<Recipe> {
  const recipeAPI = new RecipeAPI(getApiClient());

  return useQuery<Recipe>({
    queryKey: ['recipe', workspaceId, projectId, recipeId],
    queryFn: async () => {
      try {
        return await recipeAPI.get(workspaceId, projectId, recipeId);
      } catch (error) {
        // Extract detailed error information
        let errorInfo: Record<string, unknown> = {
          workspaceId,
          projectId,
          recipeId,
        };

        if (error instanceof ApiError) {
          errorInfo = {
            ...errorInfo,
            errorCode: error.errorCode,
            message: error.message,
            requestId: error.requestId,
            name: error.name,
          };
        } else if (error instanceof Error) {
          errorInfo = {
            ...errorInfo,
            message: error.message,
            name: error.name,
            stack: error.stack,
          };
        } else {
          errorInfo = {
            ...errorInfo,
            error: String(error),
            errorType: typeof error,
            rawError: error,
          };
        }

        console.error('[useRecipe] Error fetching recipe:', errorInfo);
        throw error;
      }
    },
    enabled: !!workspaceId && !!projectId && !!recipeId,
    retry: false, // Don't retry on 404
  });
}

/**
 * Hook to create a recipe
 */
export function useCreateRecipe() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      data: CreateRecipeRequest;
    }) => recipeAPI.create(workspaceId, projectId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipes', variables.workspaceId, variables.projectId],
      });
      toast.success('Recipe created successfully');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateRecipe');
    },
  });
}

/**
 * Hook to update a recipe
 */
export function useUpdateRecipe() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
      data: UpdateRecipeRequest;
    }) => recipeAPI.update(workspaceId, projectId, recipeId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipe', variables.workspaceId, variables.projectId, variables.recipeId],
      });
      queryClient.invalidateQueries({
        queryKey: ['recipes', variables.workspaceId, variables.projectId],
      });
      toast.success('Recipe updated successfully');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUpdateRecipe');
    },
  });
}

/**
 * Hook to delete a recipe
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
    }) => recipeAPI.delete(workspaceId, projectId, recipeId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipes', variables.workspaceId, variables.projectId],
      });
      toast.success('Recipe deleted successfully');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteRecipe');
    },
  });
}

/**
 * Hook to query messages in a recipe
 */
export function useRecipeMessages(
  workspaceId: string,
  projectId: string,
  recipeId: string,
) {
  const recipeAPI = new RecipeAPI(getApiClient());

  return useQuery({
    queryKey: ['recipe-messages', workspaceId, projectId, recipeId],
    queryFn: () => recipeAPI.listMessages(workspaceId, projectId, recipeId),
    enabled: !!workspaceId && !!projectId && !!recipeId,
    staleTime: 5000, // 5 seconds
  });
}

/**
 * Hook to send a message
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
      data: SendMessageRequest;
    }) => recipeAPI.sendMessage(workspaceId, projectId, recipeId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipe-messages', variables.workspaceId, variables.projectId, variables.recipeId],
      });
      queryClient.invalidateQueries({
        queryKey: ['recipe', variables.workspaceId, variables.projectId, variables.recipeId],
      });
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useSendMessage');
    },
  });
}

/**
 * Hook to query artifacts in a recipe
 */
export function useRecipeArtifacts(
  workspaceId: string,
  projectId: string,
  recipeId: string,
) {
  const recipeAPI = new RecipeAPI(getApiClient());

  return useQuery({
    queryKey: ['recipe-artifacts', workspaceId, projectId, recipeId],
    queryFn: () => recipeAPI.listArtifacts(workspaceId, projectId, recipeId),
    enabled: !!workspaceId && !!projectId && !!recipeId,
    staleTime: 5000, // 5 seconds
  });
}

/**
 * Hook to add sources to a recipe
 */
export function useAddSources() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
      sourceIds,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
      sourceIds: string[];
    }) => recipeAPI.addSources(workspaceId, projectId, recipeId, sourceIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipe', variables.workspaceId, variables.projectId, variables.recipeId],
      });
      toast.success(`Added ${variables.sourceIds.length} source(s) to recipe`);
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useAddSources');
    },
  });
}

/**
 * Hook to remove a source from a recipe
 */
export function useRemoveSource() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
      sourceId,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
      sourceId: string;
    }) => recipeAPI.removeSource(workspaceId, projectId, recipeId, sourceId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recipe', variables.workspaceId, variables.projectId, variables.recipeId],
      });
      toast.success('Source removed from recipe');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useRemoveSource');
    },
  });
}

/**
 * Hook to save an artifact to the file library
 */
export function useSaveArtifact() {
  const queryClient = useQueryClient();
  const recipeAPI = new RecipeAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      recipeId,
      artifactId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      recipeId: string;
      artifactId: string;
      data: SaveArtifactRequest;
    }) => recipeAPI.saveArtifact(workspaceId, projectId, recipeId, artifactId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      toast.success('Artifact saved to library');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useSaveArtifact');
    },
  });
}
