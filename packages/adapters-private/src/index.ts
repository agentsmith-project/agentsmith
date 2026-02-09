import type { AIReadyJobDTO, ProjectDTO, SourceDTO, SourceLibraryDTO } from '@mbos/contracts';
import type {
  AIReadyJobRepoPort,
  CachePort,
  ClockPort,
  DocumentParserPort,
  EmbeddingProviderPort,
  IdGeneratorPort,
  JobQueueItem,
  JobQueuePort,
  JsonDocStorePort,
  ObjectStorePort,
  ProjectRepoPort,
  SourceRepoPort,
  SourceLibraryRepoPort,
  TextChunk,
  TextChunkerPort,
  VectorChunkUpsert,
  VectorSearchQuery,
  VectorSearchResult,
  VectorStorePort,
} from '@mbos/ports';
import { MongoClient } from 'mongodb';
import { Client as MinioClient } from 'minio';
import { Pool } from 'pg';
import { Redis as RedisClient } from 'ioredis';

export class SystemClock implements ClockPort {
  nowIso(): string {
    return new Date().toISOString();
  }
}

export class SimpleIdGenerator implements IdGeneratorPort {
  nextProjectId(): string {
    return `proj_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }
}

export class InMemoryProjectRepo implements ProjectRepoPort {
  private readonly projects: ProjectDTO[];

  constructor(initialProjects: ProjectDTO[] = []) {
    this.projects = [...initialProjects];
  }

  async listByWorkspace(workspaceId: string): Promise<ProjectDTO[]> {
    return this.projects.filter((project) => project.workspace_id === workspaceId);
  }

  async getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null> {
    return (
      this.projects.find(
        (project) => project.workspace_id === workspaceId && project.id === projectId,
      ) ?? null
    );
  }

  async save(project: ProjectDTO): Promise<void> {
    this.projects.push(project);
  }

  async update(
    workspaceId: string,
    projectId: string,
    patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null> {
    const index = this.projects.findIndex(
      (project) => project.workspace_id === workspaceId && project.id === projectId,
    );
    if (index < 0) {
      return null;
    }

    this.projects[index] = {
      ...this.projects[index],
      ...patch,
    };

    return this.projects[index];
  }

  async delete(workspaceId: string, projectId: string): Promise<boolean> {
    const index = this.projects.findIndex(
      (project) => project.workspace_id === workspaceId && project.id === projectId,
    );
    if (index < 0) {
      return false;
    }

    this.projects.splice(index, 1);
    return true;
  }
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  join_policy: 'approval_required' | 'open' | null;
  owner_id: string;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

function mapRowToProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description ?? undefined,
    visibility: row.visibility,
    join_policy: row.join_policy ?? undefined,
    owner_id: row.owner_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PostgresProjectRepo implements ProjectRepoPort {
  constructor(private readonly pool: Pool) {}

  async listByWorkspace(workspaceId: string): Promise<ProjectDTO[]> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, workspace_id, name, description, visibility, join_policy, owner_id, status, created_at, updated_at
       FROM projects
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId],
    );
    return result.rows.map(mapRowToProjectDTO);
  }

  async getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, workspace_id, name, description, visibility, join_policy, owner_id, status, created_at, updated_at
       FROM projects
       WHERE workspace_id = $1 AND id = $2
       LIMIT 1`,
      [workspaceId, projectId],
    );
    if (result.rowCount === 0) {
      return null;
    }

