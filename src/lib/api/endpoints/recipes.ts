/**
 * Recipe API Endpoints
 *
 * Typed API functions for Recipe operations, messages, and artifacts.
 */

import type {
  Recipe,
  RecipeMessage,
  Artifact,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  RecipeListParams,
  RecipeListResponse,
} from '../../types/recipe';
import type { SourceFile } from '../types';
import type { ApiClient } from '../client';

export class RecipeAPI {
  constructor(private client: ApiClient) {}

  /**
   * List recipes in a project
   */
  async list(
    workspaceId: string,
    projectId: string,
    params?: RecipeListParams,
  ): Promise<RecipeListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.search) searchParams.set('search', params.search);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<RecipeListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get a recipe by ID
   */
  async get(workspaceId: string, projectId: string, recipeId: string): Promise<Recipe> {
    return this.client.get<Recipe>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}`,
    );
  }

  /**
   * Create a new recipe
   */
  async create(
    workspaceId: string,
    projectId: string,
    data: CreateRecipeRequest,
  ): Promise<Recipe> {
    return this.client.post<Recipe>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes`,
      data,
    );
  }

  /**
   * Update a recipe (title, status)
   */
  async update(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    data: UpdateRecipeRequest,
  ): Promise<Recipe> {
    return this.client.patch<Recipe>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}`,
      data,
    );
  }

  /**
   * Delete a recipe
   */
  async delete(workspaceId: string, projectId: string, recipeId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}`,
    );
  }

  /**
   * Add sources to a recipe
   */
  async addSources(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    sourceIds: string[],
  ): Promise<Recipe> {
    return this.client.post<Recipe>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/sources`,
      { source_ids: sourceIds },
    );
  }

  /**
   * Remove a source from a recipe
   */
  async removeSource(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    sourceId: string,
  ): Promise<Recipe> {
    return this.client.delete<Recipe>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/sources/${sourceId}`,
    );
  }

  /**
   * List messages in a recipe
   */
  async listMessages(
    workspaceId: string,
    projectId: string,
    recipeId: string,
  ): Promise<RecipeMessage[]> {
    return this.client.get<RecipeMessage[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/messages`,
    );
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    data: SendMessageRequest,
  ): Promise<RecipeMessage> {
    return this.client.post<RecipeMessage>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/messages`,
      data,
    );
  }

  /**
   * List artifacts in a recipe
   */
  async listArtifacts(
    workspaceId: string,
    projectId: string,
    recipeId: string,
  ): Promise<Artifact[]> {
    return this.client.get<Artifact[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/artifacts`,
    );
  }

  /**
   * Save an artifact to the file library
   */
  async saveArtifact(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    artifactId: string,
    data: SaveArtifactRequest,
  ): Promise<SourceFile> {
    return this.client.post<SourceFile>(
      `/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/artifacts/${artifactId}/save`,
      data,
    );
  }

  /**
   * Download an artifact
   */
  async downloadArtifact(
    workspaceId: string,
    projectId: string,
    recipeId: string,
    artifactId: string,
  ): Promise<Blob> {
    const { API_BASE } = await import('../client');
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/artifacts/${artifactId}/download`;
    const token = this.client.getToken();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Get SSE URL for real-time updates
   */
  getSSEUrl(workspaceId: string, projectId: string, recipeId: string): string {
    const { API_BASE } = require('../client');
    const token = this.client.getToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/recipes/${recipeId}/events${tokenParam}`;
  }
}

// Export request/response types for use in hooks
export type {
  Recipe,
  RecipeMessage,
  Artifact,
  CreateRecipeRequest,
  UpdateRecipeRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  RecipeListParams,
  RecipeListResponse,
};
