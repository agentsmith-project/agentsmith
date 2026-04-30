import {
  CreateFileLibraryObjectFolderRequestSchema,
  CreateFileLibraryCatalogRequestSchema,
  DeleteFileLibraryObjectsRequestSchema,
  ListFileLibraryObjectsResponseSchema,
  MoveFileLibraryObjectRequestSchema,
  FileLibraryObjectShareLinkCreateRequestSchema,
  FileLibraryObjectShareLinkResponseSchema,
  FileLibraryObjectMetaResponseSchema,
  UploadFileLibraryObjectResponseSchema,
  UpdateFileLibraryCatalogRequestSchema,
  type CreateFileLibraryObjectFolderRequest,
  type CreateFileLibraryCatalogRequest,
  type DeleteFileLibraryObjectsRequest,
  type DeleteFileLibraryObjectsResponse,
  type ListFileLibraryObjectsResponse,
  type MoveFileLibraryObjectRequest,
  type ListFileLibraryCatalogsResponse,
  type FileLibraryObjectShareLinkCreateRequest,
  type FileLibraryObjectShareLinkResponse,
  type FileLibraryObjectMetaResponse,
  type FileLibraryCatalogDTO,
  type UpdateFileLibraryCatalogRequest,
  type UploadFileLibraryObjectResponse,
} from '@mbos/contracts';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
  CachePort,
  ClockPort,
  IdGeneratorPort,
  ObjectStorePort,
  FileLibraryCatalogRepoPort,
} from '@mbos/ports';
import { buildFileLibrariesCacheKey } from './cache-keys.js';

export interface ListFileLibraryCatalogsCommand {
  workspaceId: string;
  projectId: string;
}

export interface CreateFileLibraryCatalogCommand extends ListFileLibraryCatalogsCommand {
  actorId: string;
  input: CreateFileLibraryCatalogRequest;
}

export interface UpdateFileLibraryCatalogCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  input: UpdateFileLibraryCatalogRequest;
}

export interface DeleteFileLibraryCatalogCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
}

export interface ListFileLibraryObjectsCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  prefix?: string;
  delimiter?: string;
  pageSize?: number;
  continuationToken?: string;
  search?: string;
  sortBy?: 'name' | 'size_bytes' | 'last_modified';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateFileLibraryFolderCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  input: CreateFileLibraryObjectFolderRequest;
}

export interface UploadFileLibraryObjectCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  fileName: string;
  fileStream: WebReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
  prefix?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
}

export interface DeleteFileLibraryObjectsCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  input: DeleteFileLibraryObjectsRequest;
}

export interface MoveFileLibraryObjectCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  input: MoveFileLibraryObjectRequest;
}

export interface GetFileLibraryObjectMetaCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  key: string;
}

export type DownloadFileLibraryObjectCommand = GetFileLibraryObjectMetaCommand;

export interface CreateFileLibraryObjectShareLinkCommand extends ListFileLibraryCatalogsCommand {
  libraryId: string;
  input: FileLibraryObjectShareLinkCreateRequest;
}

function fileLibraryTuple(workspaceId: string, projectId: string, libraryId: string): {
  objectPrefix: string;
  docNamespace: string;
  vectorNamespace: string;
} {
  const scope = `${workspaceId}_${projectId}_${libraryId}`;
  return {
    objectPrefix: `workspaces/${workspaceId}/projects/${projectId}/libraries/${libraryId}/`,
    docNamespace: `doc_${scope}`,
    vectorNamespace: `vec_${scope}`,
  };
}

