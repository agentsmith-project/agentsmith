import type http from 'node:http';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateSourceFolderRequestSchema,
  CreateAIReadyJobRequestSchema,
  DeleteSourceObjectsRequestSchema,
  ListSourceObjectsQuerySchema,
  MoveSourceObjectRequestSchema,
  SourceObjectShareLinkCreateRequestSchema,
  SourceObjectDownloadQuerySchema,
  CreateProjectRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  UpdateProjectRequestSchema,
  UpdateSourceLibraryRequestSchema,
} from '@mbos/contracts';
import { drainJobQueue } from '@mbos/application';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  getProjectResourcePolicyOrDefault,
  upsertProjectResourcePolicy,
} from './project-resource-policy-store.js';
import {
  getProjectGroupsState,
  setProjectGroupsState,
} from './project-groups-store.js';

interface WorkspaceRecordLike {
  id: string;
  created_at: string;
}

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  joinId?: string;
  groupId?: string;
  templateId?: string;
  resourceType?: string;
  resourceId?: string;
  libraryId?: string;
  jobId?: string;
  sourceId?: string;
}

interface ProjectSourceHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  requestUrl: URL;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  ownerWorkspacePermissions: readonly string[];
  resolveProjectPermissions: (ownerId: string, actorId: string) => readonly string[];
}

const DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME = 'My Uploads';
const PROJECT_JOIN_REQUESTS_BY_PROJECT = new Map<string, Array<{
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  reject_reason?: string;
}>>();
const PROJECT_PERMISSION_TEMPLATES_BY_PROJECT = new Map<string, Array<{
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permissions: string[];
  built_in?: boolean;
  created_at: string;
  updated_at: string;
}>>();
const PROJECT_QUOTA_TEMPLATES_BY_PROJECT = new Map<string, Array<{
  id: string;
  project_id: string;
  name: string;
  description?: string;
  overrides_json: Record<string, unknown>;
  built_in?: boolean;
  created_at: string;
  updated_at: string;
}>>();
const PROJECT_MEMBER_PERMISSIONS_BY_PROJECT = new Map<string, Map<string, {
  mode: 'template' | 'custom';
  template?: string | null;
  permissions: string[];
}>>();
const PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT = new Map<string, Map<string, {
  overrides: Record<string, unknown>;
  history: Array<{
    id: string;
    created_at: string;
    created_by_user_id: string;
    overrides_json: Record<string, unknown>;
  }>;
}>>();
const PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT = new Map<string, Map<string, Array<{
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'quota' | 'resource_policy' | 'role';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}>>>();

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

function getMemberPermissionsState(workspaceId: string, projectId: string) {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_PERMISSIONS_BY_PROJECT.get(key);
  if (existing) return existing;
  const map = new Map<string, { mode: 'template' | 'custom'; template?: string | null; permissions: string[] }>();
  PROJECT_MEMBER_PERMISSIONS_BY_PROJECT.set(key, map);
  return map;
}

function getMemberQuotaState(workspaceId: string, projectId: string) {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT.get(key);
  if (existing) return existing;
  const map = new Map<string, {
    overrides: Record<string, unknown>;
    history: Array<{ id: string; created_at: string; created_by_user_id: string; overrides_json: Record<string, unknown> }>;
  }>();
  PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT.set(key, map);
  return map;
}

function getMemberChangeHistoryState(workspaceId: string, projectId: string) {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT.get(key);
  if (existing) return existing;
  const map = new Map<string, Array<{
    id: string;
    timestamp: string;
    actor_id: string;
    actor_email: string;
    change_type: 'permissions' | 'quota' | 'resource_policy' | 'role';
    changes: { added?: string[]; removed?: string[]; updated?: Record<string, { from: unknown; to: unknown }> };
  }>>();
  PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT.set(key, map);
  return map;
}

function isDefaultPersonalLibraryForUser(
  library: { name: string; created_by_user_id: string; system_managed_kind?: string },
  userId: string,
) {
  return (
    library.created_by_user_id === userId
    && (
      library.system_managed_kind === 'default_personal_uploads'
      || library.name === DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME
    )
  );
}

