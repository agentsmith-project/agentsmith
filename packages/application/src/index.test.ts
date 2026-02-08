import { describe, expect, it } from 'vitest';
import type { ProjectDTO } from '@mbos/contracts';
import {
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetSourcesQuotaUseCase,
  GetProjectUseCase,
  ListSourceLibrariesUseCase,
  ListProjectsUseCase,
  ListSourcesUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
} from './index';
import type {
  CachePort,
  ClockPort,
  IdGeneratorPort,
  ObjectStorePort,
  ProjectRepoPort,
  SourceRepoPort,
  SourceLibraryRepoPort,
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

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.stored.delete(`${bucket}/${key}`);
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

    const quota = await new GetSourcesQuotaUseCase(sourceRepo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
    });
    expect(quota.storage.used).toBe(7);
    const quotaLibA = await new GetSourcesQuotaUseCase(sourceRepo).execute({
      workspaceId: 'ws_a',
      projectId: 'proj_1',
      libraryId: 'lib_a',
    });
    expect(quotaLibA.storage.used).toBe(5);

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

    await new DeleteSourceLibraryUseCase(libraryRepo, cache).execute({
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
});
