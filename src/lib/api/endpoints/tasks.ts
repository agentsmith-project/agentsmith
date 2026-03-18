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
  TaskListParams,
  TaskListResponse,
  TaskTraceListResponse,
  TaskTraceEvent,
  TaskAttachedInputDetail,
} from '../../types/task';
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
   * Add attached inputs to a task
   */
  async addInputs(
    workspaceId: string,
    projectId: string,
    taskId: string,
    inputs: Array<
      | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
      | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
      | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
    >,
  ): Promise<Task> {
    return this.client.post<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/inputs`,
      { inputs },
    );
  }

  /**
   * Remove a source from a task
   */
  async removeInput(
    workspaceId: string,
    projectId: string,
    taskId: string,
    inputId: string,
  ): Promise<Task> {
    return this.client.delete<Task>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/inputs/${inputId}`,
    );
  }

  /**
   * List attached source file details for a task.
   */
  async listAttachedInputs(
    workspaceId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskAttachedInputDetail[]> {
    return this.client.get<TaskAttachedInputDetail[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/inputs`,
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
   * Cancel the currently running agent turn in this task.
   */
  async cancelRun(
    workspaceId: string,
    projectId: string,
    taskId: string,
  ): Promise<{ status: 'cancelling'; task_id: string; run_id: string; request_id: string }> {
    return this.client.post<{ status: 'cancelling'; task_id: string; run_id: string; request_id: string }>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/cancel`,
      {},
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
  TaskListParams,
  TaskListResponse,
  TaskTraceEvent,
};
