import { describe, expect, it } from 'vitest';
import type { AIReadyJobDTO, ProjectDTO } from '@mbos/contracts';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CancelAIReadyJobUseCase,
  CreateAIReadyJobUseCase,
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetSourcesLimitUseCase,
  GetProjectUseCase,
  RunQueuedAIReadyJobUseCase,
  GetAIReadyJobUseCase,
  ListSourceLibraryObjectsUseCase,
  ListSourceLibrariesUseCase,
  ListProjectsUseCase,
  ListSourcesUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
} from './index';
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
  VectorStorePort,
} from '@mbos/ports';
import type { SourceDTO, SourceLibraryDTO } from '@mbos/contracts';

class FakeProjectRepo implements ProjectRepoPort {
  private readonly projects: ProjectDTO[];

  constructor(seed: ProjectDTO[] = []) {
    this.projects = [...seed];
  }

  async listByWorkspace(workspaceId: string): Promise<ProjectDTO[]> {
    return this.projects.filter((item) => item.workspace_id === workspaceId);
  }

  async getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null> {
    return this.projects.find((item) => item.workspace_id === workspaceId && item.id === projectId) ?? null;
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
      (item) => item.workspace_id === workspaceId && item.id === projectId,
    );
    if (index < 0) {
      return null;
    }

    this.projects[index] = { ...this.projects[index], ...patch };
    return this.projects[index];
  }

  async delete(workspaceId: string, projectId: string): Promise<boolean> {
    const index = this.projects.findIndex(
      (item) => item.workspace_id === workspaceId && item.id === projectId,
    );
    if (index < 0) {
      return false;
    }

    this.projects.splice(index, 1);
    return true;
  }
}

class FixedIdGenerator implements IdGeneratorPort {
  nextProjectId(): string {
    return 'proj_fixed_001';
  }
}

class FixedClock implements ClockPort {
  nowIso(): string {
    return '2026-02-08T00:00:00.000Z';
  }
}

class InMemoryCache implements CachePort {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class FakeObjectStore implements ObjectStorePort {
  readonly stored = new Map<string, Uint8Array>();

  async putObject(bucket: string, key: string, body: Uint8Array): Promise<void> {
    this.stored.set(`${bucket}/${key}`, new Uint8Array(body));
  }

  async putObjectStream(
    bucket: string,
    key: string,
    body: WebReadableStream<Uint8Array>,
    options?: { contentType?: string; sizeBytes?: number; metadata?: Record<string, string> },
  ): Promise<void> {
    void options;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const joined = chunks.length === 1 ? chunks[0] : new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    this.stored.set(`${bucket}/${key}`, joined);
  }

  async presignedGetObject(bucket: string, key: string): Promise<string> {
    return `fake://${bucket}/${key}`;
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const value = this.stored.get(`${bucket}/${key}`);
    if (!value) {
      throw new Error('object_not_found');
    }
    return new Uint8Array(value);
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
    const bytes = await this.getObject(bucket, key);
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }) as unknown as WebReadableStream<Uint8Array>,
      sizeBytes: bytes.byteLength,
      lastModified: new Date().toISOString(),
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
    const bytes = await this.getObject(bucket, key);
    return {
      key,
      sizeBytes: bytes.byteLength,
      lastModified: new Date().toISOString(),
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
    const keys = [...this.stored.keys()]
      .filter((full) => full.startsWith(`${bucket}/`))
      .map((full) => full.slice(bucket.length + 1))
      .filter((k) => k.startsWith(options.prefix))
      .sort();
    return {
      prefix: options.prefix,
      objects: keys.map((k) => ({
        key: k,
        sizeBytes: this.stored.get(`${bucket}/${k}`)?.byteLength ?? 0,
        lastModified: new Date().toISOString(),
      })),
      commonPrefixes: [],
      nextContinuationToken: null,
    };
  }

  async copyObject(bucket: string, fromKey: string, toKey: string): Promise<void> {
    const bytes = await this.getObject(bucket, fromKey);
    this.stored.set(`${bucket}/${toKey}`, bytes);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.stored.delete(`${bucket}/${key}`);
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(`${bucket}/${key}`);
    }
  }
}

class FakeSourceRepo implements SourceRepoPort {
  readonly items: SourceDTO[] = [];