    return mapRowToProjectDTO(result.rows[0]);
  }

  async save(project: ProjectDTO): Promise<void> {
    await this.pool.query(
      `INSERT INTO projects (
        id, workspace_id, name, description, visibility, join_policy, owner_id, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        project.id,
        project.workspace_id,
        project.name,
        project.description ?? null,
        project.visibility,
        project.join_policy ?? null,
        project.owner_id,
        project.status,
        project.created_at,
        project.updated_at,
      ],
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null> {
    const existing = await this.getById(workspaceId, projectId);
    if (!existing) {
      return null;
    }

    const next: ProjectDTO = {
      ...existing,
      ...patch,
    };

    await this.pool.query(
      `UPDATE projects
       SET name = $3,
           description = $4,
           visibility = $5,
           join_policy = $6,
           status = $7,
           updated_at = $8
       WHERE workspace_id = $1 AND id = $2`,
      [
        workspaceId,
        projectId,
        next.name,
        next.description ?? null,
        next.visibility,
        next.join_policy ?? null,
        next.status,
        next.updated_at,
      ],
    );

    return next;
  }

  async delete(workspaceId: string, projectId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM projects WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, projectId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export interface ProjectRepoFactoryOptions {
  databaseUrl?: string;
}

export interface ProjectRepoFactoryResult {
  projectRepo: ProjectRepoPort;
  shutdown: () => Promise<void>;
}

export function createProjectRepoFactoryResult(
  options: ProjectRepoFactoryOptions,
): ProjectRepoFactoryResult {
  if (!options.databaseUrl) {
    return {
      projectRepo: new InMemoryProjectRepo(),
      shutdown: async () => undefined,
    };
  }

  const pool = new Pool({
    connectionString: options.databaseUrl,
  });

  return {
    projectRepo: new PostgresProjectRepo(pool),
    shutdown: async () => {
      await pool.end();
    },
  };
}

export interface RedisCacheOptions {
  url: string;
}

export class RedisCache implements CachePort {
  private readonly client: RedisClient;

  constructor(options: RedisCacheOptions) {
    this.client = new RedisClient(options.url, {
      maxRetriesPerRequest: 1,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export class InMemoryCache implements CachePort {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export interface MongoJsonDocStoreOptions {
  url: string;
  dbName: string;
}

export class MongoJsonDocStore implements JsonDocStorePort {
  private readonly client: MongoClient;
  private readonly dbName: string;

  constructor(options: MongoJsonDocStoreOptions) {
    this.client = new MongoClient(options.url);
    this.dbName = options.dbName;
  }

  private async collection(collection: string) {
    await this.client.connect();
    return this.client.db(this.dbName).collection<Record<string, unknown> & { _id: string }>(collection);
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const col = await this.collection(collection);
    const doc = await col.findOne({ _id: id });
    if (!doc) {
      return null;
    }

    const { _id: _ignored, ...rest } = doc;
    return rest as T;
  }

  async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    const col = await this.collection(collection);
    await col.updateOne(
      { _id: id },
      {
        $set: doc as Record<string, unknown>,
      },
      { upsert: true },
    );
  }

  async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    const col = await this.collection(collection);
    const docs = await col.find(filter).toArray();
    return docs.map((doc) => {
      const { _id: _ignored, ...rest } = doc;
      return rest as T;
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    const col = await this.collection(collection);
    await col.deleteOne({ _id: id });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class InMemoryJsonDocStore implements JsonDocStorePort {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  private collection(name: string): Map<string, Record<string, unknown>> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name)!;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const doc = this.collection(collection).get(id);
    return (doc as T | undefined) ?? null;
  }

  async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    this.collection(collection).set(id, doc as Record<string, unknown>);
  }

  async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    const docs = [...this.collection(collection).values()];
    const filtered = docs.filter((doc) =>
      Object.entries(filter).every(([key, value]) => String(doc[key]) === value),
    );
    return filtered as T[];
  }

  async delete(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id);
  }
}

export interface MinioObjectStoreOptions {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export class MinioObjectStore implements ObjectStorePort {
  private readonly client: MinioClient;

  constructor(options: MinioObjectStoreOptions) {
    this.client = new MinioClient({
      endPoint: options.endPoint,
      port: options.port,
      useSSL: options.useSSL,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
  }

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    const payload = Buffer.from(body);
    await this.client.putObject(bucket, key, payload, payload.byteLength, {
      'Content-Type': contentType ?? 'application/octet-stream',
    });
  }

  async presignedGetObject(bucket: string, key: string, expirySeconds = 900): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySeconds);
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }
}

export class InMemoryObjectStore implements ObjectStorePort {
  private readonly store = new Map<string, Uint8Array>();

  private key(bucket: string, objectKey: string): string {
    return `${bucket}/${objectKey}`;
  }

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
  ): Promise<void> {
    this.store.set(this.key(bucket, key), new Uint8Array(body));
  }

  async presignedGetObject(bucket: string, key: string): Promise<string> {
    if (!this.store.has(this.key(bucket, key))) {
      throw new Error('object_not_found');
    }
    return `memory://${bucket}/${key}`;
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const value = this.store.get(this.key(bucket, key));
    if (!value) {
      throw new Error('object_not_found');
    }

    return new Uint8Array(value);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.store.delete(this.key(bucket, key));
  }
}