function ensureLibrary(
  library: FileLibraryCatalogDTO | null,
): FileLibraryCatalogDTO & { object_prefix: string } {
  if (!library) {
    throw new Error('file_library_not_found');
  }
  if (!library.object_prefix) {
    throw new Error('file_library_prefix_missing');
  }
  const normalizedPrefix = `${library.object_prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  return { ...library, object_prefix: normalizedPrefix };
}

function normalizePrefix(value?: string): string {
  const raw = (value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('/') || raw.includes('\\') || raw.includes('..')) {
    throw new Error('invalid_prefix');
  }
  const squashed = raw.replace(/\/{2,}/g, '/');
  return squashed.endsWith('/') ? squashed : `${squashed}/`;
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('..')) {
    throw new Error('invalid_key');
  }
  return key.replace(/\/{2,}/g, '/');
}

function joinObjectKey(basePrefix: string, relative: string): string {
  const left = basePrefix.endsWith('/') ? basePrefix : `${basePrefix}/`;
  const right = relative.startsWith('/') ? relative.slice(1) : relative;
  return `${left}${right}`;
}

function stripObjectPrefix(fullKey: string, libraryPrefix: string): string {
  if (!fullKey.startsWith(libraryPrefix)) {
    throw new Error('invalid_key');
  }
  return fullKey.slice(libraryPrefix.length);
}

function basenameFromKey(key: string): string {
  const cleaned = key.endsWith('/') ? key.slice(0, -1) : key;
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function addSecondsToIso(iso: string, seconds: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) {
    throw new Error('invalid_clock');
  }
  return new Date(base + seconds * 1000).toISOString();
}

export function decodeBase64(value: string): Uint8Array {
  const maybeBuffer = (
    globalThis as {
      Buffer?: {
        from: (input: string, encoding: 'base64') => Uint8Array;
      };
    }
  ).Buffer;

  if (maybeBuffer) {
    return Uint8Array.from(maybeBuffer.from(value, 'base64'));
  }

  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

export class ListFileLibraryCatalogsUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: ListFileLibraryCatalogsCommand): Promise<ListFileLibraryCatalogsResponse> {
    const cacheKey = buildFileLibrariesCacheKey(command.workspaceId, command.projectId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ListFileLibraryCatalogsResponse;
    }

    const items = await this.fileLibraryCatalogRepo.listByProject(
      command.workspaceId,
      command.projectId,
    );
    const payload: ListFileLibraryCatalogsResponse = { items };
    await this.cache.set(cacheKey, JSON.stringify(payload), 30);
    return payload;
  }
}

export class CreateFileLibraryCatalogUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: CreateFileLibraryCatalogCommand): Promise<FileLibraryCatalogDTO> {
    const input = CreateFileLibraryCatalogRequestSchema.parse(command.input);
    const now = this.clock.nowIso();
    const libraryId = this.idGenerator.nextProjectId().replace(/^proj_/, 'lib_');
    const tuple = fileLibraryTuple(command.workspaceId, command.projectId, libraryId);
    const library: FileLibraryCatalogDTO = {
      id: libraryId,
      workspace_id: command.workspaceId,
      project_id: command.projectId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      visibility: 'shared',
      object_prefix: tuple.objectPrefix,
      doc_namespace: tuple.docNamespace,
      vector_namespace: tuple.vectorNamespace,
      created_by_user_id: command.actorId,
      created_at: now,
      updated_at: now,
    };

    await this.fileLibraryCatalogRepo.save(library);
    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
    return library;
  }
}

export class UpdateFileLibraryCatalogUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: UpdateFileLibraryCatalogCommand): Promise<FileLibraryCatalogDTO> {
    const input = UpdateFileLibraryCatalogRequestSchema.parse(command.input);
    const patch: Partial<FileLibraryCatalogDTO> = {
      updated_at: this.clock.nowIso(),
    };
    if (input.name !== undefined) {
      patch.name = input.name.trim();
    }
    if (input.description !== undefined) {
      patch.description = input.description.trim();
    }

    const updated = await this.fileLibraryCatalogRepo.update(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      patch,
    );
    if (!updated) {
      throw new Error('file_library_not_found');
    }

    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
    return updated;
  }
}

export class DeleteFileLibraryCatalogUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly cache: CachePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DeleteFileLibraryCatalogCommand): Promise<void> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const listed = await this.objectStore.listObjects(this.bucket, {
      prefix: library.object_prefix,
      delimiter: '/',
      pageSize: 1,
    });
    if (listed.objects.length > 0 || listed.commonPrefixes.length > 0) {
      throw new Error('library_not_empty');
    }

    const deleted = await this.fileLibraryCatalogRepo.delete(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    );
    if (!deleted) {
      throw new Error('file_library_not_found');
    }

    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
  }
}

export class ListFileLibraryObjectsUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: ListFileLibraryObjectsCommand): Promise<ListFileLibraryObjectsResponse> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const prefix = normalizePrefix(command.prefix);
    const delimiter = command.delimiter ?? '/';
    const pageSize = Math.min(Math.max(1, command.pageSize ?? 200), 1000);
    const normalizedSearch = command.search?.trim().toLowerCase() ?? '';
    const hasSearch = normalizedSearch.length > 0;
    const sortBy = command.sortBy ?? 'name';
    const sortOrder = command.sortOrder ?? 'asc';
    const sortFactor = sortOrder === 'desc' ? -1 : 1;
    const listed = await this.objectStore.listObjects(this.bucket, {
      prefix: joinObjectKey(library.object_prefix, prefix),
      delimiter,
      pageSize,
      continuationToken: command.continuationToken,
    });
    let prefixItems = listed.commonPrefixes
      .map((fullPrefix) => {
        const relativePrefix = stripObjectPrefix(fullPrefix, library.object_prefix);
        return {
          kind: 'prefix' as const,
          prefix: relativePrefix,
          name: basenameFromKey(relativePrefix),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    let objectItems = listed.objects
      .map((obj) => {
        const relativeKey = stripObjectPrefix(obj.key, library.object_prefix);
        if (!relativeKey || relativeKey.endsWith('/')) {
          return null;
        }
        return {
          kind: 'object' as const,
          key: relativeKey,
          name: basenameFromKey(relativeKey),
          size_bytes: obj.sizeBytes,
          content_type: 'application/octet-stream',
          etag: obj.etag,
          last_modified: obj.lastModified,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (hasSearch) {
      prefixItems = prefixItems.filter((item) => item.name.toLowerCase().includes(normalizedSearch));
      objectItems = objectItems.filter((item) => item.name.toLowerCase().includes(normalizedSearch));
    }

    if (sortBy === 'size_bytes') {
      objectItems = objectItems.slice().sort((a, b) => (a.size_bytes - b.size_bytes) * sortFactor);
    } else if (sortBy === 'last_modified') {
      objectItems = objectItems.slice().sort((a, b) => a.last_modified.localeCompare(b.last_modified) * sortFactor);
    } else {
      prefixItems = prefixItems.slice().sort((a, b) => a.name.localeCompare(b.name) * sortFactor);
      objectItems = objectItems.slice().sort((a, b) => a.name.localeCompare(b.name) * sortFactor);
    }

    return ListFileLibraryObjectsResponseSchema.parse({
      prefix,
      items: [...prefixItems, ...objectItems],
      next_continuation_token: listed.nextContinuationToken,
    });
  }
}

export class CreateFileLibraryFolderUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: CreateFileLibraryFolderCommand): Promise<void> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = CreateFileLibraryObjectFolderRequestSchema.parse(command.input);
    const prefix = normalizePrefix(input.prefix);
    if (!prefix) {
      throw new Error('invalid_prefix');
    }
    await this.objectStore.putObject(
      this.bucket,
      joinObjectKey(library.object_prefix, prefix),
      new Uint8Array(0),
      'application/x-directory',
    );
  }
}

export class UploadFileLibraryObjectUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly bucket: string,
  ) {}

  async execute(command: UploadFileLibraryObjectCommand): Promise<UploadFileLibraryObjectResponse> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const prefix = normalizePrefix(command.prefix);
    const fileName = basenameFromKey(normalizeKey(command.fileName));
    const key = joinObjectKey(library.object_prefix, `${prefix}${fileName}`);
    if (command.overwrite !== true) {
      try {
        await this.objectStore.statObject(this.bucket, key);
        throw new Error('destination_exists');
      } catch (error) {
        if (error instanceof Error && error.message === 'destination_exists') {
          throw error;
        }
      }
    }
    await this.objectStore.putObjectStream(this.bucket, key, command.fileStream, {
      contentType: command.contentType ?? 'application/octet-stream',
      sizeBytes: command.contentLength,
      signal: command.signal,
    });
    const stat = await this.objectStore.statObject(this.bucket, key);
    return UploadFileLibraryObjectResponseSchema.parse({
      key: stripObjectPrefix(key, library.object_prefix),
      size_bytes: stat.sizeBytes,
      content_type: stat.contentType ?? 'application/octet-stream',
      etag: stat.etag,
      last_modified: stat.lastModified ?? this.clock.nowIso(),
    });
  }
}

export class DownloadFileLibraryObjectUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DownloadFileLibraryObjectCommand): Promise<{
    key: string;
    body: WebReadableStream<Uint8Array>;
    cancel: (reason?: unknown) => Promise<void>;
    contentType: string;
    sizeBytes?: number;
    etag?: string;
    lastModified?: string;
  }> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const key = normalizeKey(command.key);
    const object = await this.objectStore.getObjectStream(
      this.bucket,
      joinObjectKey(library.object_prefix, key),
    );
    return {
      key,
      body: object.body,
      cancel: object.cancel,
      contentType: object.contentType ?? 'application/octet-stream',
      sizeBytes: object.sizeBytes,
      etag: object.etag,
      lastModified: object.lastModified,
    };
  }
}

export class CreateFileLibraryObjectShareLinkUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly bucket: string,
  ) {}

  async execute(command: CreateFileLibraryObjectShareLinkCommand): Promise<FileLibraryObjectShareLinkResponse> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = FileLibraryObjectShareLinkCreateRequestSchema.parse(command.input);
    const key = normalizeKey(input.key);
    const expiresInSeconds = input.expires_in_seconds ?? 900;
    const fullKey = joinObjectKey(library.object_prefix, key);
    await this.objectStore.statObject(this.bucket, fullKey);
    const url = await this.objectStore.presignedGetObject(
      this.bucket,
      fullKey,
      expiresInSeconds,
    );
    const now = this.clock.nowIso();
    return FileLibraryObjectShareLinkResponseSchema.parse({
      key,
      url,
      expires_at: addSecondsToIso(now, expiresInSeconds),
      expires_in_seconds: expiresInSeconds,
    });
  }
}

export class DeleteFileLibraryObjectsUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DeleteFileLibraryObjectsCommand): Promise<DeleteFileLibraryObjectsResponse> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = DeleteFileLibraryObjectsRequestSchema.parse(command.input);
    const results: DeleteFileLibraryObjectsResponse['results'] = [];

    for (const rawKey of input.keys) {
      const key = normalizeKey(rawKey);
      if (key.endsWith('/')) {
        const fullPrefix = joinObjectKey(library.object_prefix, key);
        const listed = await this.objectStore.listObjects(this.bucket, {
          prefix: fullPrefix,
          pageSize: 1000,
        });
        const keysToDelete = listed.objects.map((obj) => obj.key);
        if (keysToDelete.length > 0) {
          await this.objectStore.deleteMany(this.bucket, keysToDelete);
        }
        results.push({ key, status: 'deleted' });
      } else {
        await this.objectStore.deleteObject(this.bucket, joinObjectKey(library.object_prefix, key));
        results.push({ key, status: 'deleted' });
      }
    }

    return { results };
  }
}

export class MoveFileLibraryObjectUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: MoveFileLibraryObjectCommand): Promise<void> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = MoveFileLibraryObjectRequestSchema.parse(command.input);
    const fromKey = normalizeKey(input.from_key);
    const toKey = normalizeKey(input.to_key);
    const overwrite = input.overwrite === true;
    if (fromKey.endsWith('/')) {
      const listed = await this.objectStore.listObjects(this.bucket, {
        prefix: joinObjectKey(library.object_prefix, fromKey),
        pageSize: 1000,
      });
      for (const obj of listed.objects) {
        const relative = stripObjectPrefix(obj.key, library.object_prefix);
        const suffix = relative.slice(fromKey.length);
        const target = `${toKey.endsWith('/') ? toKey : `${toKey}/`}${suffix}`;
        await this.objectStore.copyObject(
          this.bucket,
          obj.key,
          joinObjectKey(library.object_prefix, target),
          { overwrite },
        );
        await this.objectStore.deleteObject(this.bucket, obj.key);
      }
      return;
    }

    await this.objectStore.copyObject(
      this.bucket,
      joinObjectKey(library.object_prefix, fromKey),
      joinObjectKey(library.object_prefix, toKey),
      { overwrite },
    );
    await this.objectStore.deleteObject(this.bucket, joinObjectKey(library.object_prefix, fromKey));
  }
}

export class GetFileLibraryObjectMetaUseCase {
  constructor(
    private readonly fileLibraryCatalogRepo: FileLibraryCatalogRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: GetFileLibraryObjectMetaCommand): Promise<FileLibraryObjectMetaResponse> {
    const library = ensureLibrary(await this.fileLibraryCatalogRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const key = normalizeKey(command.key);
    const stat = await this.objectStore.statObject(
      this.bucket,
      joinObjectKey(library.object_prefix, key),
    );
    return FileLibraryObjectMetaResponseSchema.parse({
      key,
      size_bytes: stat.sizeBytes,
      content_type: stat.contentType ?? 'application/octet-stream',
      etag: stat.etag,
      last_modified: stat.lastModified,
      user_metadata: stat.metadata ?? {},
    });
  }
}
