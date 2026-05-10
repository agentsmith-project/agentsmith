import { describe, expect, it } from 'vitest';
import type { ProjectDTO } from '@mbos/contracts';
import {
  CreateProjectUseCase,
  DeleteProjectUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  UpdateProjectUseCase,
} from './index';
import type {
  ClockPort,
  IdGeneratorPort,
  ProjectRepoPort,
} from '@mbos/ports';

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

  it('rejects legacy project execution preferences during create', async () => {
    const repo = new FakeProjectRepo();
    const useCase = new CreateProjectUseCase(repo, new FixedIdGenerator(), new FixedClock());

    await expect(
      useCase.execute({
        workspaceId: 'ws_default',
        actorId: 'user_1',
        input: {
          name: 'Should Not Create',
          visibility: 'private',
          join_policy: 'approval_required',
          execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
        } as unknown as Parameters<CreateProjectUseCase['execute']>[0]['input'],
      }),
    ).rejects.toThrow(/execution_preferences_json/);

    await expect(repo.listByWorkspace('ws_default')).resolves.toEqual([]);
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

  it('updates project governance and limits metadata fields', async () => {
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
        limits_json: { requests_per_day: 1000 },
      },
    });

    expect(updated.owner_id).toBe('user_alt');
    expect(updated.governance_json).toEqual({ governance_mode: 'groups_only' });
    expect(updated.limits_json).toEqual({ requests_per_day: 1000 });
    expect(updated.updated_at).toBe('2026-02-08T00:00:00.000Z');
  });

  it('rejects legacy project execution preferences instead of silently stripping them', async () => {
    const repo = new FakeProjectRepo([
      {
        id: 'proj_1',
        workspace_id: 'ws_a',
        name: 'A',
        visibility: 'private',
        join_policy: 'approval_required',
        owner_id: 'user_1',
        status: 'active',
        created_at: '2026-02-08T00:00:00.000Z',
        updated_at: '2026-02-08T00:00:00.000Z',
      },
    ]);

    await expect(
      new UpdateProjectUseCase(repo, new FixedClock()).execute({
        workspaceId: 'ws_a',
        projectId: 'proj_1',
        input: {
          name: 'Should Not Apply',
          execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
        } as unknown as Parameters<UpdateProjectUseCase['execute']>[0]['input'],
      }),
    ).rejects.toThrow(/execution_preferences_json/);

    const stored = await repo.getById('ws_a', 'proj_1');
    expect(stored?.name).toBe('A');
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

});
