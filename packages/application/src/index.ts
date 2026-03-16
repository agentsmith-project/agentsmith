import {
  AIReadyJobSchema,
  CreateAIReadyJobRequestSchema,
  CreateSourceFolderRequestSchema,
  CreateProjectRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  DeleteSourceObjectsRequestSchema,
  ListSourceObjectsResponseSchema,
  MoveSourceObjectRequestSchema,
  SourceObjectShareLinkCreateRequestSchema,
  SourceObjectShareLinkResponseSchema,
  SourceObjectMetaResponseSchema,
  UploadSourceObjectResponseSchema,
  UpdateSourceLibraryRequestSchema,
  UpdateProjectRequestSchema,
  type AIReadyJobDTO,
  type CreateAIReadyJobRequest,
  type CreateSourceFolderRequest,
  type CreateSourceLibraryRequest,
  type CreateProjectRequest,
  type CreateSourceRequest,
  type DeleteSourceObjectsRequest,
  type DeleteSourceObjectsResponse,
  type ListSourceObjectsResponse,
  type MoveSourceObjectRequest,
  type ListProjectsResponse,
  type ListSourceLibrariesResponse,
  type ListSourcesResponse,
  type ProjectDTO,
  type SourceObjectShareLinkCreateRequest,
  type SourceObjectShareLinkResponse,
  type SourceObjectMetaResponse,
  type SourceLibraryDTO,
  type SourceDTO,
  type UpdateSourceLibraryRequest,
  type UpdateProjectRequest,
  type UploadSourceObjectResponse,
} from '@mbos/contracts';
import { Project } from '@mbos/domain';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
  AIReadyJobRepoPort,
  CachePort,
  ClockPort,
  DocumentParserPort,
  EmbeddingProviderPort,
  IdGeneratorPort,
  JobQueueItem,
  JobQueuePort,
  ObjectStorePort,
  ProjectRepoPort,
  SourceRepoPort,
  SourceLibraryRepoPort,
  TextChunkerPort,
  VectorChunkUpsert,
  VectorStorePort,
} from '@mbos/ports';
import {
  buildAiReadyJobCacheKey,
  buildFileLibrariesCacheKey,
  buildSourcesCacheKey,
} from './cache-keys';

export interface CreateProjectCommand {
  workspaceId: string;
  actorId: string;
  input: CreateProjectRequest;
}

export interface GetProjectCommand {
  workspaceId: string;
  projectId: string;
}

export interface UpdateProjectCommand extends GetProjectCommand {
  input: UpdateProjectRequest;
}

export type DeleteProjectCommand = GetProjectCommand;

export interface CreateSourceCommand {
  workspaceId: string;
  projectId: string;
  input: CreateSourceRequest;
}

export interface ListSourcesCommand {
  workspaceId: string;
  projectId: string;
  libraryId?: string;
}

export interface DeleteSourceCommand {
  workspaceId: string;
  projectId: string;
  sourceId: string;
}

export type GetSourceCommand = DeleteSourceCommand;

export type DownloadSourceCommand = DeleteSourceCommand;

export interface ListSourceLibrariesCommand {
  workspaceId: string;
  projectId: string;
}

export interface CreateSourceLibraryCommand extends ListSourceLibrariesCommand {
  actorId: string;
  input: CreateSourceLibraryRequest;
}

export interface UpdateSourceLibraryCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  input: UpdateSourceLibraryRequest;
}

export interface DeleteSourceLibraryCommand extends ListSourceLibrariesCommand {
  libraryId: string;
}

export interface ListSourceLibraryObjectsCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  prefix?: string;
  delimiter?: string;
  pageSize?: number;
  continuationToken?: string;
  search?: string;
  sortBy?: 'name' | 'size_bytes' | 'last_modified';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateSourceFolderCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  input: CreateSourceFolderRequest;
}

export interface UploadSourceObjectCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  fileName: string;
  fileStream: WebReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
  prefix?: string;
  overwrite?: boolean;
}

export interface DeleteSourceObjectsCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  input: DeleteSourceObjectsRequest;
}