export class NoopVectorStore implements VectorStorePort {
  async upsertChunks(): Promise<void> {
    return undefined;
  }

  async deleteBySource(): Promise<void> {
    return undefined;
  }

  async search(): Promise<VectorSearchResult[]> {
    return [];
  }

  async countByLibrary(): Promise<number> {
    return 0;
  }
}

export interface PgVectorStoreOptions {
  databaseUrl: string;
  tableName?: string;
  embeddingDimensions?: number;
}

interface EmbeddingRow {
  chunk_id: string;
  source_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number;
}

function asPgVectorLiteral(embedding: number[]): string {
  if (embedding.length === 0) {
    throw new Error('vector_embedding_empty');
  }
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('vector_embedding_not_finite');
    }
  }
  return `[${embedding.join(',')}]`;
}

function validateVectorDimensions(embedding: number[], expectedDimensions: number): void {
  if (embedding.length !== expectedDimensions) {
    throw new Error('vector_embedding_dimensions_mismatch');
  }
}

function assertSafeSqlIdentifier(value: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error('vector_table_name_invalid');
  }
}

export class PgVectorStore implements VectorStorePort {
  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly embeddingDimensions: number;

  constructor(options: PgVectorStoreOptions) {
    this.pool = new Pool({
      connectionString: options.databaseUrl,
    });
    this.tableName = options.tableName ?? 'source_embeddings';
    assertSafeSqlIdentifier(this.tableName);
    this.embeddingDimensions = options.embeddingDimensions ?? 1536;
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id BIGSERIAL PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        library_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(${this.embeddingDimensions}) NOT NULL,
        metadata JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, project_id, library_id, source_id, chunk_id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_scope
      ON ${this.tableName} (workspace_id, project_id, library_id, source_id)
    `);
  }

  async upsertChunks(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    chunks: VectorChunkUpsert[],
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const chunk of chunks) {
        validateVectorDimensions(chunk.embedding, this.embeddingDimensions);
        const now = new Date().toISOString();
        await client.query(
          `
          INSERT INTO ${this.tableName} (
            workspace_id, project_id, library_id, source_id, chunk_id, content, embedding, metadata, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb,$9,$10)
          ON CONFLICT (workspace_id, project_id, library_id, source_id, chunk_id)
          DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            updated_at = EXCLUDED.updated_at
          `,
          [
            workspaceId,
            projectId,
            libraryId,
            chunk.sourceId,
            chunk.chunkId,
            chunk.content,
            asPgVectorLiteral(chunk.embedding),
            chunk.metadata ? JSON.stringify(chunk.metadata) : null,
            now,
            now,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteBySource(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    sourceId: string,
  ): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM ${this.tableName}
      WHERE workspace_id = $1 AND project_id = $2 AND library_id = $3 AND source_id = $4
      `,
      [workspaceId, projectId, libraryId, sourceId],
    );
  }

  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (query.topK <= 0) {
      return [];
    }
    validateVectorDimensions(query.queryEmbedding, this.embeddingDimensions);

    const vectorLiteral = asPgVectorLiteral(query.queryEmbedding);
    if (query.minScore !== undefined) {
      const result = await this.pool.query<EmbeddingRow>(
        `
        WITH ranked AS (
          SELECT
            chunk_id,
            source_id,
            content,
            metadata,
            1 - (embedding <=> $4::vector) AS score
          FROM ${this.tableName}
          WHERE workspace_id = $1 AND project_id = $2 AND library_id = $3
        )
        SELECT chunk_id, source_id, content, metadata, score
        FROM ranked
        WHERE score >= $5
        ORDER BY score DESC
        LIMIT $6
        `,
        [
          query.workspaceId,
          query.projectId,
          query.libraryId,
          vectorLiteral,
          query.minScore,
          query.topK,
        ],
      );
      return result.rows.map((row) => ({
        chunkId: row.chunk_id,
        sourceId: row.source_id,
        content: row.content,
        metadata: row.metadata ?? undefined,
        score: row.score,
      }));
    }

    const result = await this.pool.query<EmbeddingRow>(
      `
      SELECT
        chunk_id,
        source_id,
        content,
        metadata,
        1 - (embedding <=> $4::vector) AS score
      FROM ${this.tableName}
      WHERE workspace_id = $1 AND project_id = $2 AND library_id = $3
      ORDER BY embedding <=> $4::vector
      LIMIT $5
      `,
      [query.workspaceId, query.projectId, query.libraryId, vectorLiteral, query.topK],
    );
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      content: row.content,
      metadata: row.metadata ?? undefined,
      score: row.score,
    }));
  }

  async countByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `
      SELECT COUNT(*)::text AS total
      FROM ${this.tableName}
      WHERE workspace_id = $1 AND project_id = $2 AND library_id = $3
      `,
      [workspaceId, projectId, libraryId],
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class JsonDocSourceRepo implements SourceRepoPort {
  private static readonly collection = 'sources';

  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(
    workspaceId: string,
    projectId: string,
    options?: { libraryId?: string },
  ): Promise<SourceDTO[]> {
    const items = await this.docStore.list<SourceDTO>(JsonDocSourceRepo.collection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    if (!options?.libraryId) {
      return items;
    }
    return items.filter((item) => item.library_id === options.libraryId);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDTO | null> {
    const source = await this.docStore.get<SourceDTO>(JsonDocSourceRepo.collection, sourceId);
    if (!source) {
      return null;
    }

    if (source.workspace_id !== workspaceId || source.project_id !== projectId) {
      return null;
    }

    return source;
  }

  async save(source: SourceDTO): Promise<void> {
    await this.docStore.upsert<SourceDTO>(JsonDocSourceRepo.collection, source.id, source);
  }

  async update(
    workspaceId: string,
    projectId: string,
    sourceId: string,
    patch: Partial<SourceDTO>,
  ): Promise<SourceDTO | null> {
    const existing = await this.getById(workspaceId, projectId, sourceId);
    if (!existing) {
      return null;
    }

    const updated: SourceDTO = {
      ...existing,
      ...patch,
    };
    await this.save(updated);
    return updated;
  }

  async delete(workspaceId: string, projectId: string, sourceId: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, projectId, sourceId);
    if (!existing) {
      return false;
    }

    await this.docStore.delete(JsonDocSourceRepo.collection, sourceId);
    return true;
  }
}

export class JsonDocSourceLibraryRepo implements SourceLibraryRepoPort {
  private static readonly collection = 'source_libraries';

  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(workspaceId: string, projectId: string): Promise<SourceLibraryDTO[]> {
    return this.docStore.list<SourceLibraryDTO>(JsonDocSourceLibraryRepo.collection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<SourceLibraryDTO | null> {
    const library = await this.docStore.get<SourceLibraryDTO>(
      JsonDocSourceLibraryRepo.collection,
      libraryId,
    );
    if (!library) {
      return null;
    }

    if (library.workspace_id !== workspaceId || library.project_id !== projectId) {
      return null;
    }

    return library;
  }

  async save(library: SourceLibraryDTO): Promise<void> {
    await this.docStore.upsert<SourceLibraryDTO>(
      JsonDocSourceLibraryRepo.collection,
      library.id,
      library,
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<SourceLibraryDTO>,
  ): Promise<SourceLibraryDTO | null> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return null;
    }

    const updated: SourceLibraryDTO = {
      ...existing,
      ...patch,
    };
    await this.save(updated);
    return updated;
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return false;
    }

    await this.docStore.delete(JsonDocSourceLibraryRepo.collection, libraryId);
    return true;
  }
}

export class JsonDocAIReadyJobRepo implements AIReadyJobRepoPort {
  private static readonly collection = 'ai_ready_jobs';

  constructor(private readonly docStore: JsonDocStorePort) {}

  async save(job: AIReadyJobDTO): Promise<void> {
    await this.docStore.upsert<AIReadyJobDTO>(JsonDocAIReadyJobRepo.collection, job.id, job);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
  ): Promise<AIReadyJobDTO | null> {
    const job = await this.docStore.get<AIReadyJobDTO>(JsonDocAIReadyJobRepo.collection, jobId);
    if (!job) {
      return null;
    }
    if (
      job.workspace_id !== workspaceId ||
      job.project_id !== projectId ||
      job.library_id !== libraryId
    ) {
      return null;
    }
    return job;
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
    patch: Partial<AIReadyJobDTO>,
  ): Promise<AIReadyJobDTO | null> {
    const existing = await this.getById(workspaceId, projectId, libraryId, jobId);
    if (!existing) {
      return null;
    }

    const updated: AIReadyJobDTO = {
      ...existing,
      ...patch,
    };
    await this.save(updated);
    return updated;
  }
}

export class InMemoryJobQueue implements JobQueuePort {
  private readonly items: JobQueueItem[] = [];

  async enqueue(item: JobQueueItem): Promise<void> {
    this.items.push(item);
  }

  async dequeue(): Promise<JobQueueItem | null> {
    return this.items.shift() ?? null;
  }

  get size(): number {
    return this.items.length;
  }
}

export class Utf8DocumentParser implements DocumentParserPort {
  async parse(body: Uint8Array): Promise<string> {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(body);
  }
}

export interface FixedCharTextChunkerOptions {
  chunkSize?: number;
  overlap?: number;
}

export class FixedCharTextChunker implements TextChunkerPort {
  private readonly chunkSize: number;
  private readonly overlap: number;

  constructor(options: FixedCharTextChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1000;
    this.overlap = options.overlap ?? 100;
    if (this.chunkSize <= 0) {
      throw new Error('chunk_size_invalid');
    }
    if (this.overlap < 0 || this.overlap >= this.chunkSize) {
      throw new Error('chunk_overlap_invalid');
    }
  }

  chunk(text: string): TextChunk[] {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    const chunks: TextChunk[] = [];
    const step = this.chunkSize - this.overlap;
    for (let start = 0; start < normalized.length; start += step) {
      const end = Math.min(start + this.chunkSize, normalized.length);
      chunks.push({
        content: normalized.slice(start, end),
        metadata: {
          offset_start: start,
          offset_end: end,
        },
      });
      if (end >= normalized.length) {
        break;
      }
    }
    return chunks;
  }
}

export class DeterministicEmbeddingProvider implements EmbeddingProviderPort {
  constructor(private readonly vectorDimensions = 1536) {
    if (this.vectorDimensions <= 0) {
      throw new Error('embedding_dimensions_invalid');
    }
  }

  dimensions(): number {
    return this.vectorDimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.vectorDimensions).fill(0);
    const input = text || ' ';
    for (let i = 0; i < this.vectorDimensions; i += 1) {
      const code = input.charCodeAt(i % input.length);
      vector[i] = ((code + i * 31) % 997) / 997;
    }
    return vector;
  }
}