  async listByProject(
    workspaceId: string,
    projectId: string,
    options?: { libraryId?: string },
  ): Promise<SourceDTO[]> {
    const scoped = this.items.filter(
      (item) => item.workspace_id === workspaceId && item.project_id === projectId,
    );
    if (!options?.libraryId) {
      return scoped;
    }
    return scoped.filter((item) => item.library_id === options.libraryId);
  }

  async save(source: SourceDTO): Promise<void> {
    this.items.push(source);
  }

  async update(
    workspaceId: string,
    projectId: string,
    sourceId: string,
    patch: Partial<SourceDTO>,
  ): Promise<SourceDTO | null> {
    const index = this.items.findIndex(
      (item) =>
        item.workspace_id === workspaceId &&
        item.project_id === projectId &&
        item.id === sourceId,
    );
    if (index < 0) {
      return null;
    }
    this.items[index] = { ...this.items[index], ...patch };
    return this.items[index];
  }

  async getById(
    workspaceId: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDTO | null> {
    return (
      this.items.find(
        (item) =>
          item.workspace_id === workspaceId &&
          item.project_id === projectId &&
          item.id === sourceId,
      ) ?? null
    );
  }

  async delete(workspaceId: string, projectId: string, sourceId: string): Promise<boolean> {
    const index = this.items.findIndex(
      (item) =>
        item.workspace_id === workspaceId &&
        item.project_id === projectId &&
        item.id === sourceId,
    );
    if (index < 0) {
      return false;
    }

    this.items.splice(index, 1);
    return true;
  }
}

class FakeSourceLibraryRepo implements SourceLibraryRepoPort {
  readonly items: SourceLibraryDTO[] = [];