async function parseUploadAndExecute(
  req: http.IncomingMessage,
  execute: (input: {
    fileName: string;
    fileStream: WebReadableStream<Uint8Array>;
    contentType?: string;
    contentLength?: number;
    prefix?: string;
    overwrite?: boolean;
  }) => Promise<unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let prefix: string | undefined;
    let overwrite = false;
    let uploadPromise: Promise<unknown> | null = null;
    let fileSeen = false;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    busboy.on('field', (name, value) => {
      if (name === 'prefix') {
        prefix = value;
      } else if (name === 'overwrite') {
        overwrite = value === 'true' || value === '1';
      }
    });

    busboy.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      fileSeen = true;
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      const originalFileName = info.filename || 'upload.bin';
      const latin1ToUtf8 = Buffer.from(originalFileName, 'latin1').toString('utf8');
      const hasCjk = (value: string) => /[\u3400-\u9FFF]/.test(value);
      const decodedFileName =
        (originalFileName.includes('�') && !latin1ToUtf8.includes('�')) ||
        (!hasCjk(originalFileName) && hasCjk(latin1ToUtf8))
          ? latin1ToUtf8
          : originalFileName;
      uploadPromise = execute({
        fileName: decodedFileName,
        fileStream,
        contentType: info.mimeType || 'application/octet-stream',
        prefix,
        overwrite,
      });
      uploadPromise.catch((error) => settle(() => reject(error)));
    });

    busboy.on('error', (error) => settle(() => reject(error)));
    busboy.on('finish', async () => {
      if (!fileSeen || !uploadPromise) {
        settle(() => reject(new Error('file_required')));
        return;
      }
      try {
        const result = await uploadPromise;
        settle(() => resolve(result));
      } catch (error) {
        settle(() => reject(error));
      }
    });

    req.pipe(busboy);
  });
}