export interface MoveSourceObjectCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  input: MoveSourceObjectRequest;
}

export interface GetSourceObjectMetaCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  key: string;
}

export type DownloadSourceObjectCommand = GetSourceObjectMetaCommand;

export interface CreateSourceObjectShareLinkCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  input: SourceObjectShareLinkCreateRequest;
}

export interface SourceAIReadyJob {
  id: string;
  source_file_id: string;
  status: 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';
  progress?: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAIReadyJobCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  actorId: string;
  input: CreateAIReadyJobRequest;
  idempotencyKey?: string;
}

export interface GetAIReadyJobCommand extends ListSourceLibrariesCommand {
  libraryId: string;
  jobId: string;
}

export type CancelAIReadyJobCommand = GetAIReadyJobCommand;
export type RunQueuedAIReadyJobCommand = GetAIReadyJobCommand;

export class ListProjectsUseCase {
  constructor(private readonly projectRepo: ProjectRepoPort) {}

  async execute(workspaceId: string): Promise<ListProjectsResponse> {
    const items = await this.projectRepo.listByWorkspace(workspaceId);
    return { items };
  }
}

export class GetProjectUseCase {
  constructor(private readonly projectRepo: ProjectRepoPort) {}

  async execute(command: GetProjectCommand): Promise<ProjectDTO> {
    const found = await this.projectRepo.getById(command.workspaceId, command.projectId);
    if (!found) {
      throw new Error('project_not_found');
    }

    return found;
  }
}

export class CreateProjectUseCase {
  constructor(
    private readonly projectRepo: ProjectRepoPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: CreateProjectCommand): Promise<ProjectDTO> {
    const input = CreateProjectRequestSchema.parse(command.input);
    const now = this.clock.nowIso();

    const project = Project.create({
      id: this.idGenerator.nextProjectId(),
      workspaceId: command.workspaceId,
      ownerId: command.actorId,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      joinPolicy: input.join_policy,
      now,
    }).toDTO();

    await this.projectRepo.save(project);
    return project;
  }
}

export class UpdateProjectUseCase {
  constructor(
    private readonly projectRepo: ProjectRepoPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: UpdateProjectCommand): Promise<ProjectDTO> {
    const input = UpdateProjectRequestSchema.parse(command.input);

    const patch: Partial<ProjectDTO> = {
      updated_at: this.clock.nowIso(),
    };

    if (input.name !== undefined) {
      const normalizedName = input.name.trim();
      if (!normalizedName) {
        throw new Error('project_name_required');
      }
      patch.name = normalizedName;
    }

    if (input.description !== undefined) {
      patch.description = input.description.trim();
    }

    if (input.owner_id !== undefined) {
      const normalizedOwnerId = input.owner_id.trim();
      if (!normalizedOwnerId) {
        throw new Error('project_owner_required');
      }
      patch.owner_id = normalizedOwnerId;
    }

    if (input.visibility !== undefined) {
      patch.visibility = input.visibility;
    }

    if (input.join_policy !== undefined) {
      patch.join_policy = input.join_policy;
    }

    if (input.status !== undefined) {
      patch.status = input.status;
    }

    if (input.governance_json !== undefined) {
      patch.governance_json = input.governance_json;
    }

    if (input.execution_preferences_json !== undefined) {
      patch.execution_preferences_json = input.execution_preferences_json;
    }

    if (input.limits_json !== undefined) {
      patch.limits_json = input.limits_json;
    }

    const updated = await this.projectRepo.update(command.workspaceId, command.projectId, patch);
    if (!updated) {
      throw new Error('project_not_found');
    }

    return updated;
  }
}

export class DeleteProjectUseCase {
  constructor(private readonly projectRepo: ProjectRepoPort) {}

  async execute(command: DeleteProjectCommand): Promise<void> {
    const deleted = await this.projectRepo.delete(command.workspaceId, command.projectId);
    if (!deleted) {
      throw new Error('project_not_found');
    }
  }
}