  async listByProject(workspaceId: string, projectId: string): Promise<SourceLibraryDTO[]> {
    return this.items.filter(
      (item) => item.workspace_id === workspaceId && item.project_id === projectId,
    );
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<SourceLibraryDTO | null> {
    return (
      this.items.find(
        (item) =>
          item.workspace_id === workspaceId &&
          item.project_id === projectId &&
          item.id === libraryId,
      ) ?? null
    );
  }

  async save(library: SourceLibraryDTO): Promise<void> {
    this.items.push(library);
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<SourceLibraryDTO>,
  ): Promise<SourceLibraryDTO | null> {
    const index = this.items.findIndex(
      (item) =>
        item.workspace_id === workspaceId &&
        item.project_id === projectId &&
        item.id === libraryId,
    );
    if (index < 0) {
      return null;
    }
    this.items[index] = { ...this.items[index], ...patch };
    return this.items[index];
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean> {
    const index = this.items.findIndex(
      (item) =>
        item.workspace_id === workspaceId &&
        item.project_id === projectId &&
        item.id === libraryId,
    );
    if (index < 0) {
      return false;
    }
    this.items.splice(index, 1);
    return true;
  }
}

class FakeAIReadyJobRepo implements AIReadyJobRepoPort {
  readonly items: AIReadyJobDTO[] = [];

  async save(job: AIReadyJobDTO): Promise<void> {
    this.items.push(job);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
  ): Promise<AIReadyJobDTO | null> {
    return (
      this.items.find(
        (item) =>
          item.workspace_id === workspaceId &&
          item.project_id === projectId &&
          item.library_id === libraryId &&
          item.id === jobId,
      ) ?? null
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    jobId: string,
    patch: Partial<AIReadyJobDTO>,
  ): Promise<AIReadyJobDTO | null> {
    const index = this.items.findIndex(
      (item) =>
        item.workspace_id === workspaceId &&
        item.project_id === projectId &&
        item.library_id === libraryId &&
        item.id === jobId,
    );
    if (index < 0) {
      return null;
    }
    this.items[index] = { ...this.items[index], ...patch };
    return this.items[index];
  }
}

class FakeJobQueue implements JobQueuePort {
  readonly items: JobQueueItem[] = [];

  async enqueue(item: JobQueueItem): Promise<void> {
    this.items.push(item);
  }

  async dequeue(): Promise<JobQueueItem | null> {
    return this.items.shift() ?? null;
  }
}

class FakeParser implements DocumentParserPort {
  async parse(body: Uint8Array): Promise<string> {
    return new TextDecoder().decode(body);
  }
}

class FakeChunker implements TextChunkerPort {
  chunk(text: string) {
    return [{ content: text, metadata: { one: true } }];
  }
}

class FakeEmbeddings implements EmbeddingProviderPort {
  dimensions(): number {
    return 4;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}

class FakeVectorStore implements VectorStorePort {
  readonly chunks: Array<{ libraryId: string; sourceId: string; chunkId: string }> = [];

  async upsertChunks(
    _workspaceId: string,
    _projectId: string,
    libraryId: string,
    chunks: Array<{ sourceId: string; chunkId: string }>,
  ): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.push({
        libraryId,
        sourceId: chunk.sourceId,
        chunkId: chunk.chunkId,
      });
    }
  }

  async deleteBySource(
    _workspaceId: string,
    _projectId: string,
    _libraryId: string,
    _sourceId: string,
  ): Promise<void> {
    return undefined;
  }

  async search(): Promise<Array<{ chunkId: string; sourceId: string; content: string; score: number }>> {
    return [];
  }

  async countByLibrary(): Promise<number> {
    return this.chunks.length;
  }
}

describe('Project use cases', () => {
  it('creates a project with normalized fields', async () => {
    const repo = new FakeProjectRepo();
    const useCase = new CreateProjectUseCase(repo, new FixedIdGenerator(), new FixedClock());

    const created = await useCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_1',
      input: {
        name: '  Demo  ',
        description: '  Desc  ',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });

    expect(created.id).toBe('proj_fixed_001');
    expect(created.workspace_id).toBe('ws_default');
    expect(created.owner_id).toBe('user_1');
    expect(created.name).toBe('Demo');
    expect(created.description).toBe('Desc');
    expect(created.created_at).toBe('2026-02-08T00:00:00.000Z');
  });

  it('lists projects by workspace only', async () => {
    const repo = new FakeProjectRepo([
      {
        id: 'proj_1',
        workspace_id: 'ws_a',
        name: 'A',
        visibility: 'private',
        owner_id: 'user_1',
        status: 'active',
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
      {
        id: 'proj_2',
        workspace_id: 'ws_b',
        name: 'B',
        visibility: 'public',
        owner_id: 'user_1',
        status: 'active',
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
    ]);

    const useCase = new ListProjectsUseCase(repo);
    const result = await useCase.execute('ws_a');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('proj_1');
  });

  it('gets project by id and updates selected fields', async () => {
    const repo = new FakeProjectRepo([
      {
        id: 'proj_1',
        workspace_id: 'ws_a',
        name: 'A',
        description: 'old',
        visibility: 'private',
        join_policy: 'approval_required',
        owner_id: 'user_1',
        status: 'active',
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
    ]);

    const got = await new GetProjectUseCase(repo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(got.name).toBe('A');

    const updated = await new UpdateProjectUseCase(repo, new FixedClock()).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      input: {
        name: '  Renamed  ',
        description: '  new desc  ',
      },
    });

    expect(updated.name).toBe('Renamed');
    expect(updated.description).toBe('new desc');
    expect(updated.updated_at).toBe('2026-02-08T00:00:00.000Z');
  });

  it('updates project governance and execution config fields', async () => {
    const repo = new FakeProjectRepo([
      {
        id: 'proj_1',
        workspace_id: 'ws_a',
        name: 'A',
        visibility: 'private',
        join_policy: 'approval_required',
        owner_id: 'user_1',
        status: 'active',
        governance_json: {},
        execution_preferences_json: {},
        limits_json: {},
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
    ]);

    const updated = await new UpdateProjectUseCase(repo, new FixedClock()).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      input: {
        governance_json: { project_admins: ['user_alt'] },
        execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
        limits_json: { requests_per_day: 1000 },
      },
    });

    expect(updated.governance_json).toEqual({ project_admins: ['user_alt'] });
    expect(updated.execution_preferences_json).toEqual({ notebook_endpoint_id: 'ep_notebook' });
    expect(updated.limits_json).toEqual({ requests_per_day: 1000 });
    expect(updated.updated_at).toBe('2026-02-08T00:00:00.000Z');
  });

  it('deletes project and then cannot retrieve it', async () => {
    const repo = new FakeProjectRepo([
      {
        id: 'proj_1',
        workspace_id: 'ws_a',
        name: 'A',
        visibility: 'private',
        owner_id: 'user_1',
        status: 'active',
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
    ]);

    await new DeleteProjectUseCase(repo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });

    await expect(
      new GetProjectUseCase(repo).execute({
        workspaceId: 'ws_a',
        projectId: 'proj_1',
      }),
    ).rejects.toThrowError('project_not_found');
  });

  it('creates source and lists it with cache behavior', async () => {
    const sourceRepo = new FakeSourceRepo();
    const cache = new InMemoryCache();
    const objectStore = new FakeObjectStore();
    const create = new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new FixedIdGenerator(),
      new FixedClock(),
      cache,
      'mbos-dev',
    );
    const list = new ListSourcesUseCase(sourceRepo, cache);

    const created = await create.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      input: {
        name: 'a.txt',
        library_id: 'lib_a',
        content_type: 'text/plain',
        content_base64: Buffer.from('hello', 'utf-8').toString('base64'),
      },
    });
    expect(created.id).toBe('src_fixed_001');

    const createdSecond = await create.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      input: {
        name: 'b.txt',
        library_id: 'lib_b',
        content_type: 'text/plain',
        content_base64: Buffer.from('hi', 'utf-8').toString('base64'),
      },
    });

