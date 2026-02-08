import {
  CreateProjectRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  UpdateSourceLibraryRequestSchema,
  UpdateProjectRequestSchema,
  type CreateSourceLibraryRequest,
  type CreateProjectRequest,
  type CreateSourceRequest,
  type ListProjectsResponse,
  type ListSourceLibrariesResponse,
  type ListSourcesResponse,
  type ProjectDTO,
  type SourceLibraryDTO,
  type SourceDTO,
  type UpdateSourceLibraryRequest,
  type UpdateProjectRequest,
} from '@mbos/contracts';
import { Project } from '@mbos/domain';
import type {
  CachePort,
  ClockPort,
  IdGeneratorPort,
  ObjectStorePort,
  ProjectRepoPort,
  SourceRepoPort,
  SourceLibraryRepoPort,
} from '@mbos/ports';

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

export interface DeleteProjectCommand extends GetProjectCommand {}

export interface CreateSourceCommand {
  workspaceId: string;
  projectId: string;
  input: CreateSourceRequest;
}

export interface ListSourcesCommand {
  workspaceId: string;
  projectId: string;
}

export interface DeleteSourceCommand {
  workspaceId: string;
  projectId: string;
  sourceId: string;
}

export interface GetSourceCommand extends DeleteSourceCommand {}

export interface DownloadSourceCommand extends DeleteSourceCommand {}

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

    if (input.visibility !== undefined) {
      patch.visibility = input.visibility;
    }

    if (input.join_policy !== undefined) {
      patch.join_policy = input.join_policy;
    }

    if (input.status !== undefined) {
      patch.status = input.status;
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

function sourcesCacheKey(workspaceId: string, projectId: string): string {
  return `sources:${workspaceId}:${projectId}`;
}

function sourceLibrariesCacheKey(workspaceId: string, projectId: string): string {
  return `source_libraries:${workspaceId}:${projectId}`;
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
    const cacheKey = sourcesCacheKey(command.workspaceId, command.projectId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ListSourcesResponse;
    }

    const items = await this.sourceRepo.listByProject(command.workspaceId, command.projectId);
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
      name: input.name.trim(),
      object_key: objectKey,
      content_type: input.content_type,
      size_bytes: content.byteLength,
      status: 'ready',
      created_at: now,
      updated_at: now,
    };

    await this.sourceRepo.save(source);
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
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
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
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

export interface SourcesQuotaSummary {
  storage: { used: number; limit: number };
  docdb: { used: number; limit: number };
  vectordb: { used: number; limit: number };
}

export class GetSourcesQuotaUseCase {
  constructor(private readonly sourceRepo: SourceRepoPort) {}

  async execute(command: ListSourcesCommand): Promise<SourcesQuotaSummary> {
    const sources = await this.sourceRepo.listByProject(
      command.workspaceId,
      command.projectId,
    );
    const storageUsed = sources.reduce((acc, item) => acc + item.size_bytes, 0);

    return {
      storage: { used: storageUsed, limit: 1_073_741_824 },
      docdb: { used: 0, limit: 536_870_912 },
      vectordb: { used: 0, limit: 536_870_912 },
    };
  }
}

export class ListSourceLibrariesUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: ListSourceLibrariesCommand): Promise<ListSourceLibrariesResponse> {
    const cacheKey = sourceLibrariesCacheKey(command.workspaceId, command.projectId);
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
    const library: SourceLibraryDTO = {
      id: this.idGenerator.nextProjectId().replace(/^proj_/, 'lib_'),
      workspace_id: command.workspaceId,
      project_id: command.projectId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      visibility: 'shared',
      created_by_user_id: command.actorId,
      created_at: now,
      updated_at: now,
    };

    await this.sourceLibraryRepo.save(library);
    await this.cache.del(sourceLibrariesCacheKey(command.workspaceId, command.projectId));
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

    await this.cache.del(sourceLibrariesCacheKey(command.workspaceId, command.projectId));
    return updated;
  }
}

export class DeleteSourceLibraryUseCase {
  constructor(
    private readonly sourceLibraryRepo: SourceLibraryRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: DeleteSourceLibraryCommand): Promise<void> {
    const deleted = await this.sourceLibraryRepo.delete(
      command.workspaceId,
      command.projectId,
      command.libraryId,
    );
    if (!deleted) {
      throw new Error('source_library_not_found');
    }

    await this.cache.del(sourceLibrariesCacheKey(command.workspaceId, command.projectId));
  }
}
