import type { ProjectDTO } from '@mbos/contracts';
import type { ProjectRepoPort } from '@mbos/ports';
import { Pool } from 'pg';

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