function sourceLibraryTuple(workspaceId: string, projectId: string, libraryId: string): {
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
  library: SourceLibraryDTO | null,
): SourceLibraryDTO & { object_prefix: string } {
  if (!library) {
    throw new Error('source_library_not_found');
  }
  if (!library.object_prefix) {
    throw new Error('source_library_prefix_missing');
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

function decodeBase64(value: string): Uint8Array {
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

export class ListSourcesUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: ListSourcesCommand): Promise<ListSourcesResponse> {
    const cacheKey = buildSourcesCacheKey(command.workspaceId, command.projectId, command.libraryId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ListSourcesResponse;
    }

    const items = await this.sourceRepo.listByProject(command.workspaceId, command.projectId, {
      libraryId: command.libraryId,
    });
    const payload: ListSourcesResponse = { items };
    await this.cache.set(cacheKey, JSON.stringify(payload), 30);
    return payload;
  }
}

export class CreateSourceUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
    private readonly bucket: string,
  ) {}

  async execute(command: CreateSourceCommand): Promise<SourceDTO> {
    const input = CreateSourceRequestSchema.parse(command.input);
    const sourceId = this.idGenerator.nextProjectId().replace(/^proj_/, 'src_');
    const now = this.clock.nowIso();
    const content = decodeBase64(input.content_base64);
    const objectKey = `${command.workspaceId}/${command.projectId}/${sourceId}/${input.name}`;

    await this.objectStore.putObject(
      this.bucket,
      objectKey,
      content,
      input.content_type,
    );

    const source: SourceDTO = {
      id: sourceId,
      workspace_id: command.workspaceId,
      project_id: command.projectId,
      library_id: input.library_id,
      name: input.name.trim(),
      object_key: objectKey,
      content_type: input.content_type,
      size_bytes: content.byteLength,
      status: 'ready',
      ai_ready_status: 'idle',
      docdb_bytes: 0,
      vectordb_bytes: 0,
      created_at: now,
      updated_at: now,
    };

    await this.sourceRepo.save(source);
    await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId));
    if (input.library_id) {
      await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId, input.library_id));
    }
    return source;
  }
}

export class GetSourceUseCase {
  constructor(private readonly sourceRepo: SourceRepoPort) {}

  async execute(command: GetSourceCommand): Promise<SourceDTO> {
    const source = await this.sourceRepo.getById(
      command.workspaceId,
      command.projectId,
      command.sourceId,
    );
    if (!source) {
      throw new Error('source_not_found');
    }
    return source;
  }
}

export class DeleteSourceUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly cache: CachePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DeleteSourceCommand): Promise<void> {
    const existing = await this.sourceRepo.getById(
      command.workspaceId,
      command.projectId,
      command.sourceId,
    );
    if (!existing) {
      throw new Error('source_not_found');
    }

    await this.objectStore.deleteObject(this.bucket, existing.object_key);
    await this.sourceRepo.delete(command.workspaceId, command.projectId, command.sourceId);
    await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId));
    if (existing.library_id) {
      await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId, existing.library_id));
    }
  }
}

export interface SourceDownloadResult {
  source: SourceDTO;
  body: Uint8Array;
}

export class DownloadSourceUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DownloadSourceCommand): Promise<SourceDownloadResult> {
    const source = await this.sourceRepo.getById(
      command.workspaceId,
      command.projectId,
      command.sourceId,
    );
    if (!source) {
      throw new Error('source_not_found');
    }

    const body = await this.objectStore.getObject(this.bucket, source.object_key);
    return { source, body };
  }
}

export interface SourcesLimitSummary {
  storage: { used: number; limit: number };
  docdb: { used: number; limit: number };
  vectordb: { used: number; limit: number };
}

export class GetSourcesLimitUseCase {
  constructor(private readonly sourceRepo: SourceRepoPort) {}

  async execute(command: ListSourcesCommand): Promise<SourcesLimitSummary> {
    const sources = await this.sourceRepo.listByProject(
      command.workspaceId,
      command.projectId,
      { libraryId: command.libraryId },
    );
    const storageUsed = sources.reduce((acc, item) => acc + item.size_bytes, 0);
    const docdbUsed = sources.reduce((acc, item) => acc + (item.docdb_bytes ?? 0), 0);
    const vectordbUsed = sources.reduce((acc, item) => acc + (item.vectordb_bytes ?? 0), 0);

    return {
      storage: { used: storageUsed, limit: 1_073_741_824 },
      docdb: { used: docdbUsed, limit: 536_870_912 },
      vectordb: { used: vectordbUsed, limit: 536_870_912 },
    };
  }
}

