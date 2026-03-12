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
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import {
  getProjectResourcePolicyOrDefault,
  isProjectResourceAccessAllowedForUser,
  upsertProjectResourcePolicy,
} from './project-resource-policy-store.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectSourceLibraryLimitLimits,
} from './project-resource-policy-enforcer.js';
import {
  getProjectGroupsState,
  setProjectGroupsState,
} from './project-groups-store.js';
import {
  getProjectPermissionTemplatesState,
  setProjectPermissionTemplatesState,
} from './project-permission-templates-store.js';
import { getProjectMemberPermissionsState } from './project-member-permissions-store.js';
import {
  getProjectMembershipsState,
  upsertProjectMembership,
} from './project-memberships-store.js';

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
}

const DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME = 'My Uploads';
const DEFAULT_PERSONAL_LIBRARY_ENSURE_BY_SCOPE = new Map<string, Promise<void>>();
const RESOURCE_POLICY_ALLOWED_RATE_KEYS: Record<'endpoint' | 'source_library' | 'agent', readonly string[]> = {
  endpoint: ['endpoint.requests_per_minute', 'endpoint.requests_per_5_hours', 'endpoint.requests_per_day'],
  source_library: ['source_library.requests_per_minute'],
  agent: [],
};
const RESOURCE_POLICY_ALLOWED_LIMIT_KEYS: Record<'endpoint' | 'source_library' | 'agent', readonly string[]> = {
  endpoint: [
    'endpoint.spending_usd_per_minute',
    'endpoint.spending_usd_per_5_hours',
    'endpoint.spending_usd_per_day',
  ],
  source_library: ['source_library.max_total_files', 'source_library.max_file_size_bytes'],
  agent: [],
};
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
const PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT = new Map<string, Map<string, Array<{
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'resource_policy' | 'role' | 'membership';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}>>>();

function isManagedPolicyResourceType(resourceType: string): resourceType is 'endpoint' | 'source_library' | 'agent' {
  return resourceType === 'endpoint' || resourceType === 'source_library' || resourceType === 'agent';
}

function readRequestId(req: http.IncomingMessage): string | undefined {
  const value = req.headers['x-request-id'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim());
    if (first) return first.trim();
  }
  return undefined;
}

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

function validatePolicyRuleKeys(args: {
  resourceType: 'endpoint' | 'source_library' | 'agent';
  kind: 'rate_limits' | 'spending_limits';
  payload: unknown;
}): { ok: true } | { ok: false; message: string } {
  if (args.payload === undefined) return { ok: true };
  if (!args.payload || typeof args.payload !== 'object' || Array.isArray(args.payload)) {
    return { ok: false, message: `${args.kind}_invalid` };
  }
  const rules = (args.payload as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) {
    return { ok: false, message: `${args.kind}_rules_invalid` };
  }
  const allowed = args.kind === 'rate_limits'
    ? RESOURCE_POLICY_ALLOWED_RATE_KEYS[args.resourceType]
    : RESOURCE_POLICY_ALLOWED_LIMIT_KEYS[args.resourceType];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      return { ok: false, message: `${args.kind}_rule_invalid` };
    }
    const key = (rule as { key?: unknown }).key;
    const value = (rule as { value?: unknown }).value;
    if (typeof key !== 'string' || !allowed.includes(key)) {
      return { ok: false, message: `${args.kind}_rule_key_invalid` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, message: `${args.kind}_rule_value_invalid` };
    }
  }
  return { ok: true };
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
    change_type: 'permissions' | 'resource_policy' | 'role' | 'membership';
    changes: { added?: string[]; removed?: string[]; updated?: Record<string, { from: unknown; to: unknown }> };
  }>>();
  PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT.set(key, map);
  return map;
}

