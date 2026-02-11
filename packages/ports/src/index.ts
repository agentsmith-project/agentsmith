import type { AIReadyJobDTO, ProjectDTO, SourceDTO, SourceLibraryDTO } from '@mbos/contracts';
import type { ReadableStream } from 'node:stream/web';

export interface ProjectRepoPort {
  listByWorkspace(workspaceId: string): Promise<ProjectDTO[]>;
  getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null>;
  save(project: ProjectDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null>;
  delete(workspaceId: string, projectId: string): Promise<boolean>;
}

export interface IdGeneratorPort {
  nextProjectId(): string;
}

export interface ClockPort {
  nowIso(): string;
}

export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface JsonDocStorePort {
  get<T>(collection: string, id: string): Promise<T | null>;
  upsert<T>(collection: string, id: string, doc: T): Promise<void>;
  list<T>(collection: string, filter?: Record<string, string>): Promise<T[]>;
  delete(collection: string, id: string): Promise<void>;
}

export interface ObjectStorePort {
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void>;
  putObjectStream(
    bucket: string,
    key: string,
    body: ReadableStream<Uint8Array>,
    options?: {
      contentType?: string;
      sizeBytes?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<void>;
  presignedGetObject(bucket: string, key: string, expirySeconds?: number): Promise<string>;
  getObject(bucket: string, key: string): Promise<Uint8Array>;
  getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    sizeBytes?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
    metadata?: Record<string, string>;
  }>;
  statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }>;
  listObjects(
    bucket: string,
    options: {
      prefix: string;
      delimiter?: string;
      pageSize?: number;
      continuationToken?: string;
    },
  ): Promise<{
    prefix: string;
    objects: Array<{
      key: string;
      sizeBytes: number;
      etag?: string;
      lastModified: string;
    }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }>;
  copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  deleteMany(bucket: string, keys: string[]): Promise<void>;
}

export interface VectorChunkUpsert {
  chunkId: string;
  sourceId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  score: number;
}

export interface VectorSearchQuery {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  queryEmbedding: number[];
  topK: number;
  minScore?: number;
}

export interface VectorStorePort {
  upsertChunks(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    chunks: VectorChunkUpsert[],
  ): Promise<void>;
  deleteBySource(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    sourceId: string,
  ): Promise<void>;
  search(query: VectorSearchQuery): Promise<VectorSearchResult[]>;
  countByLibrary(workspaceId: string, projectId: string, libraryId: string): Promise<number>;
}

export interface JobQueueItem {
  jobId: string;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  type: 'document_ingest';
}

export interface JobQueuePort {
  enqueue(item: JobQueueItem): Promise<void>;
  dequeue(): Promise<JobQueueItem | null>;
}

export interface AIReadyJobRepoPort {
  save(job: AIReadyJobDTO): Promise<void>;
  getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
  ): Promise<AIReadyJobDTO | null>;
  update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
    patch: Partial<AIReadyJobDTO>,
  ): Promise<AIReadyJobDTO | null>;
}

export interface DocumentParserPort {
  parse(body: Uint8Array, contentType: string): Promise<string>;
}

export interface TextChunk {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface TextChunkerPort {
  chunk(text: string): TextChunk[];
}

export interface EmbeddingProviderPort {
  dimensions(): number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface SourceRepoPort {
  listByProject(
    workspaceId: string,
    projectId: string,
    options?: { libraryId?: string },
  ): Promise<SourceDTO[]>;
  getById(workspaceId: string, projectId: string, sourceId: string): Promise<SourceDTO | null>;
  save(source: SourceDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    sourceId: string,
    patch: Partial<SourceDTO>,
  ): Promise<SourceDTO | null>;
  delete(workspaceId: string, projectId: string, sourceId: string): Promise<boolean>;
}

export interface SourceLibraryRepoPort {
  listByProject(workspaceId: string, projectId: string): Promise<SourceLibraryDTO[]>;
  getById(workspaceId: string, projectId: string, libraryId: string): Promise<SourceLibraryDTO | null>;
  save(library: SourceLibraryDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<SourceLibraryDTO>,
  ): Promise<SourceLibraryDTO | null>;
  delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean>;
}
