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

interface HybridSourceItem {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

interface HybridSourcesResponse {
  items: HybridSourceItem[];
}

interface HybridQuotaResponse {
  storage: { used: number; limit: number };
  docdb: { used: number; limit: number };
  vectordb: { used: number; limit: number };
}

export class SourcesAPI {
  constructor(private client: ApiClient) {}

  private getHybridRealBase(): string | null {
    const base = process.env.NEXT_PUBLIC_SOURCES_REAL_BASE?.trim();
    if (!base) {
      return null;
    }

    return base.replace(/\/$/, '');
  }

  private isHybridReadEnabled(): boolean {
    return process.env.NEXT_PUBLIC_SOURCES_REAL_READ_ENABLED === 'true';
  }

  private isHybridWriteEnabled(): boolean {
    return process.env.NEXT_PUBLIC_SOURCES_REAL_WRITE_ENABLED === 'true';
  }

  private mapHybridSource(item: HybridSourceItem): SourceFileWithAIReady {
    return {
      id: item.id,
      workspace_id: item.workspace_id,
      project_id: item.project_id,
      owner_user_id: 'user_mock_owner',
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
    };
  }

  private mapHybridSourceToSourceFile(item: HybridSourceItem): SourceFile {
    return {
      id: item.id,
      workspace_id: item.workspace_id,
      project_id: item.project_id,
      owner_user_id: 'user_mock_owner',
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
    };
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

  private async tryHybridUpload(
    realBase: string,
    workspaceId: string,
    projectId: string,
    file: File,
  ): Promise<SourceFile> {
    const token = this.client.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const body = {
      name: file.name,
      content_type: file.type || 'application/octet-stream',
      content_base64: await this.fileToBase64(file),
    };

    const response = await fetch(
      `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`hybrid_upload_http_${response.status}`);
    }

    const data = (await response.json()) as HybridSourceItem;
    return this.mapHybridSourceToSourceFile(data);
  }

  private async tryHybridDelete(
    realBase: string,
    workspaceId: string,
    projectId: string,
    fileId: string,
  ): Promise<void> {
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}`,
      {
        method: 'DELETE',
        headers,
      },
    );
    if (!response.ok && response.status !== 204) {
      throw new Error(`hybrid_delete_http_${response.status}`);
    }
  }

  private async tryHybridGet(
    realBase: string,
    workspaceId: string,
    projectId: string,
    fileId: string,
  ): Promise<SourceFileWithAIReady> {
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}`,
      {
        method: 'GET',
        headers,
      },
    );
    if (!response.ok) {
      throw new Error(`hybrid_get_http_${response.status}`);
    }
    const data = (await response.json()) as HybridSourceItem;
    return this.mapHybridSource(data);
  }

  private async tryHybridGetQuota(
    realBase: string,
    workspaceId: string,
    projectId: string,
  ): Promise<QuotaSummary> {
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources/quota`,
      {
        method: 'GET',
        headers,
      },
    );
    if (!response.ok) {
      throw new Error(`hybrid_quota_http_${response.status}`);
    }

    const data = (await response.json()) as HybridQuotaResponse;
    return data;
  }

  private async tryHybridDownload(
    realBase: string,
    workspaceId: string,
    projectId: string,
    fileId: string,
  ): Promise<Blob> {
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources/${fileId}/download`,
      {
        method: 'GET',
        headers,
      },
    );
    if (!response.ok) {
      throw new Error(`hybrid_download_http_${response.status}`);
    }

    return response.blob();
  }

  private async tryHybridList(
    realBase: string,
    workspaceId: string,
    projectId: string,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<SourcesListResponse> {
    const url = `${realBase}/workspaces/${workspaceId}/projects/${projectId}/sources${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = {};
    const token = this.client.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`hybrid_sources_http_${response.status}`);
    }

    const data = (await response.json()) as HybridSourcesResponse;
    const items = data.items.map((item) => this.mapHybridSource(item));

