import { describe, expect, it } from 'vitest';
import type { ProjectDTO } from '@mbos/contracts';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateFileLibraryCatalogUseCase,
  CreateProjectUseCase,
  DeleteFileLibraryCatalogUseCase,
  DeleteProjectUseCase,
  GetProjectUseCase,
  ListFileLibraryObjectsUseCase,
  ListFileLibraryCatalogsUseCase,
  ListProjectsUseCase,
  UpdateFileLibraryCatalogUseCase,
  UpdateProjectUseCase,
} from './index';
import type {
  CachePort,
  ClockPort,
  IdGeneratorPort,
  ObjectStorePort,
  ProjectRepoPort,
  FileLibraryCatalogRepoPort,
} from '@mbos/ports';
import type { FileLibraryCatalogDTO } from '@mbos/contracts';

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

  async incr(key: string): Promise<number> {
    const current = Number.parseInt(this.map.get(key) ?? '0', 10);
    const next = (Number.isFinite(current) ? current : 0) + 1;
    this.map.set(key, String(next));
    return next;
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

class FakeFileLibraryCatalogRepo implements FileLibraryCatalogRepoPort {
  readonly items: FileLibraryCatalogDTO[] = [];

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryCatalogDTO[]> {
    return this.items.filter(
      (item) => item.workspace_id === workspaceId && item.project_id === projectId,
    );
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryCatalogDTO | null> {
    return (
      this.items.find(
        (item) =>
          item.workspace_id === workspaceId &&
          item.project_id === projectId &&
          item.id === libraryId,
      ) ?? null
    );
  }

  async save(library: FileLibraryCatalogDTO): Promise<void> {
    this.items.push(library);
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<FileLibraryCatalogDTO>,
  ): Promise<FileLibraryCatalogDTO | null> {
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

  it('updates project metadata and execution config fields', async () => {
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
        owner_id: 'user_alt',
        governance_json: { governance_mode: 'groups_only' },
        execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
        limits_json: { requests_per_day: 1000 },
      },
    });

    expect(updated.owner_id).toBe('user_alt');
    expect(updated.governance_json).toEqual({ governance_mode: 'groups_only' });
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

  it('creates, updates, lists, and deletes file library catalog', async () => {
    const libraryRepo = new FakeFileLibraryCatalogRepo();
    const objectStore = new FakeObjectStore();
    const cache = new InMemoryCache();

    const create = new CreateFileLibraryCatalogUseCase(
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

    const updated = await new UpdateFileLibraryCatalogUseCase(
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

    const listed = await new ListFileLibraryCatalogsUseCase(libraryRepo, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(listed.items).toHaveLength(1);

    await new DeleteFileLibraryCatalogUseCase(libraryRepo, objectStore, cache, 'mbos-dev').execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: created.id,
    });
    const afterDelete = await new ListFileLibraryCatalogsUseCase(libraryRepo, cache).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(afterDelete.items).toHaveLength(0);
  });

  it('lists objects with existing library prefix (without trailing slash) correctly', async () => {
    const libraryRepo = new FakeFileLibraryCatalogRepo();
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

    const listed = await new ListFileLibraryObjectsUseCase(
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
    const libraryRepo = new FakeFileLibraryCatalogRepo();
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

    const listed = await new ListFileLibraryObjectsUseCase(libraryRepo, objectStore, 'mbos-dev').execute({
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
    const libraryRepo = new FakeFileLibraryCatalogRepo();
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

    const listed = await new ListFileLibraryObjectsUseCase(libraryRepo, objectStore, 'mbos-dev').execute({
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

});
