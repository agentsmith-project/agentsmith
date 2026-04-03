import { type ApiClient } from '../client';
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
    const formData = new FormData();
    if (prefix) formData.append('prefix', prefix);
    if (overwrite) formData.append('overwrite', 'true');
    formData.append('file', file);

    return this.client.postMultipart<FileLibraryEntry>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/upload`,
      formData,
      {
        signal,
        onProgress,
      },
    );
  }

  async downloadObject(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    path: string,
  ): Promise<Blob> {
    return this.client.getBlob(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/download`,
      {
        params: { path },
      },
    );
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
