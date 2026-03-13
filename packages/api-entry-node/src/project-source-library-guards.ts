import type http from 'node:http';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectSourceLibraryLimitLimits,
} from './project-resource-policy-enforcer.js';
import {
  getProjectResourcePolicyOrDefault,
  isProjectResourceAccessAllowedForUser,
} from './project-resource-policy-store.js';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

export function createSourceLibraryGuards(args: {
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  requestId: string | null;
  res: http.ServerResponse;
  json: JsonResponder;
}) {
  const { deps, user, requestId, res, json } = args;

  async function enforceAccess(params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> {
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
  }

  async function enforceRateLimit(params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> {
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
  }

  async function enforcePreflight(params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }): Promise<boolean> {
    if (!(await enforceAccess(params))) return false;
    return enforceRateLimit(params);
  }

  async function enforceLimit(params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
    currentFileCount: number;
    nextFileSizeBytes: number;
  }): Promise<boolean> {
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
  }

  async function enforceAccessBySourceId(params: {
    workspaceId: string;
    projectId: string;
    sourceId: string;
    routeKind: string;
  }): Promise<boolean> {
    const source = await deps.getSourceUseCase.execute({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      sourceId: params.sourceId,
    }) as { id: string; library_id?: string };
    const libraryId = typeof source.library_id === 'string' ? source.library_id : '';
    if (!libraryId) {
      return true;
    }
    return enforcePreflight({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      libraryId,
      routeKind: params.routeKind,
    });
  }

  return {
    enforceSourceLibraryAccess: enforceAccess,
    enforceSourceLibraryRateLimit: enforceRateLimit,
    enforceSourceLibraryPreflight: enforcePreflight,
    enforceSourceLibraryLimit: enforceLimit,
    enforceSourceLibraryAccessBySourceId: enforceAccessBySourceId,
  };
}
