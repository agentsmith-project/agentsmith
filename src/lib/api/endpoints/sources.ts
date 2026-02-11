/**
 * Sources API Endpoints
 *
 * Typed API functions for source file operations and AIReady management.
 *
 * Runtime mode is controlled by NEXT_PUBLIC_USE_MSW only:
 * - true: MSW contract (frontend-oriented payload shape)
 * - false: Backend contract (source DTO shape), mapped here for UI
 */

import type {
  SourceFile,
  SourceFileWithAIReady,
  SourceLibrary,
  AIReadyJob,
  QuotaSummary,
  SourcesListParams,
  SourcesListResponse,
  SourceObjectsListParams,
  SourceObjectsListResponse,
  SourceObjectMeta,
  SourceObjectItem,
} from '../types';
import { API_BASE } from '../client';
import type { ApiClient } from '../client';
import { APIError } from '../errors';

interface BackendSourceItem {
  id: string;
  workspace_id: string;
  project_id: string;
  library_id?: string;
  name: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  status: 'ready' | 'deleted';
  ai_ready_status?: 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';
  docdb_bytes?: number;
  vectordb_bytes?: number;
  created_at: string;
  updated_at: string;
}

interface BackendSourcesResponse {
  items: BackendSourceItem[];
}

const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';

export class SourcesAPI {
  constructor(private client: ApiClient) {}

  private mapBackendSource(item: BackendSourceItem): SourceFileWithAIReady {
    return {
      id: item.id,
      workspace_id: item.workspace_id,
      project_id: item.project_id,
      library_id: item.library_id,
      owner_user_id: 'unknown',
      filename: item.name,
      file_type: item.content_type,
      file_size: item.size_bytes,
      object_ref: {
        bucket: 'mbos-dev',
        key: item.object_key,
      },
      version: 1,
      created_at: item.created_at,
      updated_at: item.updated_at,
      ai_ready_usage: item.docdb_bytes || item.vectordb_bytes
        ? {
            docdb_bytes: item.docdb_bytes ?? 0,
            vectordb_bytes: item.vectordb_bytes ?? 0,
            chunks_count: 0,
          }
        : undefined,
      ai_ready: item.ai_ready_status
        ? {
            id: `ai_ready_${item.id}`,
            source_file_id: item.id,
            status: item.ai_ready_status,
            progress: item.ai_ready_status === 'ready' ? 100 : undefined,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }
        : undefined,
    };
  }

  private mapBackendSourceToSourceFile(item: BackendSourceItem): SourceFile {
    const mapped = this.mapBackendSource(item);
    return mapped;
  }

  private async fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private buildSourcesPath(
    workspaceId: string,
    projectId: string,
    params?: SourcesListParams,
  ): { path: string; page: number; pageSize: number } {
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
    return {
      path: `/workspaces/${workspaceId}/projects/${projectId}/sources${query ? `?${query}` : ''}`,
      page: params?.page ?? 1,
      pageSize: params?.page_size ?? 20,
    };
  }

  /**
   * List source files in a project
   */
  async list(
    workspaceId: string,
    projectId: string,
    params?: SourcesListParams,
  ): Promise<SourcesListResponse> {
    const { path, page, pageSize } = this.buildSourcesPath(workspaceId, projectId, params);

    if (useMsw) {
      return this.client.get<SourcesListResponse>(path);
    }

    const response = await this.client.get<BackendSourcesResponse>(path);
    const items = response.items.map((item) => this.mapBackendSource(item));

    return {
      items,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: false,
    };
  }

  /**
   * Get a source file by ID
   */
  async get(workspaceId: string, projectId: string, fileId: string): Promise<SourceFileWithAIReady> {
    if (useMsw) {
      return this.client.get<SourceFileWithAIReady>(
        `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}`,
      );
    }

    const response = await this.client.get<BackendSourceItem>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}`,
    );
    return this.mapBackendSource(response);
  }

  /**
   * Upload a file with progress tracking
   */
  async upload(
    workspaceId: string,
    projectId: string,
    file: File,
    libraryId?: string,
    onProgress?: (progress: number) => void,
  ): Promise<SourceFile> {
    if (!useMsw) {
      const response = await this.client.post<BackendSourceItem>(
        `/workspaces/${workspaceId}/projects/${projectId}/sources`,
        {
          name: file.name,
          content_type: file.type || 'application/octet-stream',
          content_base64: await this.fileToBase64(file),
          library_id: libraryId,
        },
      );
      if (onProgress) onProgress(100);
      return this.mapBackendSourceToSourceFile(response);
    }

    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/sources/upload`;
    const token = this.client.getToken();

