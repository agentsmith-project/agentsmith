import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';

export type ActiveFileLibraryStorageDeps = {
  fileLibraryStorageAdapter?: Pick<FileLibraryStoragePort, 'enabled' | 'downloadObject' | 'getObjectMeta'>;
};

export type ActiveFileLibraryObjectRef = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  key: string;
};

export type ActiveFileLibraryObjectMeta = {
  key: string;
  content_type?: string;
  size_bytes?: number;
  etag?: string;
  last_modified?: string;
};

export type ActiveFileLibraryObjectDownload = {
  key: string;
  body: WebReadableStream<Uint8Array>;
  cancel: (reason?: unknown) => Promise<void>;
  contentType: string;
  sizeBytes?: number;
  etag?: string;
  lastModified?: string;
};

function requireActiveStorageAdapter(
  deps: ActiveFileLibraryStorageDeps,
): Pick<FileLibraryStoragePort, 'downloadObject' | 'getObjectMeta'> {
  const adapter = deps.fileLibraryStorageAdapter;
  if (!adapter?.enabled) {
    throw new Error('file_library_storage_adapter_required');
  }
  return adapter;
}

export async function getActiveFileLibraryObjectMeta(
  deps: ActiveFileLibraryStorageDeps,
  ref: ActiveFileLibraryObjectRef,
): Promise<ActiveFileLibraryObjectMeta> {
  const adapter = requireActiveStorageAdapter(deps);
  const meta = await adapter.getObjectMeta({
    workspaceId: ref.workspaceId,
    projectId: ref.projectId,
    libraryId: ref.libraryId,
    objectPath: ref.key,
  });
  return {
    key: meta.key,
    content_type: meta.content_type,
    size_bytes: meta.size_bytes,
    ...(meta.etag ? { etag: meta.etag } : {}),
    last_modified: meta.last_modified,
  };
}

export async function downloadActiveFileLibraryObject(
  deps: ActiveFileLibraryStorageDeps,
  ref: ActiveFileLibraryObjectRef,
): Promise<ActiveFileLibraryObjectDownload> {
  const adapter = requireActiveStorageAdapter(deps);
  const result = await adapter.downloadObject({
    workspaceId: ref.workspaceId,
    projectId: ref.projectId,
    libraryId: ref.libraryId,
    objectPath: ref.key,
  });
  return {
    key: result.meta.key,
    body: Readable.toWeb(result.download.stream) as unknown as WebReadableStream<Uint8Array>,
    cancel: result.download.cancel,
    contentType: result.meta.content_type,
    sizeBytes: result.meta.size_bytes,
    ...(result.meta.etag ? { etag: result.meta.etag } : {}),
    lastModified: result.meta.last_modified,
  };
}
