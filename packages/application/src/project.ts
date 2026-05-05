import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  type CreateProjectRequest,
  type ListProjectsResponse,
  type ProjectDTO,
  type UpdateProjectRequest,
} from '@mbos/contracts';
import { Project } from '@mbos/domain';
import type {
  ClockPort,
  IdGeneratorPort,
  ProjectRepoPort,
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

    if (input.owner_id !== undefined) {
      const normalizedOwnerId = input.owner_id.trim();
      if (!normalizedOwnerId) {
        throw new Error('project_owner_required');
      }
      patch.owner_id = normalizedOwnerId;
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

    if (input.governance_json !== undefined) {
      patch.governance_json = input.governance_json;
    }

    if (input.limits_json !== undefined) {
      patch.limits_json = input.limits_json;
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
