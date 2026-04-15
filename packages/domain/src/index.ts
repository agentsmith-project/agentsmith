import type { ProjectDTO } from '@mbos/contracts';

export type ProjectVisibility = 'public' | 'private';
export type ProjectJoinPolicy = 'approval_required' | 'open';
export type ProjectStatus = 'active' | 'archived' | 'deleted';

export interface NewProjectInput {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  visibility: ProjectVisibility;
  joinPolicy: ProjectJoinPolicy;
  now: string;
}

export class Project {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly name: string,
    public readonly description: string | undefined,
    public readonly visibility: ProjectVisibility,
    public readonly joinPolicy: ProjectJoinPolicy,
    public readonly ownerId: string,
    public readonly status: ProjectStatus,
    public readonly createdAt: string,
    public readonly updatedAt: string,
  ) {}

  static create(input: NewProjectInput): Project {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error('project_name_required');
    }

    return new Project(
      input.id,
      input.workspaceId,
      trimmedName,
      input.description?.trim() || undefined,
      input.visibility,
      input.joinPolicy,
      input.ownerId,
      'active',
      input.now,
      input.now,
    );
  }

  toDTO(): ProjectDTO {
    return {
      id: this.id,
      workspace_id: this.workspaceId,
      name: this.name,
      description: this.description,
      visibility: this.visibility,
      join_policy: this.joinPolicy,
      owner_id: this.ownerId,
      status: this.status,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }
}

export * from './ownership.js';