    return new Promise<SourceFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      if (libraryId) {
        formData.append('library_id', libraryId);
      }

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            onProgress(Math.min(percentComplete, 99));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as SourceFile;
            if (onProgress) onProgress(100);
            resolve(parsed);
          } catch {
            reject(new Error('Failed to parse response'));
          }
          return;
        }

        try {
          const errorData = JSON.parse(xhr.responseText) as { message?: string };
          reject(new Error(errorData.message || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was aborted'));
      });

      xhr.open('POST', url);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  }

  /**
   * Download a file
   */
  async download(workspaceId: string, projectId: string, fileId: string): Promise<Blob> {
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
      const message =
        typeof errorData === 'object' && errorData && 'message' in errorData
          ? String((errorData as { message?: string }).message)
          : `Download failed: ${response.statusText}`;
      throw new Error(message);
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
  async getQuota(
    workspaceId: string,
    projectId: string,
    libraryId?: string,
  ): Promise<QuotaSummary> {
    const searchParams = new URLSearchParams();
    if (libraryId) {
      searchParams.set('library_id', libraryId);
    }
    const query = searchParams.toString();
    return this.client.get<QuotaSummary>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/quota${query ? `?${query}` : ''}`,
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

  // ============================================================
  // Object browser (MinIO-like file manager)
  // ============================================================

  async listObjects(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    params?: SourceObjectsListParams,
  ): Promise<SourceObjectsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.prefix) searchParams.set('prefix', params.prefix);
    searchParams.set('delimiter', '/');
    if (params?.page_size) searchParams.set('page_size', String(params.page_size));
    if (params?.continuation_token) searchParams.set('continuation_token', params.continuation_token);
    const query = searchParams.toString();
    return this.client.get<SourceObjectsListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects${query ? `?${query}` : ''}`,
    );
  }

  async createFolder(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    prefix: string,
  ): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/folders`,
      { prefix },
    );
  }

  async uploadObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    file: File,
    prefix?: string,
    overwrite?: boolean,
    onProgress?: (progress: number) => void,
  ): Promise<SourceObjectItem> {
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects/upload`;
    const token = this.client.getToken();

    return new Promise<SourceObjectItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      if (prefix) formData.append('prefix', prefix);
      if (overwrite) formData.append('overwrite', 'true');
      formData.append('file', file);

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            onProgress(Math.min(percentComplete, 99));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as SourceObjectItem;
            if (onProgress) onProgress(100);
            resolve(parsed);
          } catch {
            reject(new Error('Failed to parse response'));
          }
          return;
        }

        try {
          const errorData = JSON.parse(xhr.responseText) as {
            error_code?: string;
            message?: string;
            request_id?: string;
            details?: Record<string, unknown>;
          };
          if (errorData.error_code && errorData.message) {
            reject(new APIError(errorData.error_code, errorData.message, errorData.request_id, xhr.status, errorData.details));
            return;
          }
          reject(new Error(errorData.message || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.addEventListener('abort', () => reject(new Error('Upload was aborted')));

      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  async downloadObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    key: string,
  ): Promise<Blob> {
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects/download?key=${encodeURIComponent(key)}`;
    const token = this.client.getToken();

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        typeof errorData === 'object' && errorData && 'message' in errorData
          ? String((errorData as { message?: string }).message)
          : `Download failed: ${response.statusText}`;
      throw new Error(message);
    }
    return response.blob();
  }

  async deleteObjects(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    keys: string[],
  ): Promise<{ results: Array<{ key: string; status: 'deleted' | 'failed' | 'not_found' | 'error'; error_code?: string; message?: string }> }> {
    return this.client.post<{ results: Array<{ key: string; status: 'deleted' | 'failed' | 'not_found' | 'error'; error_code?: string; message?: string }> }>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects/delete`,
      { keys },
    );
  }

  async moveObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: { from_key: string; to_key: string; overwrite?: boolean },
  ): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects/move`,
      payload,
    );
  }

  async getObjectMeta(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    key: string,
  ): Promise<SourceObjectMeta> {
    return this.client.get<SourceObjectMeta>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}/objects/meta?key=${encodeURIComponent(key)}`,
    );
  }
}
