import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
} from '@mbos/contracts';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  canActorDiscoverProject,
  resolveVisibleProjectPermissionsForActor,
} from './project-authz-engine.js';
import type { ProjectRouteContext } from './project-route-types.js';
import {
  readProjectPermissionContext,
  readRequestId,
} from './project-route-handler-utils.js';
import {
  resolveWorkspacePermissions,
} from './workspace-permissions.js';
import { listProjectGroups, setProjectAdminGroupMembersPersisted } from './project-member-governance-persistence.js';
import type { ProjectGroupRecord } from './project-member-governance-types.js';
import { PROJECT_BUILT_IN_GROUP_IDS } from './project-governance-model.js';

async function readProjectAdminMemberIds(
  deps: ProjectRouteContext['deps'],
  workspaceId: string,
  projectId: string,
  ownerId: string,
): Promise<string[]> {
  const adminGroup = (await listProjectGroups(deps.docStore, workspaceId, projectId, ownerId)).find(
    (group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins,
  );
  return adminGroup ? [...adminGroup.member_ids] : [];
}

async function readProjectActorGroups(args: {
  deps: ProjectRouteContext['deps'];
  workspaceId: string;
  projectId: string;
  ownerId: string;
  actorUserId: string;
}): Promise<Array<Pick<ProjectGroupRecord, 'id' | 'name' | 'permission_template_id' | 'built_in' | 'system_key'>>> {
  const groups = await listProjectGroups(args.deps.docStore, args.workspaceId, args.projectId, args.ownerId);
  return groups
    .filter((group) => group.member_ids.includes(args.actorUserId))
    .map((group) => ({
      id: group.id,
      name: group.name,
      permission_template_id: group.permission_template_id,
      built_in: group.built_in,
      system_key: group.system_key,
    }));
}

export async function handleProjectCrudRoutes(context: ProjectRouteContext): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    defaultWorkspace,
    json,
    readBody,
  } = context;

  if (route.kind === 'collection' && method === 'GET' && route.workspaceId) {
    const workspaceId = route.workspaceId;
    const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
    const visibleItems = await Promise.all(listed.items.map(async (item) => {
      const discoverable = await canActorDiscoverProject({
        docStore: deps.docStore,
        workspaceId,
        projectId: item.id,
        projectOwnerId: item.owner_id,
        projectVisibility: item.visibility,
        actorUserId: user.id,
      });
      if (!discoverable) {
        return null;
      }
      return {
        ...item,
        admin_member_ids: await readProjectAdminMemberIds(deps, workspaceId, item.id, item.owner_id),
        groups: await readProjectActorGroups({
          deps,
          workspaceId,
          projectId: item.id,
          ownerId: item.owner_id,
          actorUserId: user.id,
        }),
        permissions: [
          ...await resolveVisibleProjectPermissionsForActor({
            docStore: deps.docStore,
            workspaceId,
            projectId: item.id,
            projectOwnerId: item.owner_id,
            projectGovernance: item.governance_json,
            actorUserId: user.id,
          }),
        ],
      };
    }));
    const items = visibleItems.filter((item) => item !== null);
    json(res, 200, {
      items,
    });
    return true;
  }

  if (route.kind === 'collection' && method === 'POST' && route.workspaceId) {
    const requestId = readRequestId(req);
    const raw = await readBody(req);
    const input = CreateProjectRequestSchema.parse(raw);
    const actorPermissions = await resolveWorkspacePermissions({
      workspaceId: route.workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      defaultWorkspaceId: defaultWorkspace?.id,
    });
    if (!actorPermissions.includes('workspace:project:create')) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: '__workspace__',
        actor: { type: 'user', id: user.id },
        action: 'project.create',
        result: 'error',
        requestId,
        resourceType: 'workspace',
        resourceId: route.workspaceId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'workspace_project_create_required',
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'workspace_project_create_required' });
      return true;
    }
    const created = await deps.createProjectUseCase.execute({
      workspaceId: route.workspaceId,
      actorId: user.id,
      input,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: created.id,
      actor: { type: 'user', id: user.id },
      action: 'project.create',
      requestId,
      resourceType: 'project',
      resourceId: created.id,
      metadata: {
        name: created.name,
        visibility: created.visibility,
        join_policy: created.join_policy,
      },
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'item' && method === 'GET' && route.workspaceId && route.projectId) {
    const found = await deps.getProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const discoverable = await canActorDiscoverProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      projectOwnerId: found.owner_id,
      projectVisibility: found.visibility,
      actorUserId: user.id,
    });
    if (!discoverable) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'project_not_found' });
      return true;
    }
    json(res, 200, {
      ...found,
      admin_member_ids: await readProjectAdminMemberIds(deps, route.workspaceId, route.projectId, found.owner_id),
      groups: await readProjectActorGroups({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        ownerId: found.owner_id,
        actorUserId: user.id,
      }),
      permissions: [
        ...await resolveVisibleProjectPermissionsForActor({
          docStore: deps.docStore,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          projectOwnerId: found.owner_id,
          projectGovernance: found.governance_json,
          actorUserId: user.id,
        }),
      ],
    });
    return true;
  }

  if (route.kind === 'item' && method === 'PATCH' && route.workspaceId && route.projectId) {
    const requestId = readRequestId(req);
    const raw = await readBody(req);
    const input = UpdateProjectRequestSchema.parse(raw);
    const actorWorkspacePermissions = await resolveWorkspacePermissions({
      workspaceId: route.workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      defaultWorkspaceId: defaultWorkspace?.id,
    });
    let existingProject: Awaited<ReturnType<typeof deps.getProjectUseCase.execute>> | null = null;
    try {
      existingProject = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
    } catch {
      existingProject = null;
    }
    const touchesProjectAdmins =
      typeof input.governance_json === 'object' &&
      input.governance_json !== null &&
      Object.prototype.hasOwnProperty.call(input.governance_json, 'project_admins');
    if (touchesProjectAdmins) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'legacy_project_admin_list_removed_use_admin_group',
      });
      return true;
    }
    const touchesProjectOwner =
      typeof input.owner_id === 'string' &&
      input.owner_id.trim().length > 0 &&
      existingProject !== null &&
      input.owner_id.trim() !== existingProject.owner_id;
    const existingProjectPermissions = existingProject
      ? await resolveVisibleProjectPermissionsForActor({
        docStore: deps.docStore,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        projectOwnerId: existingProject.owner_id,
        projectGovernance: existingProject.governance_json,
        actorUserId: user.id,
      })
      : [];
    if (
      touchesProjectOwner &&
      existingProject &&
      !existingProjectPermissions.includes('project:lifecycle:update') &&
      !actorWorkspacePermissions.includes('workspace:governance:update')
    ) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.owner.transferred',
        result: 'error',
        requestId,
        resourceType: 'project',
        resourceId: route.projectId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_or_workspace_admin_required',
        metadata: {
          previous_owner_id: existingProject.owner_id,
          next_owner_id: input.owner_id?.trim(),
        },
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_or_workspace_admin_required' });
      return true;
    }
    let normalizedInput = input;
    if (touchesProjectOwner && existingProject) {
      const requestedGovernance = typeof input.governance_json === 'object' && input.governance_json !== null
        ? input.governance_json
        : {};
      normalizedInput = {
        ...input,
        governance_json: {
          ...(typeof existingProject.governance_json === 'object' && existingProject.governance_json !== null
            ? existingProject.governance_json
            : {}),
          ...requestedGovernance,
        },
      };
    }
    try {
      const updated = await deps.updateProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input: normalizedInput,
      });
      if (touchesProjectOwner && existingProject) {
        const retainedAdmins = new Set(await readProjectAdminMemberIds(deps, route.workspaceId, route.projectId, existingProject.owner_id));
        retainedAdmins.add(existingProject.owner_id);
        retainedAdmins.delete(updated.owner_id);
        await setProjectAdminGroupMembersPersisted({
          docStore: deps.docStore,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          memberIds: [...retainedAdmins],
        });
      }
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.update',
        requestId,
        resourceType: 'project',
        resourceId: route.projectId,
        metadata: {
          name: updated.name,
          visibility: updated.visibility,
          join_policy: updated.join_policy,
          updated_fields: Object.keys(normalizedInput).sort(),
        },
      });
      if (touchesProjectOwner && existingProject) {
        await writeProjectAuditEvent(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actor: { type: 'user', id: user.id },
          action: 'project.owner.transferred',
          requestId,
          resourceType: 'project',
          resourceId: route.projectId,
          metadata: {
            previous_owner_id: existingProject.owner_id,
            next_owner_id: updated.owner_id,
            previous_owner_retained_admin: true,
          },
        });
      }
      json(res, 200, updated);
    } catch (error) {
      if (error instanceof Error && error.message === 'project_not_found') {
        await writeProjectAuditEvent(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actor: { type: 'user', id: user.id },
          action: 'project.update',
          result: 'error',
          requestId,
          resourceType: 'project',
          resourceId: route.projectId,
          errorCode: 'RESOURCE_NOT_FOUND',
          errorMessage: 'project_not_found',
          metadata: {
            updated_fields: Object.keys(input).sort(),
          },
        });
      }
      throw error;
    }
    return true;
  }

  if (route.kind === 'item' && method === 'DELETE' && route.workspaceId && route.projectId) {
    const requestId = readRequestId(req);
    let existingProjectName: string | undefined;
    let existingProjectOwnerId: string | undefined;
    try {
      const existing = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      existingProjectName = existing.name;
      existingProjectOwnerId = existing.owner_id;
    } catch {
      // Best-effort project summary for audit metadata; delete flow still owns
      // authoritative existence checks.
    }
    const deletePermissionContext = existingProjectOwnerId
      ? await readProjectPermissionContext({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
      })
      : null;
    if (existingProjectOwnerId && !deletePermissionContext?.permissions.includes('project:lifecycle:update')) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.delete',
        result: 'error',
        requestId,
        resourceType: 'project',
        resourceId: route.projectId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_required',
        metadata: existingProjectName ? { name: existingProjectName } : undefined,
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    try {
      await deps.deleteProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.delete',
        requestId,
        resourceType: 'project',
        resourceId: route.projectId,
        metadata: existingProjectName ? { name: existingProjectName } : undefined,
      });
      res.statusCode = 204;
      res.end();
    } catch (error) {
      if (error instanceof Error && error.message === 'project_not_found') {
        await writeProjectAuditEvent(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actor: { type: 'user', id: user.id },
          action: 'project.delete',
          result: 'error',
          requestId,
          resourceType: 'project',
          resourceId: route.projectId,
          errorCode: 'RESOURCE_NOT_FOUND',
          errorMessage: 'project_not_found',
        });
      }
      throw error;
    }
    return true;
  }

  return false;
}
