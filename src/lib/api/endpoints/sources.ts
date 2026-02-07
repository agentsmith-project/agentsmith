/**
 * Sources API Endpoints
 *
 * Typed API functions for source file operations and AIReady management.
 */

import type {
  SourceFile,
  SourceFileWithAIReady,
  SourceLibrary,
  AIReadyJob,
  QuotaSummary,
  SourcesListParams,
  SourcesListResponse,
} from '../types';
import type { ApiClient } from '../client';

export class SourcesAPI {
  constructor(private client: ApiClient) {}

  /**
   * List source files in a project
   */
  async list(
    workspaceId: string,
    projectId: string,
    params?: SourcesListParams,
  ): Promise<SourcesListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.search) searchParams.set('search', params.search);
    if (params?.status && params.status !== 'all') searchParams.set('status', params.status);
    if ('library_id' in (params ?? {}) && params?.library_id) {
      searchParams.set('library_id', params.library_id);
    }
    if (params?.ai_ready_only) searchParams.set('ai_ready_only', 'true');
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<SourcesListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get a source file by ID
   */
  async get(workspaceId: string, projectId: string, fileId: string): Promise<SourceFileWithAIReady> {
    return this.client.get<SourceFileWithAIReady>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}`,
    );
  }

  /**
   * Upload a file with progress tracking
   * Uses XMLHttpRequest for real upload progress
   */
  async upload(
    workspaceId: string,
    projectId: string,
    file: File,
    libraryId?: string,
    onProgress?: (progress: number) => void,
  ): Promise<SourceFile> {
    const { API_BASE } = await import('../client');
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/sources/upload`;
    const token = this.client.getToken();

    return new Promise<SourceFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      if (libraryId) {
        formData.append('library_id', libraryId);
      }

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            onProgress(Math.min(percentComplete, 99)); // Cap at 99% until complete
          }
        });
      }

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (onProgress) onProgress(100);
            resolve(response);
          } catch {
            reject(new Error('Failed to parse response'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(
              new Error(error.message || `Upload failed with status ${xhr.status}`),
            );
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was aborted'));
      });

      // Start upload
      xhr.open('POST', url);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  }

  /**
   * Download a file
   * Note: This uses fetch directly since we need to handle blob response
   */
  async download(workspaceId: string, projectId: string, fileId: string): Promise<Blob> {
    // Import API_BASE dynamically to avoid circular dependency
    const { API_BASE } = await import('../client');
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}/download`;
    const token = this.client.getToken();

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Download failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Delete a source file
   */
  async delete(
    workspaceId: string,
    projectId: string,
    fileId: string,
    deleteAIReady?: boolean,
  ): Promise<void> {
    const searchParams = new URLSearchParams();
    if (deleteAIReady !== undefined) {
      searchParams.set('delete_ai_ready', deleteAIReady.toString());
    }

    const query = searchParams.toString();
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Start AIReady processing for a file
   */
  async startAIReady(workspaceId: string, projectId: string, fileId: string): Promise<AIReadyJob> {
    return this.client.post<AIReadyJob>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}/ai-ready/start`,
      {},
    );
  }

  /**
   * Cancel AIReady processing for a file
   */
  async cancelAIReady(workspaceId: string, projectId: string, fileId: string): Promise<AIReadyJob> {
    return this.client.post<AIReadyJob>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}/ai-ready/cancel`,
      {},
    );
  }

  /**
   * Retry AIReady processing for a failed file
   */
  async retryAIReady(workspaceId: string, projectId: string, fileId: string): Promise<AIReadyJob> {
    return this.client.post<AIReadyJob>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}/ai-ready/retry`,
      {},
    );
  }

  /**
   * Batch start AIReady for multiple files
   */
  async batchStartAIReady(
    workspaceId: string,
    projectId: string,
    fileIds: string[],
  ): Promise<{ jobs: AIReadyJob[] }> {
    return this.client.post<{ jobs: AIReadyJob[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/batch/ai-ready/start`,
      { file_ids: fileIds },
    );
  }

  /**
   * Batch cancel AIReady for multiple files
   */
  async batchCancelAIReady(
    workspaceId: string,
    projectId: string,
    fileIds: string[],
  ): Promise<{ jobs: AIReadyJob[] }> {
    return this.client.post<{ jobs: AIReadyJob[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/batch/ai-ready/cancel`,
      { file_ids: fileIds },
    );
  }

  /**
   * Get quota summary for the project
   */
  async getQuota(workspaceId: string, projectId: string): Promise<QuotaSummary> {
    return this.client.get<QuotaSummary>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/quota`,
    );
  }

  async listLibraries(workspaceId: string, projectId: string): Promise<{ items: SourceLibrary[] }> {
    return this.client.get<{ items: SourceLibrary[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries`,
    );
  }

  async createLibrary(
    workspaceId: string,
    projectId: string,
    payload: { name: string; description?: string; visibility?: 'shared' | 'private' },
  ): Promise<SourceLibrary> {
    return this.client.post<SourceLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries`,
      payload,
    );
  }

  async updateLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: { name?: string; description?: string },
  ): Promise<SourceLibrary> {
    return this.client.patch<SourceLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
      payload,
    );
  }

  async deleteLibrary(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
    );
  }
}