    const firstList = await list.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(firstList.items).toHaveLength(2);
    const libAList = await list.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
    });
    expect(libAList.items).toHaveLength(1);
    expect(libAList.items[0].library_id).toBe('lib_a');

    sourceRepo.items.length = 0;
    const secondList = await list.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(secondList.items).toHaveLength(2);
    sourceRepo.items.push(created);
    sourceRepo.items.push(createdSecond);
    const found = await new GetSourceUseCase(sourceRepo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      sourceId: created.id,
    });
    expect(found.id).toBe(created.id);

    const limit = await new GetSourcesLimitUseCase(sourceRepo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(limit.storage.used).toBe(7);
    const limitLibA = await new GetSourcesLimitUseCase(sourceRepo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
    });
    expect(limitLibA.storage.used).toBe(5);

    const downloaded = await new DownloadSourceUseCase(
      sourceRepo,
      objectStore,
      'mbos-dev',
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      sourceId: created.id,
    });
    expect(downloaded.body.byteLength).toBe(5);

    const remove = new DeleteSourceUseCase(
      sourceRepo,
      objectStore,
      cache,
      'mbos-dev',
    );
    await remove.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      sourceId: created.id,
    });
    const afterDelete = await list.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(afterDelete.items).toHaveLength(1);
  });

  it('creates, updates, lists, and deletes source library', async () => {
    const libraryRepo = new FakeSourceLibraryRepo();
    const objectStore = new FakeObjectStore();
    const cache = new InMemoryCache();

    const create = new CreateSourceLibraryUseCase(
      libraryRepo,
      new FixedIdGenerator(),
      new FixedClock(),
      cache,
    );
    const created = await create.execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      actorId: 'user_1',
      input: {
        name: ' Shared ',
        visibility: 'shared',
      },
    });
    expect(created.id).toBe('lib_fixed_001');
    expect(created.name).toBe('Shared');
    expect(created.object_prefix).toBe(
      'workspaces/ws_a/projects/proj_1/libraries/lib_fixed_001/',
    );
    expect(created.doc_namespace).toBe('doc_ws_a_proj_1_lib_fixed_001');
    expect(created.vector_namespace).toBe('vec_ws_a_proj_1_lib_fixed_001');

    const updated = await new UpdateSourceLibraryUseCase(
      libraryRepo,
      new FixedClock(),
      cache,
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: created.id,
      input: { description: ' docs ' },
    });
    expect(updated.description).toBe('docs');

    const listed = await new ListSourceLibrariesUseCase(libraryRepo, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(listed.items).toHaveLength(1);

    await new DeleteSourceLibraryUseCase(libraryRepo, objectStore, cache, 'mbos-dev').execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: created.id,
    });
    const afterDelete = await new ListSourceLibrariesUseCase(libraryRepo, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(afterDelete.items).toHaveLength(0);
  });

  it('lists objects with existing library prefix (without trailing slash) correctly', async () => {
    const libraryRepo = new FakeSourceLibraryRepo();
    const objectStore = new FakeObjectStore();
    const clock = new FixedClock();
    libraryRepo.items.push({
      id: 'lib_existing',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      name: 'Legacy',
      visibility: 'shared',
      // stored prefix without trailing slash
      object_prefix: 'workspaces/ws_a/projects/proj_1/libraries/lib_existing',
      doc_namespace: 'doc_ws_a_proj_1_lib_existing',
      vector_namespace: 'vec_ws_a_proj_1_lib_existing',
      created_by_user_id: 'user_1',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    await objectStore.putObject(
      'mbos-dev',
      'workspaces/ws_a/projects/proj_1/libraries/lib_existing/docs/readme.txt',
      new TextEncoder().encode('hello'),
    );

    const listed = await new ListSourceLibraryObjectsUseCase(
      libraryRepo,
      objectStore,
      'mbos-dev',
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_existing',
      prefix: 'docs/',
      delimiter: '/',
      pageSize: 200,
    });

    const firstObject = listed.items.find((item) => item.kind === 'object');
    expect(firstObject).toBeTruthy();
    if (firstObject?.kind === 'object') {
      expect(firstObject.key).toBe('docs/readme.txt');
    }
  });

  it('hides folder marker objects from object rows', async () => {
    const libraryRepo = new FakeSourceLibraryRepo();
    const objectStore = new FakeObjectStore();
    const clock = new FixedClock();
    libraryRepo.items.push({
      id: 'lib_marker',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      name: 'Marker',
      visibility: 'shared',
      object_prefix: 'workspaces/ws_a/projects/proj_1/libraries/lib_marker/',
      doc_namespace: 'doc_ws_a_proj_1_lib_marker',
      vector_namespace: 'vec_ws_a_proj_1_lib_marker',
      created_by_user_id: 'user_1',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    await objectStore.putObject('mbos-dev', 'workspaces/ws_a/projects/proj_1/libraries/lib_marker/docs/', new Uint8Array(0));
    await objectStore.putObject(
      'mbos-dev',
      'workspaces/ws_a/projects/proj_1/libraries/lib_marker/docs/readme.txt',
      new TextEncoder().encode('hello'),
    );

    const listed = await new ListSourceLibraryObjectsUseCase(libraryRepo, objectStore, 'mbos-dev').execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_marker',
      prefix: 'docs/',
      delimiter: '/',
      pageSize: 200,
    });
    const objectNames = listed.items
      .filter((item) => item.kind === 'object')
      .map((item) => (item.kind === 'object' ? item.name : ''));
    expect(objectNames).toEqual(['readme.txt']);
  });

  it('filters and sorts listed objects by search/sort options', async () => {
    const libraryRepo = new FakeSourceLibraryRepo();
    const objectStore = new FakeObjectStore();
    const clock = new FixedClock();
    libraryRepo.items.push({
      id: 'lib_search_sort',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      name: 'SearchSort',
      visibility: 'shared',
      object_prefix: 'workspaces/ws_a/projects/proj_1/libraries/lib_search_sort/',
      doc_namespace: 'doc_ws_a_proj_1_lib_search_sort',
      vector_namespace: 'vec_ws_a_proj_1_lib_search_sort',
      created_by_user_id: 'user_1',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    await objectStore.putObject(
      'mbos-dev',
      'workspaces/ws_a/projects/proj_1/libraries/lib_search_sort/alpha-report.txt',
      new TextEncoder().encode('12345'),
    );
    await objectStore.putObject(
      'mbos-dev',
      'workspaces/ws_a/projects/proj_1/libraries/lib_search_sort/beta-report.txt',
      new TextEncoder().encode('1234567890'),
    );
    await objectStore.putObject(
      'mbos-dev',
      'workspaces/ws_a/projects/proj_1/libraries/lib_search_sort/gamma-note.txt',
      new TextEncoder().encode('12'),
    );

    const listed = await new ListSourceLibraryObjectsUseCase(libraryRepo, objectStore, 'mbos-dev').execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_search_sort',
      prefix: '',
      delimiter: '/',
      pageSize: 200,
      search: 'report',
      sortBy: 'size_bytes',
      sortOrder: 'desc',
    });

    const objectItems = listed.items.filter((item) => item.kind === 'object');
    expect(objectItems).toHaveLength(2);
    if (objectItems[0]?.kind === 'object' && objectItems[1]?.kind === 'object') {
      expect(objectItems[0].name).toBe('beta-report.txt');
      expect(objectItems[1].name).toBe('alpha-report.txt');
    }
  });

  it('creates, gets, and cancels library-scoped ai-ready job', async () => {
    const sourceRepo = new FakeSourceRepo();
    const libraryRepo = new FakeSourceLibraryRepo();
    const jobRepo = new FakeAIReadyJobRepo();
    const queue = new FakeJobQueue();
    const cache = new InMemoryCache();
    const clock = new FixedClock();

    libraryRepo.items.push({
      id: 'lib_a',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      name: 'Library A',
      visibility: 'shared',
      object_prefix: 'workspaces/ws_a/projects/proj_1/libraries/lib_a',
      doc_namespace: 'doc_ws_a_proj_1_lib_a',
      vector_namespace: 'vec_ws_a_proj_1_lib_a',
      created_by_user_id: 'user_1',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    sourceRepo.items.push({
      id: 'src_1',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      library_id: 'lib_a',
      name: 'a.txt',
      object_key: 'a.txt',
      content_type: 'text/plain',
      size_bytes: 3,
      status: 'ready',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });

    const created = await new CreateAIReadyJobUseCase(
      sourceRepo,
      libraryRepo,
      jobRepo,
      queue,
      clock,
      cache,
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
      actorId: 'user_1',
      input: { source_ids: ['src_1'] },
      idempotencyKey: 'idem_1',
    });
    expect(created.status).toBe('queued');
    expect(created.type).toBe('document_ingest');
    expect(queue.items).toHaveLength(1);

    const got = await new GetAIReadyJobUseCase(jobRepo, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
      jobId: created.id,
    });
    expect(got.id).toBe(created.id);

    const cancelled = await new CancelAIReadyJobUseCase(jobRepo, clock, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
      jobId: created.id,
    });
    expect(cancelled.status).toBe('cancelled');
  });

  it('runs queued ai-ready document ingest job and marks source ready', async () => {
    const sourceRepo = new FakeSourceRepo();
    const libraryRepo = new FakeSourceLibraryRepo();
    const jobRepo = new FakeAIReadyJobRepo();
    const queue = new FakeJobQueue();
    const cache = new InMemoryCache();
    const clock = new FixedClock();
    const objectStore = new FakeObjectStore();
    const vectorStore = new FakeVectorStore();

    libraryRepo.items.push({
      id: 'lib_a',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      name: 'Library A',
      visibility: 'shared',
      object_prefix: 'workspaces/ws_a/projects/proj_1/libraries/lib_a',
      doc_namespace: 'doc_ws_a_proj_1_lib_a',
      vector_namespace: 'vec_ws_a_proj_1_lib_a',
      created_by_user_id: 'user_1',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    sourceRepo.items.push({
      id: 'src_1',
      workspace_id: 'ws_a',
      project_id: 'proj_1',
      library_id: 'lib_a',
      name: 'doc.txt',
      object_key: 'src_1_doc.txt',
      content_type: 'text/plain',
      size_bytes: 5,
      status: 'ready',
      created_at: clock.nowIso(),
      updated_at: clock.nowIso(),
    });
    await objectStore.putObject(
      'mbos-dev',
      'src_1_doc.txt',
      new TextEncoder().encode('hello vector world'),
    );

    const created = await new CreateAIReadyJobUseCase(
      sourceRepo,
      libraryRepo,
      jobRepo,
      queue,
      clock,
      cache,
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
      actorId: 'user_1',
      input: { source_ids: ['src_1'] },
    });

    const completed = await new RunQueuedAIReadyJobUseCase(
      sourceRepo,
      libraryRepo,
      jobRepo,
      objectStore,
      new FakeParser(),
      new FakeChunker(),
      new FakeEmbeddings(),
      vectorStore,
      clock,
      cache,
      'mbos-dev',
    ).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
      jobId: created.id,
    });

    expect(completed.status).toBe('succeeded');
    const source = await sourceRepo.getById('ws_a', 'proj_1', 'src_1');
    expect(source?.ai_ready_status).toBe('ready');
    expect(source?.vectordb_bytes).toBeGreaterThan(0);
    expect(vectorStore.chunks.length).toBeGreaterThan(0);
  });
});
