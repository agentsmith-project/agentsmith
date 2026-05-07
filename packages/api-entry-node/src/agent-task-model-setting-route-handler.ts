import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  AgentTaskModelResolutionError,
  AgentTaskModelSettingConflictError,
  AgentTaskModelSettingService,
  resolveEndpointDefaultAgentTaskModel,
} from './agent-task-model-setting-service.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { evaluateProjectPermissions } from './project-authz-engine.js';

type AgentTaskModelSettingRoute = {
  kind: 'agentTaskModelSetting';
  workspaceId: string;
  projectId: string;
};

type AgentTaskModelSettingRouteArgs = {
  route: AgentTaskModelSettingRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
};

function readObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

async function actorHasPermission(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  permission: string;
}): Promise<boolean> {
  try {
    const project = await args.deps.getProjectUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    const evaluation = await evaluateProjectPermissions({
      docStore: args.deps.docStore,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId: args.actorUserId,
      requiredPermissions: [args.permission],
    });
    return evaluation.decisions.every((decision) => decision.granted);
  } catch {
    return false;
  }
}

function readRequestId(req: http.IncomingMessage): string | null {
  return typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
}

export async function handleAgentTaskModelSettingRoute(args: AgentTaskModelSettingRouteArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody } = args;
  if (route.kind !== 'agentTaskModelSetting') return false;

  const service = new AgentTaskModelSettingService(deps);

  if (method === 'GET') {
    const [canUseAgentTasks, canUpdateGovernance] = await Promise.all([
      actorHasPermission({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        permission: 'project:agent_task:use',
      }),
      actorHasPermission({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        permission: 'project:governance:update',
      }),
    ]);
    if (!canUseAgentTasks && !canUpdateGovernance) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'forbidden',
        missing_permissions: ['project:agent_task:use'],
      });
      return true;
    }

    const readiness = await service.getReadiness({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorUserId: user.id,
    });
    if (!canUpdateGovernance) {
      json(res, 200, {
        readiness: {
          state: readiness.state,
          display_summary: readiness.display_summary,
        },
      });
      return true;
    }

    const setting = await service.getSetting(route.workspaceId, route.projectId);
    const endpoint = setting
      ? await deps.endpointResourceService.getEndpoint(route.workspaceId, route.projectId, setting.endpoint_id)
      : null;
    json(res, 200, {
      readiness,
      ...(setting && endpoint
        ? {
          setting: {
            endpoint_id: setting.endpoint_id,
            endpoint_display_name: endpoint.name,
            default_model: resolveEndpointDefaultAgentTaskModel(endpoint),
            setting_revision: setting.setting_revision,
            updated_at: setting.updated_at,
            updated_by_user_id: setting.updated_by_user_id,
          },
        }
        : {}),
      actions: {
        update: {
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });
    return true;
  }

  if (method === 'PATCH') {
    const body = readObject(await readBody(req));
    const endpointId = typeof body.endpoint_id === 'string' ? body.endpoint_id.trim() : '';
    if (!endpointId) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'endpoint_id_required',
        field: 'endpoint_id',
      });
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'expected_setting_revision')) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'expected_setting_revision_required',
        field: 'expected_setting_revision',
      });
      return true;
    }
    const expectedSettingRevision = typeof body.expected_setting_revision === 'string'
      ? body.expected_setting_revision.trim()
      : body.expected_setting_revision === null
        ? null
        : '';
    if (expectedSettingRevision === '') {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'expected_setting_revision_required',
        field: 'expected_setting_revision',
      });
      return true;
    }
    try {
      const before = await service.getSetting(route.workspaceId, route.projectId);
      const updated = await service.patchSetting({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId,
        expectedSettingRevision,
        actorUserId: user.id,
      });
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'agent_task_model_setting.update',
        requestId: readRequestId(req),
        resourceType: 'project',
        resourceId: route.projectId,
        metadata: {
          before_endpoint_id: before?.endpoint_id ?? null,
          before_setting_revision: before?.setting_revision ?? null,
          after_endpoint_id: updated.endpoint_id,
          after_setting_revision: updated.setting_revision,
        },
      });
      const endpoint = await deps.endpointResourceService.getEndpoint(
        route.workspaceId,
        route.projectId,
        updated.endpoint_id,
      );
      json(res, 200, {
        setting: {
          endpoint_id: updated.endpoint_id,
          endpoint_display_name: endpoint?.name ?? null,
          default_model: endpoint ? resolveEndpointDefaultAgentTaskModel(endpoint) : null,
          setting_revision: updated.setting_revision,
          updated_at: updated.updated_at,
          updated_by_user_id: updated.updated_by_user_id,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof AgentTaskModelSettingConflictError) {
        json(res, 409, {
          error_code: error.code,
          message: error.code,
        });
        return true;
      }
      if (error instanceof AgentTaskModelResolutionError) {
        json(res, error.statusCode, {
          error_code: error.code,
          message: error.code,
        });
        return true;
      }
      throw error;
    }
  }

  return false;
}
