import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
} from '@mbos/contracts';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  resolveVisibleProjectPermissionsForActor,
  resolveVisibleProjectRoleForActor,
} from './project-authz-engine.js';
import type { ProjectSourceRouteContext } from './project-source-route-types.js';
import {
  readProjectPermissionContext,
  readRequestId,
} from './project-source-route-handler-utils.js';
import {
  isProjectAdmin,
  readProjectAdminIds,
  resolveWorkspacePermissions,
} from './workspace-permissions.js';

export async function handleProjectCrudRoutes(context: ProjectSourceRouteContext): Promise<boolean> {
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
    json(res, 200, {
      items: listed.items.map((item) => ({
        ...item,
        role: resolveVisibleProjectRoleForActor({
          workspaceId,
          projectId: item.id,
          projectOwnerId: item.owner_id,
          projectGovernance: item.governance_json,
          actorUserId: user.id,
        }),
        permissions: [
          ...resolveVisibleProjectPermissionsForActor({
            workspaceId,
            projectId: item.id,
            projectOwnerId: item.owner_id,
            projectGovernance: item.governance_json,
            actorUserId: user.id,
          }),
        ],
      })),
    });
    return true;
  }

  if (route.kind === 'collection' && method === 'POST' && route.workspaceId) {
    const requestId = readRequestId(req);
    const raw = await readBody(req);
    const input = CreateProjectRequestSchema.parse(raw);
    const actorPermissions = resolveWorkspacePermissions({
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
    json(res, 200, {
      ...found,
      role: resolveVisibleProjectRoleForActor({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        projectOwnerId: found.owner_id,
        projectGovernance: found.governance_json,
        actorUserId: user.id,
      }),
      permissions: [
        ...resolveVisibleProjectPermissionsForActor({
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
    const actorWorkspacePermissions = resolveWorkspacePermissions({
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
    const touchesProjectOwner =
      typeof input.owner_id === 'string' &&
      input.owner_id.trim().length > 0 &&
      existingProject !== null &&
      input.owner_id.trim() !== existingProject.owner_id;
    const existingProjectPermissions = existingProject
      ? resolveVisibleProjectPermissionsForActor({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        projectOwnerId: existingProject.owner_id,
        projectGovernance: existingProject.governance_json,
        actorUserId: user.id,
      })
      : [];
    if (touchesProjectAdmins && existingProject && !existingProjectPermissions.includes('project:admins:update')) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.update',
        result: 'error',
        requestId,
        resourceType: 'project',
        resourceId: route.projectId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_required',
        metadata: {
          updated_fields: Object.keys(input).sort(),
        },
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
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
      const previousOwnerId = existingProject.owner_id;
      const nextOwnerId = input.owner_id!.trim();
      const requestedGovernance = typeof input.governance_json === 'object' && input.governance_json !== null
        ? input.governance_json
        : {};
      const requestedAdmins = readProjectAdminIds(requestedGovernance);
      const existingAdmins = readProjectAdminIds(existingProject.governance_json);
      const nextAdmins = Array.from(new Set([...existingAdmins, ...requestedAdmins]))
        .filter((item) => item !== nextOwnerId);
      if (!nextAdmins.includes(previousOwnerId)) {
        nextAdmins.push(previousOwnerId);
      }
      normalizedInput = {
        ...input,
        governance_json: {
          ...(typeof existingProject.governance_json === 'object' && existingProject.governance_json !== null
            ? existingProject.governance_json
            : {}),
          ...requestedGovernance,
          project_admins: nextAdmins,
        },
      };
    }
    try {
      const updated = await deps.updateProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input: normalizedInput,
      });
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
