import {
  AIReadyJobSchema,
  CreateAIReadyJobRequestSchema,
  CreateProjectRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  UpdateSourceLibraryRequestSchema,
  UpdateProjectRequestSchema,
  type AIReadyJobDTO,
  type CreateAIReadyJobRequest,
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

function sourcesCacheKey(workspaceId: string, projectId: string, libraryId?: string): string {
  return `sources:${workspaceId}:${projectId}:${libraryId ?? 'all'}`;
}

function sourceLibrariesCacheKey(workspaceId: string, projectId: string): string {
  return `source_libraries:${workspaceId}:${projectId}`;
}

function sourceLibraryTuple(workspaceId: string, projectId: string, libraryId: string): {
  objectPrefix: string;
  docNamespace: string;
  vectorNamespace: string;
} {
  const scope = `${workspaceId}_${projectId}_${libraryId}`;
  return {
    objectPrefix: `workspaces/${workspaceId}/projects/${projectId}/libraries/${libraryId}`,
    docNamespace: `doc_${scope}`,
    vectorNamespace: `vec_${scope}`,
  };
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
    const cacheKey = sourcesCacheKey(command.workspaceId, command.projectId, command.libraryId);
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
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
    if (input.library_id) {
      await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId, input.library_id));
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
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
    if (existing.library_id) {
      await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId, existing.library_id));
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
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
    if (source.library_id) {
      await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId, source.library_id));
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
    await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
    if (source.library_id) {
      await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId, source.library_id));
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

function aiReadyJobsCacheKey(workspaceId: string, projectId: string, libraryId: string): string {
  return `ai_ready_job:${workspaceId}:${projectId}:${libraryId}`;
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
    await this.cache.del(aiReadyJobsCacheKey(command.workspaceId, command.projectId, command.libraryId));
    return job;
  }
}

export class GetAIReadyJobUseCase {
  constructor(
    private readonly jobRepo: AIReadyJobRepoPort,
    private readonly cache: CachePort,
  ) {}

  async execute(command: GetAIReadyJobCommand): Promise<AIReadyJobDTO> {
    const cacheKey = `${aiReadyJobsCacheKey(command.workspaceId, command.projectId, command.libraryId)}:${command.jobId}`;
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
    const cacheKey = `${aiReadyJobsCacheKey(command.workspaceId, command.projectId, command.libraryId)}:${command.jobId}`;
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

        await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId));
        await this.cache.del(sourcesCacheKey(command.workspaceId, command.projectId, command.libraryId));
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
