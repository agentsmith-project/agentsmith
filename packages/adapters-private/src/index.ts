import type { ProjectDTO, FileLibraryCatalogDTO } from '@mbos/contracts';
import type {
  CachePort,
  ClockPort,
  IdGeneratorPort,
  JsonDocStorePort,
  ObjectStorePort,
  ProjectRepoPort,
  FileLibraryCatalogRepoPort,
} from '@mbos/ports';
import { MongoClient } from 'mongodb';
import { Client as MinioClient } from 'minio';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
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

  async putObjectStream(
    bucket: string,
    key: string,
    body: WebReadableStream<Uint8Array>,
    options: {
      contentType?: string;
      sizeBytes?: number;
      metadata?: Record<string, string>;
    } = {},
  ): Promise<void> {
    const nodeStream = Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    await this.client.putObject(bucket, key, nodeStream, options.sizeBytes, {
      'Content-Type': options.contentType ?? 'application/octet-stream',
      ...(options.metadata ?? {}),
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

  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{
    body: WebReadableStream<Uint8Array>;
    sizeBytes?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
    metadata?: Record<string, string>;
  }> {
    const stat = await this.statObject(bucket, key);
    const nodeStream = await this.client.getObject(bucket, key);
    const webStream = Readable.toWeb(nodeStream) as WebReadableStream<Uint8Array>;
    return {
      body: webStream,
      sizeBytes: stat.sizeBytes,
      contentType: stat.contentType,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: stat.metadata,
    };
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }> {
    const stat = await this.client.statObject(bucket, key);
    return {
      key,
      sizeBytes: stat.size,
      contentType: stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'],
      etag: stat.etag,
      lastModified: stat.lastModified?.toISOString?.() ?? new Date().toISOString(),
      metadata: (stat.metaData as Record<string, string> | undefined) ?? undefined,
    };
  }

  async listObjects(
    bucket: string,
    options: {
      prefix: string;
      delimiter?: string;
      pageSize?: number;
      continuationToken?: string;
    },
  ): Promise<{
    prefix: string;
    objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 200), 1000);
    const delimiter = options.delimiter;
    const recursive = delimiter !== '/';
    const stream = this.client.listObjectsV2(
      bucket,
      options.prefix,
      recursive,
      options.continuationToken ?? undefined,
    );

    const objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }> = [];
    const commonPrefixes: string[] = [];
    let lastKey: string | null = null;
    let truncated = false;

    try {
      for await (const item of stream as unknown as AsyncIterable<{
        name?: string;
        prefix?: string;
        size?: number;
        etag?: string;
        lastModified?: Date;
      }>) {
        const prefixRow = typeof item.prefix === 'string' ? item.prefix : null;
        if (prefixRow) {
          commonPrefixes.push(prefixRow);
          lastKey = prefixRow;
        } else if (typeof item.name === 'string') {
          objects.push({
            key: item.name,
            sizeBytes: item.size ?? 0,
            etag: item.etag,
            lastModified: item.lastModified?.toISOString?.() ?? new Date().toISOString(),
          });
          lastKey = item.name;
        }

        if (objects.length + commonPrefixes.length >= pageSize) {
          truncated = true;
          if (typeof (stream as unknown as { destroy?: () => void }).destroy === 'function') {
            (stream as unknown as { destroy: () => void }).destroy();
          }
          break;
        }
      }
    } catch {
      // MinIO list stream may throw after destroy; treat as normal truncation.
    }

    return {
      prefix: options.prefix,
      objects,
      commonPrefixes,
      nextContinuationToken: truncated ? lastKey : null,
    };
  }

  async copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    if (options.overwrite === false) {
      try {
        await this.client.statObject(bucket, toKey);
        throw new Error('destination_exists');
      } catch (err) {
        // If stat failed, assume it does not exist.
        if (err instanceof Error && err.message === 'destination_exists') throw err;
      }
    }

    await this.client.copyObject(bucket, toKey, `/${bucket}/${fromKey}`);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // removeObjects is more efficient, but not all S3 backends support it.
    if (typeof (this.client as unknown as { removeObjects?: unknown }).removeObjects === 'function') {
      await (this.client as unknown as { removeObjects: (b: string, k: string[]) => Promise<void> }).removeObjects(
        bucket,
        keys,
      );
      return;
    }
    for (const key of keys) {
      await this.client.removeObject(bucket, key);
    }
  }
}

export class InMemoryObjectStore implements ObjectStorePort {
  private readonly store = new Map<
    string,
    { body: Uint8Array; contentType?: string; etag?: string; lastModified: string; metadata?: Record<string, string> }
  >();

