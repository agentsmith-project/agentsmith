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
import type { ApiClient } from '../client';

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
    const formData = new FormData();
    if (prefix) formData.append('prefix', prefix);
    if (overwrite) formData.append('overwrite', 'true');
    formData.append('file', file);

    const parsed = await this.client.postMultipart<{
      kind: 'file';
      path: string;
      name: string;
      size_bytes: number;
      content_type?: string;
      modified_at: string;
      etag?: string;
    }>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/upload`,
      formData,
      {
        signal,
        onProgress,
      },
    );

    return {
      kind: 'object',
      key: parsed.path,
      name: parsed.name,
      size_bytes: parsed.size_bytes,
      content_type: parsed.content_type ?? 'application/octet-stream',
      etag: parsed.etag,
      last_modified: parsed.modified_at,
    };
  }

  async downloadObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    key: string,
  ): Promise<Blob> {
    return this.client.getBlob(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/download`,
      {
        params: { path: key },
      },
    );
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