export class ListSourceLibrariesUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: ListSourceLibrariesCommand): Promise<ListSourceLibrariesResponse> {
    const cacheKey = buildFileLibrariesCacheKey(command.workspaceId, command.projectId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ListSourceLibrariesResponse;
    }

    const items = await this.sourceLibraryRepo.listByProject(
      command.workspaceId,
      command.projectId,
    );
    const payload: ListSourceLibrariesResponse = { items };
    await this.cache.set(cacheKey, JSON.stringify(payload), 30);
    return payload;
  }
}

export class CreateSourceLibraryUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: CreateSourceLibraryCommand): Promise<SourceLibraryDTO> {
    const input = CreateSourceLibraryRequestSchema.parse(command.input);
    const now = this.clock.nowIso();
    const libraryId = this.idGenerator.nextProjectId().replace(/^proj_/, 'lib_');
    const tuple = sourceLibraryTuple(command.workspaceId, command.projectId, libraryId);
    const library: SourceLibraryDTO = {
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

    await this.sourceLibraryRepo.save(library);
    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
    return library;
  }
}

export class UpdateSourceLibraryUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: UpdateSourceLibraryCommand): Promise<SourceLibraryDTO> {
    const input = UpdateSourceLibraryRequestSchema.parse(command.input);
    const patch: Partial<SourceLibraryDTO> = {
      updated_at: this.clock.nowIso(),
    };
    if (input.name !== undefined) {
      patch.name = input.name.trim();
    }
    if (input.description !== undefined) {
      patch.description = input.description.trim();
    }

    const updated = await this.sourceLibraryRepo.update(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      patch,
    );
    if (!updated) {
      throw new Error('source_library_not_found');
    }

    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
    return updated;
  }
}

export class DeleteSourceLibraryUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly cache: CachePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DeleteSourceLibraryCommand): Promise<void> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
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

    const deleted = await this.sourceLibraryRepo.delete(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    );
    if (!deleted) {
      throw new Error('source_library_not_found');
    }

    await this.cache.del(buildFileLibrariesCacheKey(command.workspaceId, command.projectId));
  }
}

export class ListSourceLibraryObjectsUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: ListSourceLibraryObjectsCommand): Promise<ListSourceObjectsResponse> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
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
        // Hide folder marker objects (e.g. "docs/" zero-byte placeholders).
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

    return ListSourceObjectsResponseSchema.parse({
      prefix,
      items: [...prefixItems, ...objectItems],
      next_continuation_token: listed.nextContinuationToken,
    });
  }
}

export class CreateSourceFolderUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: CreateSourceFolderCommand): Promise<void> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = CreateSourceFolderRequestSchema.parse(command.input);
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

export class UploadSourceObjectUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly bucket: string,
  ) {}

  async execute(command: UploadSourceObjectCommand): Promise<UploadSourceObjectResponse> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
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
    });
    const stat = await this.objectStore.statObject(this.bucket, key);
    return UploadSourceObjectResponseSchema.parse({
      key: stripObjectPrefix(key, library.object_prefix),
      size_bytes: stat.sizeBytes,
      content_type: stat.contentType ?? 'application/octet-stream',
      etag: stat.etag,
      last_modified: stat.lastModified ?? this.clock.nowIso(),
    });
  }
}

export class DownloadSourceObjectUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DownloadSourceObjectCommand): Promise<{
    key: string;
    body: WebReadableStream<Uint8Array>;
    contentType: string;
    sizeBytes?: number;
    etag?: string;
    lastModified?: string;
  }> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
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
      contentType: object.contentType ?? 'application/octet-stream',
      sizeBytes: object.sizeBytes,
      etag: object.etag,
      lastModified: object.lastModified,
    };
  }
}

export class CreateSourceObjectShareLinkUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly bucket: string,
  ) {}

  async execute(command: CreateSourceObjectShareLinkCommand): Promise<SourceObjectShareLinkResponse> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = SourceObjectShareLinkCreateRequestSchema.parse(command.input);
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
    return SourceObjectShareLinkResponseSchema.parse({
      key,
      url,
      expires_at: addSecondsToIso(now, expiresInSeconds),
      expires_in_seconds: expiresInSeconds,
    });
  }
}

export class DeleteSourceObjectsUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: DeleteSourceObjectsCommand): Promise<DeleteSourceObjectsResponse> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = DeleteSourceObjectsRequestSchema.parse(command.input);
    const results: DeleteSourceObjectsResponse['results'] = [];

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

export class MoveSourceObjectUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: MoveSourceObjectCommand): Promise<void> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const input = MoveSourceObjectRequestSchema.parse(command.input);
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

export class GetSourceObjectMetaUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly bucket: string,
  ) {}

  async execute(command: GetSourceObjectMetaCommand): Promise<SourceObjectMetaResponse> {
    const library = ensureLibrary(await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    ));
    const key = normalizeKey(command.key);
    const stat = await this.objectStore.statObject(
      this.bucket,
      joinObjectKey(library.object_prefix, key),
    );
    return SourceObjectMetaResponseSchema.parse({
      key,
      size_bytes: stat.sizeBytes,
      content_type: stat.contentType ?? 'application/octet-stream',
      etag: stat.etag,
      last_modified: stat.lastModified,
      user_metadata: stat.metadata ?? {},
    });
  }
}

export type SourceAIReadyCommand = DeleteSourceCommand;

export interface SourceBatchAIReadyCommand {
  workspaceId: string;
  projectId: string;
  sourceIds: string[];
}

function buildSourceJob(sourceId: string, now: string, status: SourceAIReadyJob['status']): SourceAIReadyJob {
  return {
    id: `ai_ready_${sourceId}_${Date.now()}`,
    source_file_id: sourceId,
    status,
    progress: status === 'ready' ? 100 : 0,
    created_at: now,
    updated_at: now,
  };
}

export class StartSourceAIReadyUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: SourceAIReadyCommand): Promise<SourceAIReadyJob> {
    const source = await this.sourceRepo.getById(command.workspaceId, command.projectId, command.sourceId);
    if (!source) {
      throw new Error('source_not_found');
    }
    const now = this.clock.nowIso();
    const docdbBytes = Math.max(1, Math.floor(source.size_bytes * 0.75));
    const vectordbBytes = Math.max(1, Math.floor(source.size_bytes * 1.25));
    await this.sourceRepo.update(command.workspaceId, command.projectId, command.sourceId, {
      ai_ready_status: 'ready',
      docdb_bytes: docdbBytes,
      vectordb_bytes: vectordbBytes,
      updated_at: now,
    });
    await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId));
    if (source.library_id) {
      await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId, source.library_id));
    }
    return buildSourceJob(command.sourceId, now, 'ready');
  }
}

export class CancelSourceAIReadyUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: SourceAIReadyCommand): Promise<SourceAIReadyJob> {
    const source = await this.sourceRepo.getById(command.workspaceId, command.projectId, command.sourceId);
    if (!source) {
      throw new Error('source_not_found');
    }
    const now = this.clock.nowIso();
    await this.sourceRepo.update(command.workspaceId, command.projectId, command.sourceId, {
      ai_ready_status: 'cancelled',
      docdb_bytes: 0,
      vectordb_bytes: 0,
      updated_at: now,
    });
    await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId));
    if (source.library_id) {
      await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId, source.library_id));
    }
    return buildSourceJob(command.sourceId, now, 'cancelled');
  }
}

export class RetrySourceAIReadyUseCase {
  constructor(private readonly startUseCase: StartSourceAIReadyUseCase) {}

  async execute(command: SourceAIReadyCommand): Promise<SourceAIReadyJob> {
    return this.startUseCase.execute(command);
  }
}

export class BatchStartSourceAIReadyUseCase {
  constructor(private readonly startUseCase: StartSourceAIReadyUseCase) {}

