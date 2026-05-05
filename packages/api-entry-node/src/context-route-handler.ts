import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  deleteContextEntry,
  getContextEntry,
  isContextContentType,
  isContextScope,
  canAgentWriteContextScope,
  listContextEntries,
  normalizeContextKey,
  normalizeTarget,
  putContextEntry,
  type ContextContentType,
  type ContextEntryRecord,
  type ContextScope,
  type ContextTarget,
} from './context-store.js';
import { evaluateProjectPermissions, resolveProjectAuthorizationSnapshot } from './project-authz-engine.js';
import { resolveWorkspacePermissions } from './workspace-permissions.js';
import type { ResolvedInternalTicket } from './internal-ticket-store.js';
import { isAgentExecutionTicket } from './internal-ticket-store.js';
import { loadProjectTasks } from './notebook-task/task-store.js';
import { findTaskById } from './notebook-task/task-runtime-state.js';
import {
  buildManagedCredentialEntries,
  buildManagedCredentialProjection,
  resolveManagedCredentialConnection,
} from './managed-credential-resolver.js';
import type { UserExternalConnectionProvider } from './user-external-connections-store.js';

type ContextRouteHandlerArgs = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  requestUrl: URL;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  internalTicket?: ResolvedInternalTicket | null;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
};

type ResolvedContextAccess = {
  target: ContextTarget;
  writeAllowed: boolean;
  includeManagedCredentialProjections: boolean;
};

function presentContextEntry(record: ContextEntryRecord) {
  return {
    ...record,
  };
}

function errorCodeForStatus(status: number): string {
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  return 'INVALID_REQUEST';
}

async function findOwnedTask(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  ownerUserId: string;
}): Promise<boolean> {
  const inMemory = findTaskById(args.taskId);
  if (inMemory) {
    return inMemory.workspace_id === args.workspaceId
      && inMemory.project_id === args.projectId
      && inMemory.owner_user_id === args.ownerUserId;
  }
  const loaded = await loadProjectTasks(args.deps, args.workspaceId, args.projectId);
  return loaded.some((item) => item.id === args.taskId && item.owner_user_id === args.ownerUserId);
}