function clearMemberGovernanceState(workspaceId: string, projectId: string, userId: string): void {
  const groups = getProjectGroupsState(workspaceId, projectId);
  let groupsChanged = false;
  for (const group of groups) {
    if (!group.member_ids.includes(userId)) continue;
    group.member_ids = group.member_ids.filter((memberId) => memberId !== userId);
    group.updated_at = new Date().toISOString();
    groupsChanged = true;
  }
  if (groupsChanged) {
    setProjectGroupsState(workspaceId, projectId, groups);
  }
  getProjectMemberPermissionsState(workspaceId, projectId).delete(userId);
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

function defaultPersonalLibraryScopeKey(workspaceId: string, projectId: string, userId: string): string {
  return `${workspaceId}:${projectId}:${userId}`;
}

type DefaultCandidateLibrary = {
  id: string;
  created_by_user_id: string;
  system_managed_kind?: string;
  name: string;
  created_at?: string;
};

function pickCanonicalDefaultPersonalLibrary<T extends DefaultCandidateLibrary>(items: T[], userId: string): T | null {
  const defaults = items.filter((item) => isDefaultPersonalLibraryForUser(item, userId));
  if (defaults.length === 0) return null;
  const sorted = [...defaults].sort((a, b) => {
    const aSystem = a.system_managed_kind === 'default_personal_uploads' ? 0 : 1;
    const bSystem = b.system_managed_kind === 'default_personal_uploads' ? 0 : 1;
    if (aSystem !== bSystem) return aSystem - bSystem;
    const aCreated = typeof a.created_at === 'string' ? Date.parse(a.created_at) : NaN;
    const bCreated = typeof b.created_at === 'string' ? Date.parse(b.created_at) : NaN;
    const aScore = Number.isFinite(aCreated) ? aCreated : Number.MAX_SAFE_INTEGER;
    const bScore = Number.isFinite(bCreated) ? bCreated : Number.MAX_SAFE_INTEGER;
    if (aScore !== bScore) return aScore - bScore;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

function dedupeDefaultPersonalLibraries<T extends DefaultCandidateLibrary>(items: T[], userId: string): T[] {
  const canonical = pickCanonicalDefaultPersonalLibrary(items, userId);
  if (!canonical) return items;
  return items.filter((item) => !isDefaultPersonalLibraryForUser(item, userId) || item.id === canonical.id);
}

async function ensureDefaultPersonalLibraryForUser(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  deps: NodeApiDeps;
}): Promise<void> {
  const scopeKey = defaultPersonalLibraryScopeKey(args.workspaceId, args.projectId, args.userId);
  const inFlight = DEFAULT_PERSONAL_LIBRARY_ENSURE_BY_SCOPE.get(scopeKey);
  if (inFlight) {
    await inFlight;
    return;
  }
  const runner = (async () => {
    const listed = await args.deps.listSourceLibrariesUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    const exists = listed.items.some((item) => isDefaultPersonalLibraryForUser(item, args.userId));
    if (exists) return;
    await args.deps.createSourceLibraryUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      actorId: args.userId,
      input: {
        name: DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME,
        visibility: 'shared',
        system_managed_kind: 'default_personal_uploads',
      },
    });
  })().finally(() => {
    DEFAULT_PERSONAL_LIBRARY_ENSURE_BY_SCOPE.delete(scopeKey);
  });
  DEFAULT_PERSONAL_LIBRARY_ENSURE_BY_SCOPE.set(scopeKey, runner);
  await runner;
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
  options?: {
    maxFileSizeBytes?: number;
  },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: options?.maxFileSizeBytes ? { fileSize: options.maxFileSizeBytes } : undefined,
    });
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
      file.on('limit', () => {
        settle(() =>
          reject(
            Object.assign(new Error('source_library_max_file_size_exceeded'), {
              code: 'SOURCE_LIBRARY_MAX_FILE_SIZE_EXCEEDED',
              maxFileSizeBytes: options?.maxFileSizeBytes,
            }),
          ),
        );
      });
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
  } = args;
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;

  const enforceSourceLibraryAccess = async (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> => {
    const libraries = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
    });
    const library = libraries.items.find((item) => item.id === params.libraryId);
    if (!library || library.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'source_library_not_visible',
        resource_type: 'source_library',
        resource_id: params.libraryId,
      });
      return false;
    }
    const check = isProjectResourceAccessAllowedForUser({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      userId: user.id,
    });
    if (check.allowed) return true;
    await writeProjectAuditEvent(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      actor: { type: 'user', id: user.id },
      action: 'resource_policy.access_denied',
      result: 'error',
      requestId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      errorCode: 'RESOURCE_POLICY_DENIED',
      errorMessage: 'resource_policy_denied',
      metadata: {
        governance_kind: 'resource_policy',
        enforcement_kind: 'allow_list',
        route_kind: params.routeKind,
      },
    });
    await writeProjectUsageFact(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      endUserId: user.id,
      requestId,
      requests: 1,
      result: 'error',
      errorCode: 'RESOURCE_POLICY_DENIED',
      metadata: {
        stage: 'preflight',
        governance_kind: 'resource_policy',
        enforcement_kind: 'allow_list',
        route_kind: params.routeKind,
      },
    });
    json(res, 403, {
      error_code: 'RESOURCE_POLICY_DENIED',
      message: 'resource_policy_denied',
      resource_type: 'source_library',
      resource_id: params.libraryId,
    });
    return false;
  };

  const enforceSourceLibraryRateLimit = async (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> => {
    const policy = getProjectResourcePolicyOrDefault(
      params.workspaceId,
      params.projectId,
      'source_library',
      params.libraryId,
    );
    const rateCheck = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      userId: user.id,
      policy,
    });
    if (rateCheck.allowed) return true;
    await writeProjectAuditEvent(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      actor: { type: 'user', id: user.id },
      action: 'resource_policy.rate_limited',
      result: 'error',
      requestId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
      errorMessage: 'resource_policy_rate_limited',
      metadata: {
        governance_kind: 'resource_policy',
        enforcement_kind: 'rate_limit',
        route_kind: params.routeKind,
        effective_limit_per_minute: rateCheck.effective_limit_per_minute,
        scope: rateCheck.scope,
        retry_after_seconds: rateCheck.retry_after_seconds,
      },
    });
    await writeProjectUsageFact(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      endUserId: user.id,
      requestId,
      requests: 1,
      result: 'error',
      errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
      metadata: {
        stage: 'preflight',
        governance_kind: 'resource_policy',
        enforcement_kind: 'rate_limit',
        route_kind: params.routeKind,
        effective_limit_per_minute: rateCheck.effective_limit_per_minute,
        scope: rateCheck.scope,
      },
    });
    res.setHeader('Retry-After', String(rateCheck.retry_after_seconds));
    json(res, 429, {
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      message: 'resource_policy_rate_limited',
      resource_type: 'source_library',
      resource_id: params.libraryId,
      retry_after_seconds: rateCheck.retry_after_seconds,
    });
    return false;
  };

  const enforceSourceLibraryPreflight = async (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> => {
    if (!(await enforceSourceLibraryAccess(params))) return false;
    return enforceSourceLibraryRateLimit(params);
  };

  const enforceSourceLibraryLimit = async (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
    currentFileCount: number;
    nextFileSizeBytes: number;
  }): Promise<boolean> => {
    const policy = getProjectResourcePolicyOrDefault(
      params.workspaceId,
      params.projectId,
      'source_library',
      params.libraryId,
    );
    const limitCheck = checkProjectSourceLibraryLimitLimits({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      userId: user.id,
      policy,
      currentFileCount: params.currentFileCount,
      nextFileSizeBytes: params.nextFileSizeBytes,
    });
    if (limitCheck.allowed) return true;
    await writeProjectAuditEvent(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      actor: { type: 'user', id: user.id },
      action: 'resource_policy.limit_exceeded',
      result: 'error',
      requestId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      errorMessage: 'resource_policy_spending_limit_exceeded',
      metadata: {
        governance_kind: 'resource_policy',
        enforcement_kind: 'spending_limit',
        route_kind: params.routeKind,
        limit_key: limitCheck.limit_key,
        effective_limit: limitCheck.effective_limit,
        current_usage: limitCheck.current_usage,
        usage_unit: limitCheck.usage_unit,
        scope: limitCheck.scope,
        effective_max_total_files: limitCheck.effective_max_total_files,
        current_total_files: limitCheck.current_total_files,
        effective_max_file_size_bytes: limitCheck.effective_max_file_size_bytes,
        current_file_size_bytes: limitCheck.current_file_size_bytes,
      },
    });
    await writeProjectUsageFact(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'source_library',
      resourceId: params.libraryId,
      endUserId: user.id,
      requestId,
      requests: 1,
      result: 'error',
      errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      metadata: {
        stage: 'preflight',
        governance_kind: 'resource_policy',
        enforcement_kind: 'spending_limit',
        route_kind: params.routeKind,
        limit_key: limitCheck.limit_key,
        effective_limit: limitCheck.effective_limit,
        current_usage: limitCheck.current_usage,
        usage_unit: limitCheck.usage_unit,
        scope: limitCheck.scope,
      },
    });
    res.setHeader('Retry-After', String(limitCheck.retry_after_seconds));
    json(res, 429, {
      error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      message: 'resource_policy_spending_limit_exceeded',
      resource_type: 'source_library',
      resource_id: params.libraryId,
      limit_key: limitCheck.limit_key,
      retry_after_seconds: limitCheck.retry_after_seconds,
    });
    return false;
  };

  const enforceSourceLibraryAccessBySourceId = async (params: {
    workspaceId: string;
    projectId: string;
    sourceId: string;
    routeKind: string;
  }): Promise<boolean> => {
    const source = await deps.getSourceUseCase.execute({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      sourceId: params.sourceId,
    }) as { id: string; library_id?: string };
    const libraryId = typeof source.library_id === 'string' ? source.library_id : '';
    if (!libraryId) {
      return true;
    }
    return enforceSourceLibraryPreflight({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      libraryId,
      routeKind: params.routeKind,
    });
  };

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
    const workspaceId = route.workspaceId;
    const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
    json(res, 200, {
      items: listed.items.map((item) => ({
        ...item,
        role: item.owner_id === user.id ? 'owner' : 'developer',
        permissions: [
          ...resolveVisibleProjectPermissionsForActor({
            workspaceId,
            projectId: item.id,
            projectOwnerId: item.owner_id,
            actorUserId: user.id,
          }),
        ],
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
      permissions: [
        ...resolveVisibleProjectPermissionsForActor({
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          projectOwnerId: found.owner_id,
          actorUserId: user.id,
        }),
      ],
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
    const workspaceId = route.workspaceId;
    const projectId = route.projectId;
    let projectOwnerId: string | null = null;
    let projectCreatedAt: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId,
        projectId,
      });
      projectOwnerId = project.owner_id;
      projectCreatedAt = project.created_at;
    } catch {
      // Keep minimal members read endpoint usable in local/dev environments even
      // when membership/governance backend is not fully wired to project repo fixtures.
    }
    const memberships = Array.from(getProjectMembershipsState(workspaceId, projectId).values());
    const items = memberships.map((m) => ({
      id: m.user_id,
      email: m.user_id === user.id ? user.email : `${m.user_id}@example.com`,
      name: m.user_id === user.id ? user.name : m.user_id,
      role: m.role,
      permissions: m.user_id === user.id
        ? [
          ...resolveVisibleProjectPermissionsForActor({
            workspaceId,
            projectId,
            projectOwnerId: projectOwnerId ?? user.id,
            actorUserId: user.id,
          }),
        ]
        : [],
      status: m.status,
      joined_at: m.joined_at,
    }));
    if (!items.some((item) => item.id === (projectOwnerId ?? user.id))) {
      const ownerId = projectOwnerId ?? user.id;
      items.unshift({
        id: ownerId,
        email: ownerId === user.id ? user.email : `${ownerId}@example.com`,
        name: ownerId === user.id ? user.name : ownerId,
        role: 'owner',
        permissions: ownerId === user.id
          ? [
            ...resolveVisibleProjectPermissionsForActor({
              workspaceId,
              projectId,
              projectOwnerId: ownerId,
              actorUserId: user.id,
            }),
          ]
          : [],
        status: 'active',
        joined_at: projectCreatedAt ?? new Date().toISOString(),
      });
    }
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'projectJoinRequests' && method === 'GET' && route.workspaceId && route.projectId) {
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key) ?? [];
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'projectJoinRequests' && method === 'POST' && route.workspaceId && route.projectId) {
    let projectOwnerId: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      projectOwnerId = project.owner_id;
    } catch {
      // Keep local governance route usable in partially wired dev setups.
    }
    if (projectOwnerId === user.id) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'Project owner cannot create a join request' });
      return true;
    }
    const body = await readBody(req) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const key = projectScopedKey(route.workspaceId, route.projectId);
    const items = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key) ?? [];
    const existingPending = items.find((item) => item.user_id === user.id && item.status === 'pending');
    if (existingPending) {
      json(res, 409, { error_code: 'JOIN_REQUEST_ALREADY_PENDING', message: 'A pending join request already exists' });
      return true;
    }
    const created = {
      id: `jr_${Math.random().toString(36).slice(2, 10)}`,
      project_id: route.projectId,
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      reason,
      status: 'pending' as const,
      requested_at: new Date().toISOString(),
    };
    PROJECT_JOIN_REQUESTS_BY_PROJECT.set(key, [...items, created]);
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.created',
      resourceType: 'join_request',
      resourceId: created.id,
      metadata: {
        requested_user_id: user.id,
        reason_present: created.reason.length > 0,
      },
    });
    json(res, 201, created);
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
    upsertProjectMembership(route.workspaceId, route.projectId, {
      project_id: route.projectId,
      user_id: target.user_id,
      role: 'developer',
      status: 'active',
      joined_at: target.reviewed_at,
      approved_via_join_request_id: target.id,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.approved',
      resourceType: 'join_request',
      resourceId: target.id,
      metadata: {
        requested_user_id: target.user_id,
      },
    });
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
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.rejected',
      resourceType: 'join_request',
      resourceId: target.id,
      metadata: {
        requested_user_id: target.user_id,
        reject_reason_present: typeof reason === 'string' && reason.trim().length > 0,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectPermissionTemplates' && method === 'GET' && route.workspaceId && route.projectId) {
    json(res, 200, { items: getProjectPermissionTemplatesState(route.workspaceId, route.projectId) });
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
    const items = getProjectPermissionTemplatesState(route.workspaceId, route.projectId);
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
    setProjectPermissionTemplatesState(route.workspaceId, route.projectId, items);
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
    const items = getProjectPermissionTemplatesState(route.workspaceId, route.projectId);
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
    const items = getProjectPermissionTemplatesState(route.workspaceId, route.projectId);
    const target = items.find((it) => it.id === route.templateId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (target.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' });
      return true;
    }
    setProjectPermissionTemplatesState(
      route.workspaceId,
      route.projectId,
      items.filter((it) => it.id !== route.templateId),
    );
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectGroups' && method === 'GET' && route.workspaceId && route.projectId) {
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
    const groups = getProjectGroupsState(route.workspaceId, route.projectId);
    const next = groups.filter((g) => g.id !== route.groupId);
    setProjectGroupsState(route.workspaceId, route.projectId, next);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectGroupApplyTemplate' && method === 'POST' && route.workspaceId && route.projectId && route.groupId) {
    const body = await readBody(req) as { member_ids?: string[] };
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
    const membership = getProjectMembershipsState(membershipRoute.workspaceId, membershipRoute.projectId).get(membershipRoute.userId);
    const isCurrentUser = membershipRoute.userId === user.id;
    const role = membership?.role ?? (projectOwnerId === membershipRoute.userId ? 'owner' : 'developer');
    json(res, 200, {
      project_id: membershipRoute.projectId,
      user_id: membershipRoute.userId,
      role,
      permissions: isCurrentUser
        ? [
          ...resolveVisibleProjectPermissionsForActor({
            workspaceId: membershipRoute.workspaceId,
            projectId: membershipRoute.projectId,
            projectOwnerId: projectOwnerId ?? user.id,
            actorUserId: user.id,
          }),
        ]
        : [],
      status: membership?.status ?? 'active',
      joined_at: membership?.joined_at ?? projectCreatedAt ?? new Date().toISOString(),
    });
    return true;
  }

  if (route.kind === 'projectMembershipItem' && method === 'PATCH' && route.workspaceId && route.projectId && route.userId) {
    const body = await readBody(req) as { status?: 'active' | 'suspended' };
    if (!body || (body.status !== 'active' && body.status !== 'suspended')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'status must be active or suspended' });
      return true;
    }
    let projectOwnerId: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      projectOwnerId = project.owner_id;
    } catch {
      // keep behavior minimal in local/dev fallback mode
    }
    if (projectOwnerId && route.userId === projectOwnerId) {
      json(res, 409, { error_code: 'CONFLICT', message: 'project_owner_membership_cannot_be_modified' });
      return true;
    }
    const memberships = getProjectMembershipsState(route.workspaceId, route.projectId);
    const existing = memberships.get(route.userId);
    let prevStatus: 'active' | 'pending' | 'suspended' | null = null;
    if (!existing) {
      if (body.status !== 'active') {
        json(res, 404, { error_code: 'NOT_FOUND', message: 'membership_not_found' });
        return true;
      }
      const created = {
        project_id: route.projectId,
        user_id: route.userId,
        role: 'developer',
        status: 'active' as const,
        joined_at: new Date().toISOString(),
      };
      memberships.set(route.userId, created);
    } else {
      prevStatus = existing.status;
      existing.status = body.status;
      memberships.set(route.userId, existing);
    }

    const historyState = getMemberChangeHistoryState(route.workspaceId, route.projectId);
    const items = historyState.get(route.userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'membership',
      changes: {
        updated: {
          status: { from: prevStatus ?? 'missing', to: body.status },
        },
      },
    });
    historyState.set(route.userId, items);

    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: body.status === 'suspended' ? 'member.membership.suspended' : 'member.membership.activated',
      resourceType: 'membership',
      resourceId: route.userId,
      metadata: {
        target_user_id: route.userId,
        previous_status: prevStatus ?? 'missing',
        next_status: body.status,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectMembershipItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.userId) {
    let projectOwnerId: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      projectOwnerId = project.owner_id;
    } catch {
      // keep behavior minimal in local/dev fallback mode
    }
    if (projectOwnerId && route.userId === projectOwnerId) {
      json(res, 409, { error_code: 'CONFLICT', message: 'project_owner_membership_cannot_be_removed' });
      return true;
    }
    const memberships = getProjectMembershipsState(route.workspaceId, route.projectId);
    const existing = memberships.get(route.userId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'membership_not_found' });
      return true;
    }
    memberships.delete(route.userId);
    clearMemberGovernanceState(route.workspaceId, route.projectId, route.userId);

    const historyState = getMemberChangeHistoryState(route.workspaceId, route.projectId);
    const items = historyState.get(route.userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'membership',
      changes: {
        updated: {
          status: { from: existing.status, to: 'removed' },
        },
      },
    });
    historyState.set(route.userId, items);

    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.membership.removed',
      resourceType: 'membership',
      resourceId: route.userId,
      metadata: {
        target_user_id: route.userId,
        previous_status: existing.status,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'projectMemberPermissions' && method === 'GET' && route.workspaceId && route.projectId && route.userId) {
    const state = getProjectMemberPermissionsState(route.workspaceId, route.projectId);
    const current = state.get(route.userId);
    json(res, 200, {
      platform_permissions: current?.permissions ?? [],
      resource_permissions: undefined,
    });
    return true;
  }

  if (route.kind === 'projectMemberPermissions' && method === 'PATCH' && route.workspaceId && route.projectId && route.userId) {
    const requestId = readRequestId(req);
    const body = await readBody(req) as {
      template?: string | null;
      permissions?: string[];
      mode?: 'template' | 'custom';
    };
    if (!body || (body.mode !== 'template' && body.mode !== 'custom')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'mode is required' });
      return true;
    }
    const state = getProjectMemberPermissionsState(route.workspaceId, route.projectId);
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
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.permissions.updated',
      requestId,
      resourceType: 'member',
      resourceId: route.userId,
      metadata: {
        target_user_id: route.userId,
        mode: {
          from: prev.mode,
          to: body.mode,
        },
        template: {
          from: prev.template ?? null,
          to: nextTemplate,
        },
        permissions_added: nextPermissions.filter((p) => !prev.permissions.includes(p)),
        permissions_removed: prev.permissions.filter((p) => !nextPermissions.includes(p)),
      },
    });
    res.statusCode = 204;
    res.end();
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
    if (!isManagedPolicyResourceType(route.resourceType)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'unsupported_resource_type' });
      return true;
    }
    const policy = getProjectResourcePolicyOrDefault(
      route.workspaceId,
      route.projectId,
      route.resourceType,
      route.resourceId,
    );
    json(res, 200, {
      ...policy,
      allowed_subjects: policy.allowed_subjects.map((subject) => ({
        ...subject,
      })),
    });
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
    const requestId = readRequestId(req);
    const writePolicyUpdateError = async (errorMessage: string) => {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId!,
        projectId: route.projectId!,
        actor: { type: 'user', id: user.id },
        action: 'resource_policy.updated',
        result: 'error',
        requestId,
        resourceType: 'resource_policy',
        resourceId: `${route.resourceType}:${route.resourceId}`,
        errorCode: 'VALIDATION_ERROR',
        errorMessage,
        metadata: {
          governed_resource_type: route.resourceType,
          governed_resource_id: route.resourceId,
        },
      });
    };
    if (!isManagedPolicyResourceType(route.resourceType)) {
      await writePolicyUpdateError('unsupported_resource_type');
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'unsupported_resource_type' });
      return true;
    }
    const body = await readBody(req) as {
      access_mode?: 'allow_all_members' | 'allow_list';
      allowed_subjects?: Array<{
        subject_type: 'group' | 'user';
        subject_id: string;
        rate_limits?: Record<string, unknown>;
        spending_limits?: Record<string, unknown>;
      }>;
      rate_limits?: Record<string, unknown>;
      spending_limits?: Record<string, unknown>;
    };
    if (!body || (body.access_mode !== 'allow_all_members' && body.access_mode !== 'allow_list') || !Array.isArray(body.allowed_subjects)) {
      await writePolicyUpdateError('access_mode and allowed_subjects are required');
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'access_mode and allowed_subjects are required' });
      return true;
    }
    const resourceType = route.resourceType;
    const rateValidation = validatePolicyRuleKeys({
      resourceType,
      kind: 'rate_limits',
      payload: body.rate_limits,
    });
    if (!rateValidation.ok) {
      await writePolicyUpdateError(rateValidation.message);
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: rateValidation.message });
      return true;
    }
    const spendingValidation = validatePolicyRuleKeys({
      resourceType,
      kind: 'spending_limits',
      payload: body.spending_limits,
    });
    if (!spendingValidation.ok) {
      await writePolicyUpdateError(spendingValidation.message);
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: spendingValidation.message });
      return true;
    }
    const previousPolicy = getProjectResourcePolicyOrDefault(
      route.workspaceId,
      route.projectId,
      resourceType,
      route.resourceId,
    );
    const validatedSubjects: Array<{
      subject_type: 'group' | 'user';
      subject_id: string;
      rate_limits?: Record<string, unknown>;
      spending_limits?: Record<string, unknown>;
    }> = [];
    for (const subject of body.allowed_subjects) {
      if (
        !subject
        || typeof subject !== 'object'
        || ((subject as { subject_type?: unknown }).subject_type !== 'group'
          && (subject as { subject_type?: unknown }).subject_type !== 'user')
        || typeof (subject as { subject_id?: unknown }).subject_id !== 'string'
      ) {
        continue;
      }
      const typedSubject = subject as {
        subject_type: 'group' | 'user';
        subject_id: string;
        rate_limits?: Record<string, unknown>;
        spending_limits?: Record<string, unknown>;
      };
      const subjectRateValidation = validatePolicyRuleKeys({
        resourceType,
        kind: 'rate_limits',
        payload: typedSubject.rate_limits,
      });
      if (!subjectRateValidation.ok) {
        await writePolicyUpdateError(subjectRateValidation.message);
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: subjectRateValidation.message });
        return true;
      }
      const subjectSpendingValidation = validatePolicyRuleKeys({
        resourceType,
        kind: 'spending_limits',
        payload: typedSubject.spending_limits,
      });
      if (!subjectSpendingValidation.ok) {
        await writePolicyUpdateError(subjectSpendingValidation.message);
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: subjectSpendingValidation.message });
        return true;
      }
      validatedSubjects.push({
        ...typedSubject,
      });
    }
    const normalizedAllowedSubjects = validatedSubjects.map((s) => ({ ...s, updated_at: new Date().toISOString() }));
    upsertProjectResourcePolicy(route.workspaceId, route.projectId, {
      resource_type: resourceType,
      resource_id: route.resourceId,
      access_mode: body.access_mode,
      allowed_subjects: normalizedAllowedSubjects,
      rate_limits: body.rate_limits,
      spending_limits: body.spending_limits,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'resource_policy.updated',
      requestId,
      resourceType: 'resource_policy',
      resourceId: `${route.resourceType}:${route.resourceId}`,
      metadata: {
        governed_resource_type: route.resourceType,
        governed_resource_id: route.resourceId,
        access_mode: {
          from: previousPolicy.access_mode,
          to: body.access_mode,
        },
        allowed_subjects_count: {
          from: Array.isArray(previousPolicy.allowed_subjects) ? previousPolicy.allowed_subjects.length : 0,
          to: normalizedAllowedSubjects.length,
        },
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sources' && method === 'GET' && route.workspaceId && route.projectId) {
    await ensureDefaultPersonalLibraryForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      userId: user.id,
      deps,
    });
    const requestedLibraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const libraries = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const ownedLibraries = dedupeDefaultPersonalLibraries(
      libraries.items.filter((item) => item.created_by_user_id === user.id),
      user.id,
    );
    const libraryId = requestedLibraryId ?? ownedLibraries[0]?.id;
    if (!libraryId) {
      json(res, 200, { items: [] });
      return true;
    }
    const matched = ownedLibraries.find((item) => item.id === libraryId);
    if (!matched) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'source_library_not_visible' });
      return true;
    }
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
    const libraries = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const targetLibrary = libraries.items.find((item) => item.id === input.library_id);
    if (!targetLibrary || targetLibrary.created_by_user_id !== user.id) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'source_library_not_visible' });
      return true;
    }
    const sourceBytes = Buffer.from(input.content_base64, 'base64').byteLength;
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: input.library_id,
    });
    if (!(await enforceSourceLibraryLimit({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: input.library_id,
      routeKind: route.kind,
      currentFileCount: listed.items.length,
      nextFileSizeBytes: sourceBytes,
    }))) {
      return true;
    }
    const created = await deps.createSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraries' && method === 'GET' && route.workspaceId && route.projectId) {
    await ensureDefaultPersonalLibraryForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      userId: user.id,
      deps,
    });
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const owned = listed.items.filter((item) => item.created_by_user_id === user.id);
    json(res, 200, {
      ...listed,
      items: dedupeDefaultPersonalLibraries(owned, user.id),
    });
    return true;
  }

  if (route.kind === 'sourceLibrariesDefaultPersonal' && method === 'GET' && route.workspaceId && route.projectId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    const existing = pickCanonicalDefaultPersonalLibrary(listed.items, user.id);
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
      input: {
        ...input,
        visibility: input.visibility ?? 'shared',
      },
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraryObjects' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
    const workspaceId = route.workspaceId;
    const projectId = route.projectId;
    const libraryId = route.libraryId;
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
    });
    const rawContentType = req.headers['content-type'];
    const contentType = Array.isArray(rawContentType) ? rawContentType.join(';') : rawContentType ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'multipart_form_data_required' });
      return true;
    }
    if (!(await enforceSourceLibraryLimit({
      workspaceId,
      projectId,
      libraryId,
      routeKind: route.kind,
      currentFileCount: listed.items.length,
      nextFileSizeBytes: 0,
    }))) {
      return true;
    }
    const uploadLimitSnapshot = checkProjectSourceLibraryLimitLimits({
      workspaceId,
      projectId,
      userId: user.id,
      policy: getProjectResourcePolicyOrDefault(
        workspaceId,
        projectId,
        'source_library',
        libraryId,
      ),
      currentFileCount: listed.items.length,
      nextFileSizeBytes: 0,
    });

    let uploaded: unknown;
    try {
      uploaded = await parseUploadAndExecute(
        req,
        (input) =>
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
        {
          maxFileSizeBytes: uploadLimitSnapshot.effective_max_file_size_bytes,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'source_library_max_file_size_exceeded') {
        const effectiveLimit = uploadLimitSnapshot.effective_max_file_size_bytes ?? 0;
        await writeProjectAuditEvent(deps, {
          workspaceId,
          projectId,
          actor: { type: 'user', id: user.id },
          action: 'resource_policy.limit_exceeded',
          result: 'error',
          requestId,
          resourceType: 'source_library',
          resourceId: libraryId,
          errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          errorMessage: 'resource_policy_spending_limit_exceeded',
          metadata: {
            governance_kind: 'resource_policy',
            enforcement_kind: 'spending_limit',
            route_kind: route.kind,
            limit_key: 'source_library.max_file_size_bytes',
            effective_limit: effectiveLimit,
            current_usage: effectiveLimit + 1,
            usage_unit: 'bytes',
            effective_max_file_size_bytes: effectiveLimit,
            current_file_size_bytes: effectiveLimit + 1,
            scope: uploadLimitSnapshot.scope,
          },
        });
        await writeProjectUsageFact(deps, {
          workspaceId,
          projectId,
          resourceType: 'source_library',
          resourceId: libraryId,
          endUserId: user.id,
          requestId,
          requests: 1,
          result: 'error',
          errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          metadata: {
            stage: 'preflight',
            governance_kind: 'resource_policy',
            enforcement_kind: 'spending_limit',
            route_kind: route.kind,
            limit_key: 'source_library.max_file_size_bytes',
            effective_limit: effectiveLimit,
            current_usage: effectiveLimit + 1,
            usage_unit: 'bytes',
            scope: uploadLimitSnapshot.scope,
          },
        });
        res.setHeader('Retry-After', '86400');
        json(res, 429, {
          error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          message: 'resource_policy_spending_limit_exceeded',
          resource_type: 'source_library',
          resource_id: libraryId,
          limit_key: 'source_library.max_file_size_bytes',
          retry_after_seconds: 86_400,
        });
        return true;
      }
      throw error;
    }
    json(res, 201, uploaded);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsDownload' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!target || target.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'source_library_not_visible',
      });
      return true;
    }
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
    if (!target || target.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'source_library_not_visible',
      });
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    if (!(await enforceSourceLibraryPreflight({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      routeKind: route.kind,
    }))) {
      return true;
    }
    const updated = await deps.cancelAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      jobId: route.jobId,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'sourceAIReadyStart' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
      routeKind: route.kind,
    }))) {
      return true;
    }
    const job = await deps.startSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyCancel' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
      routeKind: route.kind,
    }))) {
      return true;
    }
    const job = await deps.cancelSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyRetry' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
      routeKind: route.kind,
    }))) {
      return true;
    }
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
    for (const sourceId of sourceIds) {
      if (!(await enforceSourceLibraryAccessBySourceId({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId,
        routeKind: route.kind,
      }))) {
        return true;
      }
    }
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
    for (const sourceId of sourceIds) {
      if (!(await enforceSourceLibraryAccessBySourceId({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId,
        routeKind: route.kind,
      }))) {
        return true;
      }
    }
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