  async execute(command: SourceBatchAIReadyCommand): Promise<{ jobs: SourceAIReadyJob[] }> {
    const jobs = await Promise.all(
      command.sourceIds.map((sourceId) =>
        this.startUseCase.execute({
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          sourceId,
        }),
      ),
    );
    return { jobs };
  }
}

export class BatchCancelSourceAIReadyUseCase {
  constructor(private readonly cancelUseCase: CancelSourceAIReadyUseCase) {}

  async execute(command: SourceBatchAIReadyCommand): Promise<{ jobs: SourceAIReadyJob[] }> {
    const jobs = await Promise.all(
      command.sourceIds.map((sourceId) =>
        this.cancelUseCase.execute({
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          sourceId,
        }),
      ),
    );
    return { jobs };
  }
}

function buildAIReadyJobId(libraryId: string, nowIso: string): string {
  return `airj_${libraryId}_${Date.parse(nowIso)}`;
}

export class CreateAIReadyJobUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly jobRepo: AIReadyJobRepoPort,
    private readonly queue: JobQueuePort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: CreateAIReadyJobCommand): Promise<AIReadyJobDTO> {
    const input = CreateAIReadyJobRequestSchema.parse(command.input);
    const library = await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    );
    if (!library) {
      throw new Error('source_library_not_found');
    }

    for (const sourceId of input.source_ids) {
      const source = await this.sourceRepo.getById(command.workspaceId, command.projectId, sourceId);
      if (!source) {
        throw new Error('source_not_found');
      }
      if (source.library_id !== command.libraryId) {
        throw new Error('source_library_mismatch');
      }
    }

    const now = this.clock.nowIso();
    const job: AIReadyJobDTO = AIReadyJobSchema.parse({
      id: buildAIReadyJobId(command.libraryId, now),
      workspace_id: command.workspaceId,
      project_id: command.projectId,
      library_id: command.libraryId,
      type: 'document_ingest',
      status: 'queued',
      source_ids: input.source_ids,
      idempotency_key:
        command.idempotencyKey ??
        `airj:${command.workspaceId}:${command.projectId}:${command.libraryId}:${input.source_ids.join(',')}`,
      retry_count: 0,
      created_by_user_id: command.actorId,
      created_at: now,
      updated_at: now,
    });

    await this.jobRepo.save(job);
    await this.queue.enqueue({
      jobId: job.id,
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      libraryId: command.libraryId,
      type: 'document_ingest',
    });
    await this.cache.del(buildAiReadyJobCacheKey(command.workspaceId, command.projectId, command.libraryId));
    return job;
  }
}

export class GetAIReadyJobUseCase {
  constructor(
    private readonly jobRepo: AIReadyJobRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: GetAIReadyJobCommand): Promise<AIReadyJobDTO> {
    const cacheKey = buildAiReadyJobCacheKey(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
    );
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AIReadyJobDTO;
    }
    const job = await this.jobRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
    );
    if (!job) {
      throw new Error('ai_ready_job_not_found');
    }
    await this.cache.set(cacheKey, JSON.stringify(job), 15);
    return job;
  }
}

export class CancelAIReadyJobUseCase {
  constructor(
    private readonly jobRepo: AIReadyJobRepoPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: CancelAIReadyJobCommand): Promise<AIReadyJobDTO> {
    const now = this.clock.nowIso();
    const updated = await this.jobRepo.update(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
      {
        status: 'cancelled',
        updated_at: now,
      },
    );
    if (!updated) {
      throw new Error('ai_ready_job_not_found');
    }
    const cacheKey = buildAiReadyJobCacheKey(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
    );
    await this.cache.del(cacheKey);
    return updated;
  }
}

export class RunQueuedAIReadyJobUseCase {
  constructor(
    private readonly sourceRepo: SourceRepoPort,
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly jobRepo: AIReadyJobRepoPort,
    private readonly objectStore: ObjectStorePort,
    private readonly parser: DocumentParserPort,
    private readonly chunker: TextChunkerPort,
    private readonly embeddings: EmbeddingProviderPort,
    private readonly vectorStore: VectorStorePort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
    private readonly sourceBucket: string,
  ) {}

