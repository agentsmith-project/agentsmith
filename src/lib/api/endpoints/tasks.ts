/**
 * Task API Endpoints
 *
 * Typed API functions for Task operations, messages, and artifacts.
 */

import type {
  Task,
  TaskMessage,
  Artifact,
  CreateTaskRequest,
  UpdateTaskRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  TaskListParams,
  TaskListResponse,
  TaskTraceListResponse,
} from '../../types/task';
import type { FileItem } from '../types';
import type { ApiClient } from '../client';
import { API_BASE } from '../client';

export class TaskAPI {
  constructor(private client: ApiClient) {}

  /**
   * List tasks in a project
   */
  async list(
    workspaceId: string,
    projectId: string,
    params?: TaskListParams,
  ): Promise<TaskListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.search) searchParams.set('search', params.search);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<TaskListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get a task by ID
   */
  async get(workspaceId: string, projectId: string, taskId: string): Promise<Task> {
    return this.client.get<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
    );
  }

  /**
   * Create a new task
   */
  async create(
    workspaceId: string,
    projectId: string,
    data: CreateTaskRequest,
  ): Promise<Task> {
    return this.client.post<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
      data,
    );
  }

  /**
   * Update a task (title, status)
   */
  async update(
    workspaceId: string,
    projectId: string,
    taskId: string,
    data: UpdateTaskRequest,
  ): Promise<Task> {
    return this.client.patch<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
      data,
    );
  }

  /**
   * Delete a task
   */
  async delete(workspaceId: string, projectId: string, taskId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
    );
  }

  /**
   * Add sources to a task
   */
  async addFiles(
    workspaceId: string,
    projectId: string,
    taskId: string,
    fileIds: string[],
  ): Promise<Task> {
    return this.client.post<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/sources`,
      { source_ids: fileIds },
    );
  }

  /**
   * Remove a source from a task
   */
  async removeFile(
    workspaceId: string,
    projectId: string,
    taskId: string,
    fileId: string,
  ): Promise<Task> {
    return this.client.delete<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/sources/${fileId}`,
    );
  }

  /**
   * List messages in a task
   */
  async listMessages(
    workspaceId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskMessage[]> {
    return this.client.get<TaskMessage[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/messages`,
    );
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(
    workspaceId: string,
    projectId: string,
    taskId: string,
    data: SendMessageRequest,
  ): Promise<TaskMessage> {
    return this.client.post<TaskMessage>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/messages`,
      data,
    );
  }

  /**
   * List artifacts in a task
   */
  async listArtifacts(
    workspaceId: string,
    projectId: string,
    taskId: string,
  ): Promise<Artifact[]> {
    return this.client.get<Artifact[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/artifacts`,
    );
  }

  /**
   * List execution trace events in a task (optionally scoped to a message/run)
   */
  async listTraces(
    workspaceId: string,
    projectId: string,
    taskId: string,
    params?: {
      message_id?: string;
      run_id?: string;
      after_id?: string;
      before_id?: string;
      page_size?: number;
    },
  ): Promise<TaskTraceListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.message_id) searchParams.set('message_id', params.message_id);
    if (params?.run_id) searchParams.set('run_id', params.run_id);
    if (params?.after_id) searchParams.set('after_id', params.after_id);
    if (params?.before_id) searchParams.set('before_id', params.before_id);
    if (params?.page_size) searchParams.set('page_size', String(params.page_size));
    const query = searchParams.toString();
    return this.client.get<TaskTraceListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/traces${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Save an artifact to the file library
   */
  async saveArtifact(
    workspaceId: string,
    projectId: string,
    taskId: string,
    artifactId: string,
    data: SaveArtifactRequest,
  ): Promise<FileItem> {
    return this.client.post<FileItem>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/artifacts/${artifactId}/save`,
      data,
    );
  }

  /**
   * Download an artifact
   */
  async downloadArtifact(
    workspaceId: string,
    projectId: string,
    taskId: string,
    artifactId: string,
  ): Promise<Blob> {
    const { API_BASE } = await import('../client');
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/artifacts/${artifactId}/download`;
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
   * Get SSE URL for real-time updates.
   *
   * Returns the bare endpoint URL without auth parameters.
   * Authentication is handled by `createAuthenticatedSSE` from sse-client.ts
   * which adds a unified `?ticket=` parameter.
   */
  getSSEUrl(workspaceId: string, projectId: string, taskId: string): string {
    return `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/events`;
  }
}

// Export request/response types for use in hooks
export type {
  Task,
  TaskMessage,
  Artifact,
  CreateTaskRequest,
  UpdateTaskRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  TaskListParams,
  TaskListResponse,
  TaskTraceEvent,
};