    return {
      items,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: false,
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
    const realBase = this.getHybridRealBase();
    const page = params?.page ?? 1;
    const pageSize = params?.page_size ?? 20;

    if (realBase && this.isHybridReadEnabled()) {
      try {
        return await this.tryHybridList(
          realBase,
          workspaceId,
          projectId,
          query,
          page,
          pageSize,
        );
      } catch {
        // Fall back to current API client (MSW or fetch adapter).
      }
    }

    return this.client.get<SourcesListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get a source file by ID
   */
  async get(workspaceId: string, projectId: string, fileId: string): Promise<SourceFileWithAIReady> {
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridReadEnabled()) {
      try {
        return await this.tryHybridGet(realBase, workspaceId, projectId, fileId);
      } catch {
        // Fall back to current adapter behavior.
      }
    }

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
    const realBase = this.getHybridRealBase();
    const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';
    if (realBase && this.isHybridWriteEnabled()) {
      try {
        const created = await this.tryHybridUpload(realBase, workspaceId, projectId, file);
        if (onProgress) onProgress(100);
        return created;
      } catch {
        // Fall back to current adapter behavior.
      }
    }

    // Real backend mode: align with backend /sources JSON contract before legacy multipart fallback.
    if (!useMsw) {
      try {
        const { API_BASE } = await import('../client');
        const created = await this.tryHybridUpload(API_BASE, workspaceId, projectId, file);
        if (onProgress) onProgress(100);
        return created;
      } catch {
        // Keep legacy fallback below for backward compatibility.
      }
    }

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
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridReadEnabled()) {
      try {
        return await this.tryHybridDownload(realBase, workspaceId, projectId, fileId);
      } catch {
        // Fall back to current adapter behavior.
      }
    }

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
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridReadEnabled()) {
      try {
        await this.tryHybridDelete(realBase, workspaceId, projectId, fileId);
        return;
      } catch {
        // Fall back to current adapter behavior.
      }
    }

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
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridWriteEnabled()) {
      try {
        return await this.tryHybridGetQuota(realBase, workspaceId, projectId);
      } catch {
        // Fall back to current adapter behavior.
      }
    }

    return this.client.get<QuotaSummary>(
      `/workspaces/${workspaceId}/projects/${projectId}/sources/quota`,
    );
  }

  async listLibraries(workspaceId: string, projectId: string): Promise<{ items: SourceLibrary[] }> {
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridReadEnabled()) {
      try {
        const token = this.client.getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(
          `${realBase}/workspaces/${workspaceId}/projects/${projectId}/source-libraries`,
          { method: 'GET', headers },
        );
        if (!response.ok) {
          throw new Error(`hybrid_source_libraries_list_http_${response.status}`);
        }
        return (await response.json()) as { items: SourceLibrary[] };
      } catch {
        // Fall back to current adapter behavior.
      }
    }

    return this.client.get<{ items: SourceLibrary[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries`,
    );
  }

  async createLibrary(
    workspaceId: string,
    projectId: string,
    payload: { name: string; description?: string; visibility?: 'shared' | 'private' },
  ): Promise<SourceLibrary> {
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridWriteEnabled()) {
      try {
        const token = this.client.getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(
          `${realBase}/workspaces/${workspaceId}/projects/${projectId}/source-libraries`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) {
          throw new Error(`hybrid_source_libraries_create_http_${response.status}`);
        }
        return (await response.json()) as SourceLibrary;
      } catch {
        // Fall back to current adapter behavior.
      }
    }

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
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridWriteEnabled()) {
      try {
        const token = this.client.getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(
          `${realBase}/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) {
          throw new Error(`hybrid_source_libraries_update_http_${response.status}`);
        }
        return (await response.json()) as SourceLibrary;
      } catch {
        // Fall back to current adapter behavior.
      }
    }

    return this.client.patch<SourceLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
      payload,
    );
  }

  async deleteLibrary(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    const realBase = this.getHybridRealBase();
    if (realBase && this.isHybridWriteEnabled()) {
      try {
        const token = this.client.getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(
          `${realBase}/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
          {
            method: 'DELETE',
            headers,
          },
        );
        if (!response.ok && response.status !== 204) {
          throw new Error(`hybrid_source_libraries_delete_http_${response.status}`);
        }
        return;
      } catch {
        // Fall back to current adapter behavior.
      }
    }

    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/source-libraries/${libraryId}`,
    );
  }
}