  async execute(command: RunQueuedAIReadyJobCommand): Promise<AIReadyJobDTO> {
    const library = await this.sourceLibraryRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    );
    if (!library) {
      throw new Error('source_library_not_found');
    }

    const existing = await this.jobRepo.getById(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
    );
    if (!existing) {
      throw new Error('ai_ready_job_not_found');
    }
    if (existing.status === 'cancelled') {
      return existing;
    }

    const startedAt = this.clock.nowIso();
    const running = await this.jobRepo.update(
      command.workspaceId,
      command.projectId,
      command.libraryId,
      command.jobId,
      {
        status: 'running',
        updated_at: startedAt,
      },
    );
    if (!running) {
      throw new Error('ai_ready_job_not_found');
    }

    try {
      for (const sourceId of running.source_ids) {
        const source = await this.sourceRepo.getById(command.workspaceId, command.projectId, sourceId);
        if (!source) {
          throw new Error('source_not_found');
        }
        if (source.library_id !== command.libraryId) {
          throw new Error('source_library_mismatch');
        }

        const fileBody = await this.objectStore.getObject(this.sourceBucket, source.object_key);
        const text = await this.parser.parse(fileBody, source.content_type);
        const chunks = this.chunker.chunk(text);
        const texts = chunks.map((chunk) => chunk.content);
        const vectors = texts.length > 0 ? await this.embeddings.embed(texts) : [];

        const payload: VectorChunkUpsert[] = chunks.map((chunk, index) => ({
          // texts and vectors are generated in lockstep.
          chunkId: `${source.id}_c_${index + 1}`,
          sourceId: source.id,
          content: chunk.content,
          embedding: vectors[index] ?? new Array(this.embeddings.dimensions()).fill(0),
          metadata: {
            ...(chunk.metadata ?? {}),
            source_name: source.name,
            object_key: source.object_key,
          },
        }));

        await this.vectorStore.deleteBySource(
          command.workspaceId,
          command.projectId,
          command.libraryId,
          source.id,
        );
        if (payload.length > 0) {
          await this.vectorStore.upsertChunks(
            command.workspaceId,
            command.projectId,
            command.libraryId,
            payload,
          );
        }

        const now = this.clock.nowIso();
        const docdbBytes = Math.max(1, new TextEncoder().encode(text).byteLength);
        const vectordbBytes = payload.length * this.embeddings.dimensions() * 4;
        await this.sourceRepo.update(command.workspaceId, command.projectId, source.id, {
          ai_ready_status: 'ready',
          docdb_bytes: docdbBytes,
          vectordb_bytes: vectordbBytes,
          updated_at: now,
        });

        await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId));
        await this.cache.del(buildSourcesCacheKey(command.workspaceId, command.projectId, command.libraryId));
      }

      const finishedAt = this.clock.nowIso();
      const succeeded = await this.jobRepo.update(
        command.workspaceId,
        command.projectId,
        command.libraryId,
        command.jobId,
        {
          status: 'succeeded',
          updated_at: finishedAt,
        },
      );
      if (!succeeded) {
        throw new Error('ai_ready_job_not_found');
      }
      return succeeded;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      const failedAt = this.clock.nowIso();
      const failed = await this.jobRepo.update(
        command.workspaceId,
        command.projectId,
        command.libraryId,
        command.jobId,
        {
          status: 'failed',
          error_code: 'DOCUMENT_INGEST_FAILED',
          error_message: message,
          updated_at: failedAt,
        },
      );
      if (!failed) {
        throw new Error('ai_ready_job_not_found');
      }
      return failed;
    }
  }
}

export async function drainJobQueue(
  queue: JobQueuePort,
  runner: (item: JobQueueItem) => Promise<void>,
): Promise<number> {
  let processed = 0;
  // Drain all pending jobs in this tick.
  // Keep loop bounded by queue emptiness.
  for (;;) {
    const next = await queue.dequeue();
    if (!next) {
      break;
    }
    await runner(next);
    processed += 1;
  }
  return processed;
}
