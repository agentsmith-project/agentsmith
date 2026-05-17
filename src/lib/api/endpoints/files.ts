/**
 * Files API Endpoints
 *
 * Typed API functions for file-library operations.
 */

import type {
  CreateFileLibrarySavePointRequest,
  CreateTaskFileTemplateRequest,
  DeleteFileLibraryAcceptedResponse,
  DeleteFileLibraryResult,
  FileLibrary,
  GetFileLibraryActiveOperationResponse,
  FileLibraryOperationProjection,
  FileLibraryRestoreOperation,
  FileObjectsListParams,
  FileObjectsListResponse,
  FileObjectMeta,
  FileObjectItem,
  FileLibraryVersionOperation,
  ListFileLibrarySavePointsResponse,
  ListTaskFileTemplatesResponse,
  ReleaseFileLibraryRuntimeAccessResponse,
  RestoreFileLibraryRequest,
  TaskFileTemplate,
} from '../types';
import type { ApiClient, ApiRequestOptions } from '../client';
import { APIError } from '../errors';

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0,
  );
}

function isDeleteFileLibraryAcceptedResponse(value: unknown): value is DeleteFileLibraryAcceptedResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.file_library_id === 'string'
    && record.file_library_status === 'deleting'
    && typeof record.operation_id === 'string'
    && record.operation_id.trim().length > 0
    && record.operation_status === 'pending'
  );
}

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

  async deleteLibrary(workspaceId: string, projectId: string, libraryId: string): Promise<DeleteFileLibraryResult> {
    const response = await this.client.delete<DeleteFileLibraryAcceptedResponse | void>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}`,
    );
    if (isDeleteFileLibraryAcceptedResponse(response)) {
      return {
        status: 'accepted',
        ...response,
      };
    }
    if (isNonEmptyRecord(response)) {
      throw new APIError(
        'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID',
        'file_library_delete_accepted_response_invalid',
        undefined,
        202,
        {
          file_library_id: libraryId,
          response,
        },
      );
    }
    return { status: 'deleted' };
  }

  async getFileLibraryOperationProjection(
    workspaceId: string,
    projectId: string,
    operationId: string,
  ): Promise<FileLibraryOperationProjection> {
    return this.client.get<FileLibraryOperationProjection>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-library-operations/${operationId}`,
    );
  }

  async listSavePoints(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<ListFileLibrarySavePointsResponse> {
    return this.client.get<ListFileLibrarySavePointsResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/save-points`,
    );
  }

  async createSavePoint(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: CreateFileLibrarySavePointRequest,
    options: { idempotencyKey: string },
  ): Promise<FileLibraryVersionOperation> {
    return this.client.post<FileLibraryVersionOperation>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/save-points`,
      payload,
      {
        headers: {
          'Idempotency-Key': options.idempotencyKey,
        },
      },
    );
  }

  async getActiveFileLibraryOperation(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<GetFileLibraryActiveOperationResponse> {
    return this.client.get<GetFileLibraryActiveOperationResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/operations/active`,
    );
  }

  async restoreFileLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    payload: RestoreFileLibraryRequest,
    options: { idempotencyKey: string },
  ): Promise<FileLibraryRestoreOperation> {
    return this.client.post<FileLibraryRestoreOperation>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/restore`,
      payload,
      {
        headers: {
          'Idempotency-Key': options.idempotencyKey,
        },
      },
    );
  }

  async releaseRuntimeAccess(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<ReleaseFileLibraryRuntimeAccessResponse> {
    return this.client.post<ReleaseFileLibraryRuntimeAccessResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/runtime-access/release`,
      undefined,
    );
  }

  async listTaskFileTemplates(
    workspaceId: string,
    projectId: string,
  ): Promise<ListTaskFileTemplatesResponse> {
    return this.client.get<ListTaskFileTemplatesResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/task-file-templates`,
    );
  }

  async createTaskFileTemplate(
    workspaceId: string,
    projectId: string,
    payload: CreateTaskFileTemplateRequest,
    options: { idempotencyKey: string },
  ): Promise<TaskFileTemplate> {
    return this.client.post<TaskFileTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/task-file-templates`,
      payload,
      {
        headers: {
          'Idempotency-Key': options.idempotencyKey,
        },
      },
    );
  }

  async publishTaskFileTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
  ): Promise<TaskFileTemplate> {
    return this.client.post<TaskFileTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/task-file-templates/${templateId}/publish`,
      undefined,
    );
  }

  async unpublishTaskFileTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
  ): Promise<TaskFileTemplate> {
    return this.client.post<TaskFileTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/task-file-templates/${templateId}/unpublish`,
      undefined,
    );
  }

  async deleteTaskFileTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
  ): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/task-file-templates/${templateId}`,
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
    options?: ApiRequestOptions,
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
          }
      >;
      next_continuation_token: string | null;
    }>(
      `/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/entries${query ? `?${query}` : ''}`,
      options,
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
    formData.append('file', file, file.name);

    const parsed = await this.client.postMultipart<{
      kind: 'file';
      path: string;
      name: string;
      size_bytes: number;
      content_type?: string;
      modified_at: string;
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

}
