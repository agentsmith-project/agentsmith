import { API_BASE, type ApiClient } from '../client';
import { APIError } from '../errors';
import type {
  CreateFileLibraryFolderRequest,
  CreateFileLibraryRequest,
  DesktopMountAccessExchangeResponse,
  DeleteFileLibraryEntriesRequest,
  DeleteFileLibraryEntriesResponse,
  FileLibraryEntry,
  FileLibrary,
  FileLibraryBackend,
  FileLibraryEntriesListParams,
  FileLibraryEntriesListResponse,
  MoveFileLibraryEntryRequest,
  StorageCredentialExchangeResponse,
  UpdateFileLibraryRequest,
} from '../types';

interface ListFileLibrariesResponse {
  items: FileLibrary[];
}

export class FileLibrariesAPI {
  constructor(private client: ApiClient) {}

  async list(workspaceId: string, projectId: string): Promise<ListFileLibrariesResponse> {
    return this.client.get<ListFileLibrariesResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
    );
  }

  async create(
    workspaceId: string,
    projectId: string,
    body: CreateFileLibraryRequest,
  ): Promise<FileLibrary> {
    return this.client.post<FileLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
      body,
    );
  }

  async get(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibrary> {
    return this.client.get<FileLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    body: UpdateFileLibraryRequest,
  ): Promise<FileLibrary> {
    return this.client.patch<FileLibrary>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
      body,
    );
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    await this.client.delete(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
    );
  }

  async getBackend(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryBackend> {
    return this.client.get<FileLibraryBackend>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/backend`,
    );
  }

  async listEntries(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    params?: FileLibraryEntriesListParams,
  ): Promise<FileLibraryEntriesListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.path) searchParams.set('path', params.path);
    if (params?.page_size) searchParams.set('page_size', String(params.page_size));
    if (params?.continuation_token) searchParams.set('continuation_token', params.continuation_token);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);
    const query = searchParams.toString();

    return this.client.get<FileLibraryEntriesListResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/entries${query ? `?${query}` : ''}`,
    );
  }

  async createFolder(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    body: CreateFileLibraryFolderRequest,
  ): Promise<void> {
    await this.client.post(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/folders`,
      body,
    );
  }

  async deleteEntries(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    body: DeleteFileLibraryEntriesRequest,
  ): Promise<DeleteFileLibraryEntriesResponse> {
    return this.client.post<DeleteFileLibraryEntriesResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/delete`,
      body,
    );
  }

  async moveEntry(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    body: MoveFileLibraryEntryRequest,
  ): Promise<void> {
    await this.client.post(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/move`,
      body,
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
  ): Promise<FileLibraryEntry> {
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/upload`;
    const token = this.client.getToken();

    return new Promise<FileLibraryEntry>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      if (prefix) formData.append('prefix', prefix);
      if (overwrite) formData.append('overwrite', 'true');
      formData.append('file', file);

      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            onProgress(Math.min((event.loaded / event.total) * 100, 99));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as FileLibraryEntry;
            onProgress?.(100);
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
    path: string,
  ): Promise<Blob> {
    const url = `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/download?path=${encodeURIComponent(path)}`;
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
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

  async exchangeStorageCredentials(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<StorageCredentialExchangeResponse> {
    return this.client.post<StorageCredentialExchangeResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/storage-credential-exchange`,
      {},
    );
  }

  async exchangeDesktopMountAccess(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<DesktopMountAccessExchangeResponse> {
    return this.client.post<DesktopMountAccessExchangeResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/desktop-mount-access`,
      {},
    );
  }
}