  private key(bucket: string, objectKey: string): string {
    return `${bucket}/${objectKey}`;
  }

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
  ): Promise<void> {
    this.store.set(this.key(bucket, key), {
      body: new Uint8Array(body),
      lastModified: new Date().toISOString(),
    });
  }

  async putObjectStream(
    bucket: string,
    key: string,
    body: WebReadableStream<Uint8Array>,
    options: { contentType?: string; sizeBytes?: number; metadata?: Record<string, string> } = {},
  ): Promise<void> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const joined = chunks.length === 1 ? chunks[0] : new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    this.store.set(this.key(bucket, key), {
      body: joined,
      contentType: options.contentType,
      lastModified: new Date().toISOString(),
      metadata: options.metadata,
    });
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

    return new Uint8Array(value.body);
  }

  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{
    body: WebReadableStream<Uint8Array>;
    sizeBytes?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
    metadata?: Record<string, string>;
  }> {
    const stat = await this.statObject(bucket, key);
    const obj = this.store.get(this.key(bucket, key));
    if (!obj) throw new Error('object_not_found');
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(obj.body));
          controller.close();
        },
      }) as unknown as WebReadableStream<Uint8Array>,
      sizeBytes: stat.sizeBytes,
      contentType: stat.contentType,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: stat.metadata,
    };
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }> {
    const obj = this.store.get(this.key(bucket, key));
    if (!obj) throw new Error('object_not_found');
    return {
      key,
      sizeBytes: obj.body.byteLength,
      contentType: obj.contentType,
      etag: obj.etag,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
    };
  }

  async listObjects(
    bucket: string,
    options: { prefix: string; delimiter?: string; pageSize?: number; continuationToken?: string },
  ): Promise<{
    prefix: string;
    objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 200), 1000);
    const delimiter = options.delimiter;
    const allKeys = [...this.store.keys()]
      .filter((full) => full.startsWith(`${bucket}/`))
      .map((full) => full.slice(bucket.length + 1))
      .filter((k) => k.startsWith(options.prefix))
      .sort();

    const startAfter = options.continuationToken;
    const startIndex = startAfter ? allKeys.findIndex((k) => k > startAfter) : 0;
    const keys = allKeys.slice(startIndex < 0 ? 0 : startIndex);

    const objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }> = [];
    const commonPrefixes = new Set<string>();
    let lastKey: string | null = null;
    let truncated = false;

    for (const key of keys) {
      const rest = key.slice(options.prefix.length);
      if (delimiter === '/' && rest.includes('/')) {
        const seg = rest.split('/')[0]!;
        const p = `${options.prefix}${seg}/`;
        commonPrefixes.add(p);
        lastKey = p;
      } else {
        const obj = this.store.get(this.key(bucket, key));
        if (!obj) continue;
        objects.push({
          key,
          sizeBytes: obj.body.byteLength,
          etag: obj.etag,
          lastModified: obj.lastModified,
        });
        lastKey = key;
      }

      if (objects.length + commonPrefixes.size >= pageSize) {
        truncated = true;
        break;
      }
    }

    return {
      prefix: options.prefix,
      objects,
      commonPrefixes: [...commonPrefixes],
      nextContinuationToken: truncated ? lastKey : null,
    };
  }

  async copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    const src = this.store.get(this.key(bucket, fromKey));
    if (!src) throw new Error('object_not_found');
    const dstKey = this.key(bucket, toKey);
    if (options.overwrite === false && this.store.has(dstKey)) {
      throw new Error('destination_exists');
    }
    this.store.set(dstKey, { ...src, body: new Uint8Array(src.body), lastModified: new Date().toISOString() });
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.store.delete(this.key(bucket, key));
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(this.key(bucket, key));
    }
  }
}

export class JsonDocFileLibraryCatalogRepo implements FileLibraryCatalogRepoPort {
  private static readonly collection = 'file_libraries';

  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryCatalogDTO[]> {
    return this.docStore.list<FileLibraryCatalogDTO>(JsonDocFileLibraryCatalogRepo.collection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryCatalogDTO | null> {
    const library = await this.docStore.get<FileLibraryCatalogDTO>(
      JsonDocFileLibraryCatalogRepo.collection,
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

  async save(library: FileLibraryCatalogDTO): Promise<void> {
    await this.docStore.upsert<FileLibraryCatalogDTO>(
      JsonDocFileLibraryCatalogRepo.collection,
      library.id,
      library,
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<FileLibraryCatalogDTO>,
  ): Promise<FileLibraryCatalogDTO | null> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return null;
    }

    const updated: FileLibraryCatalogDTO = {
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

    await this.docStore.delete(JsonDocFileLibraryCatalogRepo.collection, libraryId);
    return true;
  }
}