function readRequestIdentifiers(input: Record<string, unknown> | URLSearchParams): {
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
} {
  const read = (key: string): string | null => {
    if (input instanceof URLSearchParams) {
      return input.get(key)?.trim() || null;
    }
    const value = input[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return {
    workspaceId: read('workspace_id'),
    projectId: read('project_id'),
    taskId: read('task_id'),
  };
}

async function resolveContextAccess(args: {
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  internalTicket?: ResolvedInternalTicket | null;
  scope: ContextScope;
  key: string;
  identifiers: {
    workspaceId?: string | null;
    projectId?: string | null;
    taskId?: string | null;
  };
  writeIntent: boolean;
}): Promise<ResolvedContextAccess | { error: { status: number; message: string } }> {
  const { deps, user, internalTicket, scope, key, identifiers, writeIntent } = args;
  const isManagedCredentialKey = key.startsWith('managed_credentials.');
  if (writeIntent && isManagedCredentialKey) {
    return { error: { status: 403, message: 'context_managed_credentials_read_only' } };
  }

  if (isAgentExecutionTicket(internalTicket)) {
    const ticketWorkspaceId = internalTicket.workspace_id ?? null;
    const ticketProjectId = internalTicket.project_id ?? null;
    const ticketTaskId = internalTicket.payload.task_id ?? null;
    const ticketUserId = user.id;

    if ((scope === 'project' || scope === 'task') && !ticketProjectId) {
      return { error: { status: 403, message: 'context_project_scope_not_available' } };
    }
    if (scope === 'project_member' && !ticketProjectId) {
      return { error: { status: 403, message: 'context_project_member_scope_not_available' } };
    }
    if (scope === 'task' && !ticketTaskId) {
      return { error: { status: 403, message: 'context_task_scope_not_available' } };
    }
    if (scope === 'member' && !ticketWorkspaceId) {
      return { error: { status: 403, message: 'context_member_scope_not_available' } };
    }
    if (writeIntent && isAgentExecutionTicket(internalTicket) && !canAgentWriteContextScope(scope)) {
      return { error: { status: 403, message: 'context_scope_read_only_for_agent' } };
    }

    if (identifiers.workspaceId && ticketWorkspaceId && identifiers.workspaceId !== ticketWorkspaceId) {
      return { error: { status: 403, message: 'context_workspace_scope_mismatch' } };
    }
    if (identifiers.projectId && ticketProjectId && identifiers.projectId !== ticketProjectId) {
      return { error: { status: 403, message: 'context_project_scope_mismatch' } };
    }
    if (identifiers.taskId && ticketTaskId && identifiers.taskId !== ticketTaskId) {
      return { error: { status: 403, message: 'context_task_scope_mismatch' } };
    }

    return {
      target: normalizeTarget({
        scope,
        key,
        user_id: scope === 'member' || scope === 'task' || scope === 'project_member' ? ticketUserId : null,
        workspace_id: scope === 'member'
          || scope === 'workspace'
          || scope === 'project'
          || scope === 'task'
          || scope === 'project_member'
          ? ticketWorkspaceId
          : null,
        project_id: scope === 'project' || scope === 'task' || scope === 'project_member' ? ticketProjectId : null,
        task_id: scope === 'task' ? ticketTaskId : null,
      }),
      writeAllowed: canAgentWriteContextScope(scope),
      includeManagedCredentialProjections: scope === 'member',
    };
  }

  if (scope === 'member') {
    const workspaceId = identifiers.workspaceId ?? null;
    if (!workspaceId) {
      return { error: { status: 400, message: 'context_member_scope_requires_workspace_id' } };
    }
    return {
      target: normalizeTarget({
        scope,
        key,
        user_id: user.id,
        workspace_id: workspaceId,
      }),
      writeAllowed: true,
      includeManagedCredentialProjections: true,
    };
  }

  if (scope === 'project_member') {
    const workspaceId = identifiers.workspaceId ?? null;
    const projectId = identifiers.projectId ?? null;
    if (!workspaceId || !projectId) {
      return { error: { status: 400, message: 'context_project_member_scope_requires_ids' } };
    }
    const project = await deps.getProjectUseCase.execute({ workspaceId, projectId });
    const authorization = await resolveProjectAuthorizationSnapshot({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId: user.id,
    });
    if (authorization.membership_status !== 'active') {
      return { error: { status: 404, message: 'context_not_found' } };
    }
    return {
      target: normalizeTarget({
        scope,
        key,
        user_id: user.id,
        workspace_id: workspaceId,
        project_id: projectId,
      }),
      writeAllowed: true,
      includeManagedCredentialProjections: false,
    };
  }

  if (scope === 'task') {
    const workspaceId = identifiers.workspaceId ?? null;
    const projectId = identifiers.projectId ?? null;
    const taskId = identifiers.taskId ?? null;
    if (!workspaceId || !projectId || !taskId) {
      return { error: { status: 400, message: 'context_task_scope_requires_ids' } };
    }
    const owned = await findOwnedTask({
      deps,
      workspaceId,
      projectId,
      taskId,
      ownerUserId: user.id,
    });
    if (!owned) {
      return { error: { status: 404, message: 'context_task_not_found' } };
    }
    return {
      target: normalizeTarget({
        scope,
        key,
        user_id: user.id,
        workspace_id: workspaceId,
        project_id: projectId,
        task_id: taskId,
      }),
      writeAllowed: true,
      includeManagedCredentialProjections: false,
    };
  }

  if (scope === 'project') {
    const workspaceId = identifiers.workspaceId ?? null;
    const projectId = identifiers.projectId ?? null;
    if (!workspaceId || !projectId) {
      return { error: { status: 400, message: 'context_project_scope_requires_ids' } };
    }
    const project = await deps.getProjectUseCase.execute({ workspaceId, projectId });
    const evaluation = await evaluateProjectPermissions({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId: user.id,
      requiredPermissions: ['project:governance:update'],
    });
    if (!evaluation.decisions.every((item) => item.granted)) {
      return { error: { status: 403, message: 'context_project_forbidden' } };
    }
    return {
      target: normalizeTarget({
        scope,
        key,
        workspace_id: workspaceId,
        project_id: projectId,
      }),
      writeAllowed: true,
      includeManagedCredentialProjections: false,
    };
  }

  const workspaceId = identifiers.workspaceId ?? null;
  if (!workspaceId) {
    return { error: { status: 400, message: 'context_workspace_scope_requires_workspace_id' } };
  }
  const permissions = await resolveWorkspacePermissions({
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
  });
  if (!permissions.includes('workspace:governance:update')) {
    return { error: { status: 403, message: 'context_workspace_forbidden' } };
  }
  return {
    target: normalizeTarget({
      scope,
      key,
      workspace_id: workspaceId,
    }),
    writeAllowed: true,
    includeManagedCredentialProjections: false,
  };
}

function parseScopeAndKey(input: URLSearchParams | Record<string, unknown>): {
  scope: ContextScope | null;
  key: string | null;
} {
  const rawScope = input instanceof URLSearchParams ? input.get('scope') : input.scope;
  const rawKey = input instanceof URLSearchParams ? input.get('key') : input.key;
  return {
    scope: isContextScope(rawScope) ? rawScope : null,
    key: normalizeContextKey(rawKey),
  };
}

async function handleManagedCredentialRefresh(args: {
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  internalTicket?: ResolvedInternalTicket | null;
  provider: string;
  workspaceId?: string | null;
  projectId?: string | null;
}): Promise<ContextEntryRecord | { error: { status: number; message: string } }> {
  if (isAgentExecutionTicket(args.internalTicket)) {
    const ticketWorkspaceId = args.internalTicket.workspace_id ?? null;
    const ticketProjectId = args.internalTicket.project_id ?? null;
    if (args.workspaceId && ticketWorkspaceId && args.workspaceId !== ticketWorkspaceId) {
      return { error: { status: 403, message: 'context_workspace_scope_mismatch' } };
    }
    if (args.projectId && !ticketProjectId) {
      return { error: { status: 403, message: 'context_project_member_scope_not_available' } };
    }
    if (args.projectId && ticketProjectId && args.projectId !== ticketProjectId) {
      return { error: { status: 403, message: 'context_project_scope_mismatch' } };
    }
  }
  if (args.provider !== 'feishu') {
    return { error: { status: 422, message: 'context_managed_credential_refresh_not_supported' } };
  }
  const resolved = await resolveManagedCredentialConnection({
    docStore: args.deps.docStore,
    userId: args.user.id,
    provider: 'feishu',
    workspaceId: args.workspaceId ?? null,
    projectId: args.projectId ?? null,
  });
  if (!resolved) {
    return { error: { status: 404, message: 'context_managed_credential_not_found' } };
  }
  const { refreshFeishuOAuth } = await import('./feishu-oauth.js');
  await refreshFeishuOAuth({
    docStore: args.deps.docStore,
    userId: args.user.id,
    connectionId: resolved.connection.id,
  });
  const projected = await buildManagedCredentialProjection({
    docStore: args.deps.docStore,
    userId: args.user.id,
    provider: 'feishu',
    workspaceId: args.workspaceId ?? null,
    projectId: args.projectId ?? null,
  });
  if (!projected) {
    return { error: { status: 404, message: 'context_managed_credential_not_found' } };
  }
  return projected;
}

export async function handleContextRoute(args: ContextRouteHandlerArgs): Promise<boolean> {
  const { req, res, method, requestUrl, deps, user, internalTicket, json, readBody } = args;
  if (requestUrl.pathname === '/api/v1/context/list') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const { scope } = parseScopeAndKey(requestUrl.searchParams);
    if (!scope) {
      json(res, 400, { error_code: 'INVALID_REQUEST', message: 'context_scope_required' });
      return true;
    }
    const identifiers = readRequestIdentifiers(requestUrl.searchParams);
    const resolved = await resolveContextAccess({
      deps,
      user,
      internalTicket,
      scope,
      key: '__list__',
      identifiers,
      writeIntent: false,
    });
    if ('error' in resolved) {
      json(res, resolved.error.status, { error_code: errorCodeForStatus(resolved.error.status), message: resolved.error.message });
      return true;
    }
    const stored = await listContextEntries(deps.docStore, {
      scope: resolved.target.scope,
      user_id: resolved.target.user_id,
      task_id: resolved.target.task_id,
      project_id: resolved.target.project_id,
      workspace_id: resolved.target.workspace_id,
    });
    const items = stored.map(presentContextEntry);
    if (resolved.includeManagedCredentialProjections) {
      const projections = await buildManagedCredentialEntries({
        docStore: deps.docStore,
        userId: user.id,
        workspaceId: resolved.target.workspace_id ?? identifiers.workspaceId ?? null,
        projectId: identifiers.projectId ?? resolved.target.project_id ?? null,
      });
      items.push(...projections.map(presentContextEntry));
      items.sort((left, right) => left.key.localeCompare(right.key));
    }
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (requestUrl.pathname === '/api/v1/context') {
    if (method === 'GET') {
      const { scope, key } = parseScopeAndKey(requestUrl.searchParams);
      if (!scope || !key) {
        json(res, 400, { error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' });
        return true;
      }
      const identifiers = readRequestIdentifiers(requestUrl.searchParams);
      const resolved = await resolveContextAccess({
        deps,
        user,
        internalTicket,
        scope,
        key,
        identifiers,
        writeIntent: false,
      });
      if ('error' in resolved) {
        json(res, resolved.error.status, { error_code: errorCodeForStatus(resolved.error.status), message: resolved.error.message });
        return true;
      }
      if (scope === 'member' && key.startsWith('managed_credentials.')) {
        const provider = key.slice('managed_credentials.'.length);
        const projected = await buildManagedCredentialProjection({
          docStore: deps.docStore,
          userId: user.id,
          provider: provider as UserExternalConnectionProvider,
          workspaceId: identifiers.workspaceId ?? resolved.target.workspace_id ?? null,
          projectId: identifiers.projectId ?? resolved.target.project_id ?? null,
        });
        if (!projected) {
          json(res, 404, { error_code: 'NOT_FOUND', message: 'context_not_found' });
          return true;
        }
        json(res, 200, presentContextEntry(projected));
        return true;
      }
      const entry = await getContextEntry(deps.docStore, resolved.target);
      if (!entry) {
        json(res, 404, { error_code: 'NOT_FOUND', message: 'context_not_found' });
        return true;
      }
      json(res, 200, presentContextEntry(entry));
      return true;
    }

    if (method === 'PUT') {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      const { scope, key } = parseScopeAndKey(body ?? {});
      if (!scope || !key) {
        json(res, 400, { error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' });
        return true;
      }
      const content = typeof body?.content === 'string' ? body.content : '';
      const contentType = isContextContentType(body?.content_type) ? body?.content_type : 'text';
      const identifiers = readRequestIdentifiers(body ?? {});
      const resolved = await resolveContextAccess({
        deps,
        user,
        internalTicket,
        scope,
        key,
        identifiers,
        writeIntent: true,
      });
      if ('error' in resolved) {
        json(res, resolved.error.status, { error_code: errorCodeForStatus(resolved.error.status), message: resolved.error.message });
        return true;
      }
      if (!resolved.writeAllowed) {
        json(res, 403, { error_code: 'FORBIDDEN', message: 'context_write_forbidden' });
        return true;
      }
      const saved = await putContextEntry(deps.docStore, {
        ...resolved.target,
        content,
        content_type: contentType as ContextContentType,
        updated_by: user.id,
      });
      json(res, 200, presentContextEntry(saved));
      return true;
    }

    if (method === 'DELETE') {
      const { scope, key } = parseScopeAndKey(requestUrl.searchParams);
      if (!scope || !key) {
        json(res, 400, { error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' });
        return true;
      }
      const identifiers = readRequestIdentifiers(requestUrl.searchParams);
      const resolved = await resolveContextAccess({
        deps,
        user,
        internalTicket,
        scope,
        key,
        identifiers,
        writeIntent: true,
      });
      if ('error' in resolved) {
        json(res, resolved.error.status, { error_code: errorCodeForStatus(resolved.error.status), message: resolved.error.message });
        return true;
      }
      if (!resolved.writeAllowed) {
        json(res, 403, { error_code: 'FORBIDDEN', message: 'context_write_forbidden' });
        return true;
      }
      const deleted = await deleteContextEntry(deps.docStore, resolved.target);
      if (!deleted) {
        json(res, 404, { error_code: 'NOT_FOUND', message: 'context_not_found' });
        return true;
      }
      res.statusCode = 204;
      res.end();
      return true;
    }

    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  const refreshMatch = requestUrl.pathname.match(/^\/api\/v1\/context\/managed-credentials\/([^/]+)\/refresh$/);
  if (refreshMatch) {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const provider = decodeURIComponent(refreshMatch[1] ?? '');
    const identifiers = readRequestIdentifiers(requestUrl.searchParams);
    const refreshed = await handleManagedCredentialRefresh({
      deps,
      user,
      internalTicket,
      provider,
      workspaceId: identifiers.workspaceId ?? internalTicket?.workspace_id ?? null,
      projectId: identifiers.projectId ?? internalTicket?.project_id ?? null,
    });
    if ('error' in refreshed) {
      json(res, refreshed.error.status, { error_code: errorCodeForStatus(refreshed.error.status), message: refreshed.error.message });
      return true;
    }
    json(res, 200, presentContextEntry(refreshed));
    return true;
  }

  return false;
}
