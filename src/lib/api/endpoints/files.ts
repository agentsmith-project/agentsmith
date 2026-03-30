/**
 * Files API Endpoints
 *
 * Typed API functions for file-library operations.
 */

import type {
  FileLibrary,
  FileObjectsListParams,
  FileObjectsListResponse,
  FileObjectMeta,
  FileObjectShareLink,
  FileObjectItem,
} from '../types';
import { API_BASE } from '../client';
import type { ApiClient } from '../client';
import { APIError } from '../errors';

export class FilesAPI {
  constructor(private client: ApiClient) {}

  async listLibraries(workspaceId: string, projectId: string): Promise<{ items: FileLibrary[] }> {
    return this.client.get<{ items: FileLibrary[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
    );
  }

  async createLibrary(
    workspaceId: string,
    projectId: string,
    payload: { name: string; description?: string; visibility?: 'shared' | 'private' },
  ): Promise<FileLibrary> {
    return this.client.post<FileLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
      {
        name: payload.name,
        description: payload.description,
      },
    );
  }

  async updateLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: { name?: string; description?: string },
  ): Promise<FileLibrary> {
    return this.client.patch<FileLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
      payload,
    );
  }

  async deleteLibrary(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
    );
  }

  // ============================================================
  // Object browser (MinIO-like file manager)
  // ============================================================

  async listObjects(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    params?: FileObjectsListParams,
  ): Promise<FileObjectsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.prefix) searchParams.set('path', params.prefix);
    if (params?.page_size) searchParams.set('page_size', String(params.page_size));
    if (params?.continuation_token) searchParams.set('continuation_token', params.continuation_token);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sort_by) {
      searchParams.set(
        'sort_by',
        params.sort_by === 'last_modified' ? 'modified_at' : params.sort_by,
      );
    }
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);
    const query = searchParams.toString();
    return this.client.get<{
      path: string;
      items: Array<
        | { kind: 'directory'; path: string; name: string; modified_at?: string }
        | {
            kind: 'file';
            path: string;
            name: string;
            size_bytes: number;
            content_type?: string;
            modified_at: string;
            etag?: string;
          }
      >;
      next_continuation_token: string | null;
    }>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/entries${query ? `?${query}` : ''}`,
    ).then((response) => ({
      prefix: response.path,
      items: response.items.map((item) =>
        item.kind === 'directory'
          ? {
              kind: 'prefix' as const,
              prefix: item.path.endsWith('/') ? item.path : `${item.path}/`,
              name: item.name,
            }
          : {
              kind: 'object' as const,
              key: item.path,
              name: item.name,
              size_bytes: item.size_bytes,
              content_type: item.content_type ?? 'application/octet-stream',
              etag: item.etag,
              last_modified: item.modified_at,
            }),
      next_continuation_token: response.next_continuation_token ?? null,
    }));
  }

  async createFolder(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    prefix: string,
  ): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/folders`,
      { path: prefix },
    );
  }

  async uploadObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    file: File,
    prefix?: string,
    overwrite?: boolean,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<FileObjectItem> {
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/upload`;
    const token = this.client.getToken();

    return new Promise<FileObjectItem>((resolve, reject) => {
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
            const parsed = JSON.parse(xhr.responseText) as {
              kind: 'file';
              path: string;
              name: string;
              size_bytes: number;
              content_type?: string;
              modified_at: string;
              etag?: string;
            };
            if (onProgress) onProgress(100);
            resolve({
              kind: 'object',
              key: parsed.path,
              name: parsed.name,
              size_bytes: parsed.size_bytes,
              content_type: parsed.content_type ?? 'application/octet-stream',
              etag: parsed.etag,
              last_modified: parsed.modified_at,
            });
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

      const handleAbort = () => xhr.abort();
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', handleAbort, { once: true });
      }

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
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/download?path=${encodeURIComponent(key)}`;
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
    return this.client.post<{ results: Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }> }>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/delete`,
      { paths: keys },
    ).then((response) => ({
      results: response.results.map((item) => ({
        key: item.path,
        status: item.status,
        error_code: item.error_code,
        message: item.message,
      })),
    }));
  }

  async moveObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: { from_key: string; to_key: string; overwrite?: boolean },
  ): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/move`,
      {
        from_path: payload.from_key,
        to_path: payload.to_key,
        overwrite: payload.overwrite,
      },
    );
  }

  async getObjectMeta(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    key: string,
  ): Promise<FileObjectMeta> {
    return this.client.get<FileObjectMeta>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/meta?path=${encodeURIComponent(key)}`,
    );
  }

  async createObjectShareLink(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: { key: string; expires_in_seconds?: number },
  ): Promise<FileObjectShareLink> {
    return this.client.post<FileObjectShareLink>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/share-link`,
      {
        path: payload.key,
        expires_in_seconds: payload.expires_in_seconds,
      },
    );
  }
}