export async function handleProjectSourceRoute(args: ProjectSourceHandlerArgs): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    requestUrl,
    json,
    readBody,
    ownerWorkspacePermissions,
    resolveProjectPermissions,
  } = args;

  if (route.kind === 'workspacesCollection' && method === 'GET') {
    json(res, 200, { items: workspaces, total: workspaces.length });
    return true;
  }

  if (route.kind === 'workspaceItem' && method === 'GET' && route.workspaceId) {
    const found = workspaces.find((item) => item.id === route.workspaceId);
    if (!found) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    json(res, 200, found);
    return true;
  }

  if (route.kind === 'workspaceMembers' && method === 'GET' && route.workspaceId) {
    if (!defaultWorkspace || route.workspaceId !== defaultWorkspace.id) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    const member = {
      id: `wm_${user.id}`,
      user_id: user.id,
      name: user.name,
      email: user.email,
      role: 'owner',
      governance_group: 'wheel',
      permissions: [...ownerWorkspacePermissions],
      status: 'active',
      joined_at: defaultWorkspace.created_at,
    };
    json(res, 200, { items: [member], total: 1 });
    return true;
  }

  const workspaceIdInRoute = route.workspaceId ?? null;
  if (workspaceIdInRoute && !workspaces.some((item) => item.id === workspaceIdInRoute)) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  if (route.kind === 'collection' && method === 'GET' && route.workspaceId) {
    const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
    json(res, 200, {
      items: listed.items.map((item) => ({
        ...item,
        role: item.owner_id === user.id ? 'owner' : 'developer',
        permissions: [...resolveProjectPermissions(item.owner_id, user.id)],
      })),
    });
    return true;
  }

  if (route.kind === 'collection' && method === 'POST' && route.workspaceId) {
    const raw = await readBody(req);
    const input = CreateProjectRequestSchema.parse(raw);
    const created = await deps.createProjectUseCase.execute({
      workspaceId: route.workspaceId,
      actorId: user.id,
      input,
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
      role: found.owner_id === user.id ? 'owner' : 'developer',
      permissions: [...resolveProjectPermissions(found.owner_id, user.id)],
    });
    return true;
  }

  if (route.kind === 'item' && method === 'PATCH' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    const input = UpdateProjectRequestSchema.parse(raw);
    const updated = await deps.updateProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      input,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'item' && method === 'DELETE' && route.workspaceId && route.projectId) {
    await deps.deleteProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectMembers' && method === 'GET' && route.workspaceId && route.projectId) {
    let projectOwnerId: string | null = null;
    let projectCreatedAt: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      projectOwnerId = project.owner_id;
      projectCreatedAt = project.created_at;
    } catch {
      // Keep minimal members read endpoint usable in local/dev environments even
      // when membership/governance backend is not fully wired to project repo fixtures.
    }
    const role = projectOwnerId === user.id ? 'owner' : 'developer';
    const permissions = [...resolveProjectPermissions(projectOwnerId ?? user.id, user.id)];
    json(res, 200, {
      items: [
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role,
          permissions,
          status: 'active',
          joined_at: projectCreatedAt ?? new Date().toISOString(),
        },
      ],
      total: 1,
    });
    return true;
  }

  if (route.kind === 'projectJoinRequests' && method === 'GET' && route.workspaceId && route.projectId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key) ?? [];
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'projectJoinRequestApprove' && method === 'POST' && route.workspaceId && route.projectId && route.joinId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key) ?? [];
    const target = items.find((item) => item.id === route.joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    target.status = 'approved';
    target.reviewed_at = new Date().toISOString();
    target.reviewed_by = user.id;
    target.reject_reason = undefined;
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectJoinRequestReject' && method === 'POST' && route.workspaceId && route.projectId && route.joinId) {
    const body = await readBody(req);
    const reason = typeof (body as { reason?: unknown } | null)?.reason === 'string'
      ? (body as { reason?: string }).reason
      : undefined;
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key) ?? [];
    const target = items.find((item) => item.id === route.joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    target.status = 'rejected';
    target.reviewed_at = new Date().toISOString();
    target.reviewed_by = user.id;
    target.reject_reason = reason;
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectPermissionTemplates' && method === 'GET' && route.workspaceId && route.projectId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    json(res, 200, { items: PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.get(key) ?? [] });
    return true;
  }

  if (route.kind === 'projectPermissionTemplates' && method === 'POST' && route.workspaceId && route.projectId) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    if (!body || typeof body.name !== 'string' || body.name.trim().length === 0 || !Array.isArray(body.permissions)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'name and permissions are required' });
      return true;
    }
    const permissions = body.permissions.filter((v): v is string => typeof v === 'string');
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const now = new Date().toISOString();
    const created = {
      id: `pt_${Math.random().toString(36).slice(2, 10)}`,
      project_id: route.projectId,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      permissions,
      built_in: false,
      created_at: now,
      updated_at: now,
    };
    items.push(created);
    PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.set(key, items);
    json(res, 200, created);
    return true;
  }

  if (
    route.kind === 'projectPermissionTemplateItem'
    && method === 'PATCH'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const item = items.find((it) => it.id === route.templateId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (item.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be modified' });
      return true;
    }
    if (typeof body.name === 'string') item.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) item.description = body.description;
    if (Array.isArray(body.permissions)) {
      item.permissions = body.permissions.filter((v): v is string => typeof v === 'string');
    }
    item.updated_at = new Date().toISOString();
    json(res, 200, item);
    return true;
  }

  if (
    route.kind === 'projectPermissionTemplateItem'
    && method === 'DELETE'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const target = items.find((it) => it.id === route.templateId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (target.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' });
      return true;
    }
    PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.set(key, items.filter((it) => it.id !== route.templateId));
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectQuotaTemplates' && method === 'GET') {
    if (!route.workspaceId || !route.projectId) {
      json(res, 200, []);
      return true;
    }
    const key = projectScopedKey(route.workspaceId, route.projectId);
    json(res, 200, PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? []);
    return true;
  }

  if (route.kind === 'projectQuotaTemplates' && method === 'POST' && route.workspaceId && route.projectId) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      overrides_json?: Record<string, unknown>;
    };
    if (
      !body
      || typeof body.name !== 'string'
      || body.name.trim().length === 0
      || !body.overrides_json
      || typeof body.overrides_json !== 'object'
      || Array.isArray(body.overrides_json)
    ) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'name and overrides_json are required' });
      return true;
    }
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const now = new Date().toISOString();
    const created = {
      id: `qt_${Math.random().toString(36).slice(2, 10)}`,
      project_id: route.projectId,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      overrides_json: body.overrides_json,
      built_in: false,
      created_at: now,
      updated_at: now,
    };
    items.push(created);
    PROJECT_QUOTA_TEMPLATES_BY_PROJECT.set(key, items);
    json(res, 200, created);
    return true;
  }

  if (
    route.kind === 'projectQuotaTemplateItem'
    && method === 'GET'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const item = items.find((it) => it.id === route.templateId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Quota template not found' });
      return true;
    }
    json(res, 200, item);
    return true;
  }

  if (
    route.kind === 'projectQuotaTemplateItem'
    && method === 'PATCH'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      overrides_json?: Record<string, unknown>;
    };
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const item = items.find((it) => it.id === route.templateId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Quota template not found' });
      return true;
    }
    if (item.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be modified' });
      return true;
    }
    if (typeof body.name === 'string') item.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) item.description = body.description;
    if (body.overrides_json && typeof body.overrides_json === 'object' && !Array.isArray(body.overrides_json)) {
      item.overrides_json = body.overrides_json;
    }
    item.updated_at = new Date().toISOString();
    json(res, 200, item);
    return true;
  }

  if (
    route.kind === 'projectQuotaTemplateItem'
    && method === 'DELETE'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const target = items.find((it) => it.id === route.templateId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Quota template not found' });
      return true;
    }
    if (target.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' });
      return true;
    }
    PROJECT_QUOTA_TEMPLATES_BY_PROJECT.set(key, items.filter((it) => it.id !== route.templateId));
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (
    route.kind === 'projectQuotaTemplateApply'
    && method === 'POST'
    && route.workspaceId
    && route.projectId
    && route.templateId
  ) {
    const body = await readBody(req) as { member_ids?: string[] };
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key) ?? [];
    const template = items.find((it) => it.id === route.templateId);
    if (!template) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Quota template not found' });
      return true;
    }
    const memberIds = Array.isArray(body.member_ids)
      ? body.member_ids.filter((v): v is string => typeof v === 'string')
      : [];
    json(res, 200, { applied_count: memberIds.length });
    return true;
  }

  if (route.kind === 'projectGroups' && method === 'GET' && route.workspaceId && route.projectId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    json(res, 200, { items: getProjectGroupsState(route.workspaceId, route.projectId) });
    return true;
  }

  if (route.kind === 'projectGroups' && method === 'POST' && route.workspaceId && route.projectId) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    if (!body || typeof body.name !== 'string' || body.name.trim().length === 0 || typeof body.permission_template_id !== 'string') {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'name and permission_template_id are required' });
      return true;
    }
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const groups = getProjectGroupsState(route.workspaceId, route.projectId);
    const now = new Date().toISOString();
    const created = {
      id: `grp_${Math.random().toString(36).slice(2, 10)}`,
      project_id: route.projectId,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      permission_template_id: body.permission_template_id,
      member_ids: Array.isArray(body.member_ids) ? body.member_ids.filter((v): v is string => typeof v === 'string') : [],
      created_at: now,
      updated_at: now,
    };
    groups.push(created);
    setProjectGroupsState(route.workspaceId, route.projectId, groups);
    json(res, 200, created);
    return true;
  }

  if (route.kind === 'projectGroupItem' && method === 'PATCH' && route.workspaceId && route.projectId && route.groupId) {
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const groups = getProjectGroupsState(route.workspaceId, route.projectId);
    const group = groups.find((g) => g.id === route.groupId);
    if (!group) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Group not found' });
      return true;
    }
    if (typeof body.name === 'string') group.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) group.description = body.description;
    if (typeof body.permission_template_id === 'string') group.permission_template_id = body.permission_template_id;
    if (Array.isArray(body.member_ids)) {
      group.member_ids = body.member_ids.filter((v): v is string => typeof v === 'string');
    }
    group.updated_at = new Date().toISOString();
    json(res, 200, group);
    return true;
  }

  if (route.kind === 'projectGroupItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.groupId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const groups = getProjectGroupsState(route.workspaceId, route.projectId);
    const next = groups.filter((g) => g.id !== route.groupId);
    setProjectGroupsState(route.workspaceId, route.projectId, next);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectGroupApplyTemplate' && method === 'POST' && route.workspaceId && route.projectId && route.groupId) {
    const body = await readBody(req) as { member_ids?: string[] };
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const groups = getProjectGroupsState(route.workspaceId, route.projectId);
    const group = groups.find((g) => g.id === route.groupId);
    if (!group) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Group not found' });
      return true;
    }
    const memberIds = Array.isArray(body.member_ids) ? body.member_ids.filter((v): v is string => typeof v === 'string') : group.member_ids;
    json(res, 200, {
      applied_count: memberIds.length,
      results: memberIds.map((memberId) => ({ member_id: memberId, status: 'applied' })),
    });
    return true;
  }

  if (route.kind === 'projectMembershipItem' && method === 'GET') {
    const membershipRoute = route;
    if (!membershipRoute.workspaceId || !membershipRoute.projectId || !membershipRoute.userId) {
      return false;
    }
    let projectOwnerId: string | null = null;
    let projectCreatedAt: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId: membershipRoute.workspaceId,
        projectId: membershipRoute.projectId,
      });
      projectOwnerId = project.owner_id;
      projectCreatedAt = project.created_at;
    } catch {
      // Keep minimal membership read endpoint usable in local/dev fixtures.
    }
    const isCurrentUser = membershipRoute.userId === user.id;
    const role = projectOwnerId === membershipRoute.userId ? 'owner' : 'developer';
    json(res, 200, {
      project_id: membershipRoute.projectId,
      user_id: membershipRoute.userId,
      role,
      permissions: isCurrentUser ? [...resolveProjectPermissions(projectOwnerId ?? user.id, user.id)] : [],
      status: 'active',
      joined_at: projectCreatedAt ?? new Date().toISOString(),
    });
    return true;
  }

  if (route.kind === 'projectMemberPermissions' && method === 'GET' && route.workspaceId && route.projectId && route.userId) {
    const state = getMemberPermissionsState(route.workspaceId, route.projectId);
    const current = state.get(route.userId);
    json(res, 200, {
      platform_permissions: current?.permissions ?? [],
      resource_permissions: undefined,
    });
    return true;
  }

  if (route.kind === 'projectMemberPermissions' && method === 'PATCH' && route.workspaceId && route.projectId && route.userId) {
    const body = await readBody(req) as {
      template?: string | null;
      permissions?: string[];
      mode?: 'template' | 'custom';
    };
    if (!body || (body.mode !== 'template' && body.mode !== 'custom')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'mode is required' });
      return true;
    }
    const state = getMemberPermissionsState(route.workspaceId, route.projectId);
    const prev = state.get(route.userId) ?? { mode: 'custom' as const, template: null, permissions: [] };
    const nextPermissions = Array.isArray(body.permissions)
      ? body.permissions.filter((v): v is string => typeof v === 'string')
      : prev.permissions;
    const nextTemplate = body.mode === 'template'
      ? (typeof body.template === 'string' || body.template === null ? body.template : prev.template ?? null)
      : null;
    state.set(route.userId, {
      mode: body.mode,
      template: nextTemplate,
      permissions: nextPermissions,
    });
    const historyState = getMemberChangeHistoryState(route.workspaceId, route.projectId);
    const items = historyState.get(route.userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'permissions',
      changes: {
        updated: {
          mode: { from: prev.mode, to: body.mode },
          template: { from: prev.template ?? null, to: nextTemplate },
        },
        added: nextPermissions.filter((p) => !prev.permissions.includes(p)),
        removed: prev.permissions.filter((p) => !nextPermissions.includes(p)),
      },
    });
    historyState.set(route.userId, items);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectMemberQuotaOverrides' && method === 'GET' && route.workspaceId && route.projectId && route.userId) {
    const state = getMemberQuotaState(route.workspaceId, route.projectId);
    const current = state.get(route.userId);
    json(res, 200, { overrides: current?.overrides ?? {} });
    return true;
  }

  if (route.kind === 'projectMemberQuotaOverrides' && method === 'PATCH' && route.workspaceId && route.projectId && route.userId) {
    const body = await readBody(req) as { overrides?: Record<string, unknown> };
    if (!body || !body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'overrides is required' });
      return true;
    }
    const state = getMemberQuotaState(route.workspaceId, route.projectId);
    const prev = state.get(route.userId) ?? { overrides: {}, history: [] as Array<{ id: string; created_at: string; created_by_user_id: string; overrides_json: Record<string, unknown> }> };
    const nextOverrides = body.overrides;
    const now = new Date().toISOString();
    const historyEntry = {
      id: `qoh_${Math.random().toString(36).slice(2, 10)}`,
      created_at: now,
      created_by_user_id: user.id,
      overrides_json: nextOverrides,
    };
    const history = [historyEntry, ...prev.history];
    state.set(route.userId, { overrides: nextOverrides, history });

    const historyState = getMemberChangeHistoryState(route.workspaceId, route.projectId);
    const items = historyState.get(route.userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: now,
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'quota',
      changes: {
        updated: {
          overrides: { from: prev.overrides, to: nextOverrides },
        },
      },
    });
    historyState.set(route.userId, items);

    json(res, 200, { overrides: nextOverrides });
    return true;
  }

  if (
    route.kind === 'projectMemberQuotaOverridesHistory'
    && method === 'GET'
    && route.workspaceId
    && route.projectId
    && route.userId
  ) {
    const page = Math.max(1, Number.parseInt(requestUrl.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(requestUrl.searchParams.get('page_size') ?? '20', 10) || 20));
    const state = getMemberQuotaState(route.workspaceId, route.projectId);
    const history = state.get(route.userId)?.history ?? [];
    const total = history.length;
    const start = (page - 1) * pageSize;
    const items = history.slice(start, start + pageSize);
    json(res, 200, { items, total, page, page_size: pageSize });
    return true;
  }

  if (route.kind === 'projectMemberChangeHistory' && method === 'GET' && route.workspaceId && route.projectId && route.userId) {
    const state = getMemberChangeHistoryState(route.workspaceId, route.projectId);
    json(res, 200, { items: state.get(route.userId) ?? [] });
    return true;
  }

  if (
    route.kind === 'projectResourcePolicy'
    && method === 'GET'
    && route.workspaceId
    && route.projectId
    && route.resourceType
    && route.resourceId
  ) {
    json(
      res,
      200,
      getProjectResourcePolicyOrDefault(
        route.workspaceId,
        route.projectId,
        route.resourceType as 'endpoint' | 'source_library' | 'agent',
        route.resourceId,
      ),
    );
    return true;
  }

  if (
    route.kind === 'projectResourcePolicy'
    && method === 'PATCH'
    && route.workspaceId
    && route.projectId
    && route.resourceType
    && route.resourceId
  ) {
    const body = await readBody(req) as {
      access_mode?: 'allow_all_members' | 'allow_list';
      allowed_subjects?: Array<{
        subject_type: 'group' | 'user';
        subject_id: string;
        rate_limits?: Record<string, unknown>;
        quota_limits?: Record<string, unknown>;
      }>;
      rate_limits?: Record<string, unknown>;
      quota_limits?: Record<string, unknown>;
    };
    if (!body || (body.access_mode !== 'allow_all_members' && body.access_mode !== 'allow_list') || !Array.isArray(body.allowed_subjects)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'access_mode and allowed_subjects are required' });
      return true;
    }
    upsertProjectResourcePolicy(route.workspaceId, route.projectId, {
      resource_type: route.resourceType as 'endpoint' | 'source_library' | 'agent',
      resource_id: route.resourceId,
      access_mode: body.access_mode,
      allowed_subjects: body.allowed_subjects
        .filter((s): s is {
          subject_type: 'group' | 'user';
          subject_id: string;
          rate_limits?: Record<string, unknown>;
          quota_limits?: Record<string, unknown>;
        } => !!s && (s.subject_type === 'group' || s.subject_type === 'user') && typeof s.subject_id === 'string')
        .map((s) => ({ ...s, updated_at: new Date().toISOString() })),
      rate_limits: body.rate_limits,
      quota_limits: body.quota_limits,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sources' && method === 'GET' && route.workspaceId && route.projectId) {
    const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sources' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    const input = CreateSourceRequestSchema.parse(raw);
    const created = await deps.createSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraries' && method === 'GET' && route.workspaceId && route.projectId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sourceLibrariesDefaultPersonal' && method === 'GET' && route.workspaceId && route.projectId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const existing = listed.items.find(
      (item) => item.created_by_user_id === user.id && item.name === DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME,
    );
    if (existing) {
      json(res, 200, existing);
      return true;
    }

    const created = await deps.createSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorId: user.id,
      input: {
        name: DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME,
        visibility: 'shared',
        system_managed_kind: 'default_personal_uploads',
      },
    });
    json(res, 200, created);
    return true;
  }

  if (route.kind === 'sourceLibraries' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    if (
      raw
      && typeof raw === 'object'
      && 'system_managed_kind' in (raw as Record<string, unknown>)
      && (raw as Record<string, unknown>).system_managed_kind !== undefined
    ) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'system_managed_kind_not_allowed',
      });
      return true;
    }
    const input = CreateSourceLibraryRequestSchema.parse(raw);
    if (input.name === DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME) {
      const listed = await deps.listSourceLibrariesUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      const existingDefault = listed.items.find((item) => isDefaultPersonalLibraryForUser(item, user.id));
      if (existingDefault) {
        json(res, 409, {
          error_code: 'RESOURCE_CONFLICT',
          message: 'default_personal_library_reserved',
          details: { library_id: existingDefault.id },
        });
        return true;
      }
    }
    const created = await deps.createSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorId: user.id,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraryObjects' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const query = ListSourceObjectsQuerySchema.parse({
      prefix: requestUrl.searchParams.get('prefix') ?? undefined,
      delimiter: requestUrl.searchParams.get('delimiter') ?? '/',
      page_size: requestUrl.searchParams.get('page_size') ?? undefined,
      continuation_token: requestUrl.searchParams.get('continuation_token') ?? undefined,
      search: requestUrl.searchParams.get('search') ?? undefined,
      sort_by: requestUrl.searchParams.get('sort_by') ?? undefined,
      sort_order: requestUrl.searchParams.get('sort_order') ?? undefined,
    });
    const listed = await deps.listSourceLibraryObjectsUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      prefix: query.prefix,
      delimiter: query.delimiter,
      pageSize: query.page_size,
      continuationToken: query.continuation_token,
      search: query.search,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sourceLibraryFolders' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = CreateSourceFolderRequestSchema.parse(raw);
    await deps.createSourceFolderUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    res.statusCode = 201;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsUpload' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const workspaceId = route.workspaceId;
    const projectId = route.projectId;
    const libraryId = route.libraryId;
    const rawContentType = req.headers['content-type'];
    const contentType = Array.isArray(rawContentType) ? rawContentType.join(';') : rawContentType ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'multipart_form_data_required' });
      return true;
    }

    const uploaded = await parseUploadAndExecute(req, (input) =>
      deps.uploadSourceObjectUseCase.execute({
        workspaceId,
        projectId,
        libraryId,
        fileName: input.fileName,
        fileStream: input.fileStream,
        contentType: input.contentType,
        contentLength: input.contentLength,
        prefix: input.prefix,
        overwrite: input.overwrite,
      }),
    );
    json(res, 201, uploaded);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsDownload' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const rawKey = requestUrl.searchParams.get('key') ?? '';
    if (!rawKey.trim()) {
      throw new Error('invalid_key');
    }
    const query = SourceObjectDownloadQuerySchema.parse({
      key: rawKey,
    });
    const downloaded = await deps.downloadSourceObjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      key: query.key,
    });
    res.statusCode = 200;
    res.setHeader('content-type', downloaded.contentType);
    res.setHeader(
      'content-disposition',
      `attachment; filename=\"${encodeURIComponent(downloaded.key.split('/').at(-1) || 'download')}\"`,
    );
    const nodeStream = Readable.fromWeb(downloaded.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on('error', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    nodeStream.pipe(res);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsDelete' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = DeleteSourceObjectsRequestSchema.parse(raw);
    const result = await deps.deleteSourceObjectsUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    json(res, 200, result);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsMove' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = MoveSourceObjectRequestSchema.parse(raw);
    await deps.moveSourceObjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    res.statusCode = 200;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsMeta' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const key = requestUrl.searchParams.get('key') ?? '';
    const meta = await deps.getSourceObjectMetaUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      key,
    });
    json(res, 200, meta);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsShareLink' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = SourceObjectShareLinkCreateRequestSchema.parse(raw);
    const shareLink = await deps.createSourceObjectShareLinkUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    json(res, 200, shareLink);
    return true;
  }

  if (route.kind === 'sourceLibraryItem' && method === 'PATCH' && route.workspaceId && route.projectId && route.libraryId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const target = listed.items.find((item) => item.id === route.libraryId) ?? null;
    if (target && isDefaultPersonalLibraryForUser(target, user.id)) {
      json(res, 409, {
        error_code: 'RESOURCE_CONFLICT',
        message: 'default_personal_library_protected',
      });
      return true;
    }
    const raw = await readBody(req);
    const input = UpdateSourceLibraryRequestSchema.parse(raw);
    const updated = await deps.updateSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'sourceLibraryItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.libraryId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const target = listed.items.find((item) => item.id === route.libraryId) ?? null;
    if (target && isDefaultPersonalLibraryForUser(target, user.id)) {
      json(res, 409, {
        error_code: 'RESOURCE_CONFLICT',
        message: 'default_personal_library_protected',
      });
      return true;
    }
    await deps.deleteSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobs' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = CreateAIReadyJobRequestSchema.parse(raw);
    const created = await deps.createAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      actorId: user.id,
      idempotencyKey: req.headers['idempotency-key']?.toString(),
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobItem' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId && route.jobId) {
    await drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
    const found = await deps.getAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      jobId: route.jobId,
    });
    json(res, 200, found);
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobCancel' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId && route.jobId) {
    const updated = await deps.cancelAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      jobId: route.jobId,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'sourcesQuota' && method === 'GET' && route.workspaceId && route.projectId) {
    const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const quota = await deps.getSourcesQuotaUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId,
    });
    json(res, 200, quota);
    return true;
  }

  if (route.kind === 'sourceAIReadyStart' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.startSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyCancel' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.cancelSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyRetry' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.retrySourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceBatchAIReadyStart' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    const jobs = await deps.batchStartSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (route.kind === 'sourceBatchAIReadyCancel' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    const jobs = await deps.batchCancelSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (route.kind === 'sourceItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.sourceId) {
    await deps.deleteSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sourceItem' && method === 'GET' && route.workspaceId && route.projectId && route.sourceId) {
    const source = await deps.getSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, source);
    return true;
  }

  if (route.kind === 'sourceDownload' && method === 'GET' && route.workspaceId && route.projectId && route.sourceId) {
    const source = await deps.downloadSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    res.statusCode = 200;
    res.setHeader('content-type', source.source.content_type);
    res.setHeader(
      'content-disposition',
      `attachment; filename=\"${encodeURIComponent(source.source.name)}\"`,
    );
    res.end(Buffer.from(source.body));
    return true;
  }

  return false;
}
