import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import type { EndpointImportPayload, EndpointRecord } from './resource-models.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectResourceQuotaLimitsForUser,
} from './project-resource-policy-enforcer.js';
import { checkMemberEndpointDailyTokenQuota } from './project-member-quota-enforcer.js';
import {
  isCapabilitySupportedByProtocol,
  resolveEndpointTaskRoute,
  type EndpointTaskAction,
} from './endpoint-protocol-router.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  credentialId?: string;
  endpointId?: string;
  proxyPath?: string;
  jobId?: string;
}

type EndpointRecordInput = Partial<EndpointRecord>;

interface EndpointHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  buildUpstreamUrl: (baseUrl: string, proxyPath: string) => string;
  proxyJsonRequest: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: {
      upstreamUrl: string;
      apiKey: string;
      model?: string;
      timeoutSeconds?: number;
      responsesFallbackToChat?: boolean;
    },
  ) => Promise<void>;
}

export async function handleEndpointRoute(args: EndpointHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody, buildUpstreamUrl, proxyJsonRequest } = args;
  const writeGovernancePreflightFailure = async (params: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    requestId: string | null;
    action: string;
    errorCode: string;
    message: string;
    statusCode: 403 | 429;
    metadata?: Record<string, unknown>;
    endUserId?: string;
    retryAfterSeconds?: number;
  }): Promise<void> => {
    await writeProjectAuditEvent(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      actor: { type: 'user', id: user.id },
      action: params.action,
      result: 'error',
      requestId: params.requestId,
      resourceType: 'endpoint',
      resourceId: params.endpointId,
      errorCode: params.errorCode,
      errorMessage: params.message,
      metadata: params.metadata ?? {},
    });
    await writeProjectUsageFact(deps, {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      resourceType: 'endpoint',
      resourceId: params.endpointId,
      endUserId: params.endUserId,
      requestId: params.requestId,
      requests: 1,
      result: 'error',
      errorCode: params.errorCode,
      metadata: {
        stage: 'preflight',
        ...(params.metadata ?? {}),
      },
    });
    if (params.retryAfterSeconds) {
      res.setHeader('Retry-After', String(params.retryAfterSeconds));
    }
    json(res, params.statusCode, {
      error_code: params.errorCode,
      message: params.message,
      resource_type: 'endpoint',
      resource_id: params.endpointId,
      ...(params.retryAfterSeconds ? { retry_after_seconds: params.retryAfterSeconds } : {}),
    });
  };
  const inferActionFromProxyPath = (proxyPath: string): EndpointTaskAction => {
    if (proxyPath.startsWith('rerank')) return 'rerank';
    if (proxyPath.startsWith('images/generations')) return 'image_generation';
    if (proxyPath.startsWith('videos/generations')) return 'video_generation_create';
    return 'chat';
  };
  const proxyEndpointRequest = async (
    endpointId: string,
    proxyPath: string,
    action: EndpointTaskAction = 'chat',
    jobId?: string,
  ): Promise<boolean> => {
    if (!route.workspaceId || !route.projectId) {
      return false;
    }
    const endpoint = await deps.endpointResourceService.getEndpoint(
      route.workspaceId,
      route.projectId,
      endpointId,
    );
    if (!endpoint) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
      return true;
    }
    const policyCheck = isProjectResourceAccessAllowedForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      userId: user.id,
    });
    if (!policyCheck.allowed) {
      const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        action: 'resource_policy.access_denied',
        errorCode: 'RESOURCE_POLICY_DENIED',
        message: 'resource_policy_denied',
        statusCode: 403,
        metadata: { reason: policyCheck.reason ?? 'not_allowed' },
      });
      return true;
    }
    if (endpoint.status !== 'active') {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_disabled' });
      return true;
    }
    if (!endpoint.credential_ref) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_credential_missing' });
      return true;
    }
    const apiKey = await deps.endpointResourceService.getCredentialSecret(
      route.workspaceId,
      route.projectId,
      endpoint.credential_ref,
    );
    if (!apiKey) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_credential_not_found' });
      return true;
    }

    const resolved = resolveEndpointTaskRoute(endpoint, action, jobId);
    const capability = resolved.capability;
    if (!isCapabilitySupportedByProtocol(endpoint.protocol, capability)) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'endpoint_capability_not_supported_for_protocol',
      });
      return true;
    }
    const isChatRoute = capability === 'chat_completion';
    const chatEnabled =
      endpoint.capabilities?.find((item) => item.type === 'chat_completion')?.enabled ??
      true;
    const multimodalEnabled =
      endpoint.capabilities?.find((item) => item.type === 'multimodal_completion')?.enabled ??
      false;
    const enabled = isChatRoute
      ? chatEnabled || multimodalEnabled
      : (endpoint.capabilities?.find((item) => item.type === capability)?.enabled ?? false);
    if (!enabled) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_capability_not_enabled' });
      return true;
    }
    const defaultModelByCapability = {
      chat_completion: endpoint.defaults?.chat_model_id ?? endpoint.defaults?.multimodal_model_id,
      multimodal_completion: endpoint.defaults?.multimodal_model_id ?? endpoint.defaults?.chat_model_id,
      rerank: endpoint.defaults?.rerank_model_id,
      image_generation: endpoint.defaults?.image_model_id,
      video_generation: endpoint.defaults?.video_model_id,
    } as const;
    const resolvedModel =
      defaultModelByCapability[capability] ??
      endpoint.models?.find((item) => item.capability === capability)?.model_id ??
      (isChatRoute
        ? endpoint.models?.find((item) => item.capability === 'multimodal_completion')?.model_id
        : undefined) ??
      endpoint.openai_model;
    if (!resolvedModel) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_model_required' });
      return true;
    }

    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
    const quotaCheck = await checkProjectResourceQuotaLimitsForUser({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      userId: user.id,
      policy: policyCheck.policy,
    });
    if (!quotaCheck.allowed) {
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        endUserId: user.id,
        action: 'resource_policy.quota_exceeded',
        errorCode: 'RESOURCE_POLICY_QUOTA_EXCEEDED',
        message: 'resource_policy_quota_exceeded',
        statusCode: 429,
        retryAfterSeconds: quotaCheck.retry_after_seconds,
        metadata: {
          effective_daily_token_limit: quotaCheck.effective_daily_token_limit,
          current_tokens_today: quotaCheck.current_tokens_today,
          scope: quotaCheck.scope,
          quota_key: 'endpoint.daily_token_limit',
        },
      });
      return true;
    }
    const memberQuotaCheck = await checkMemberEndpointDailyTokenQuota({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      endpointId: endpoint.id,
      userId: user.id,
    });
    if (!memberQuotaCheck.allowed) {
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        endUserId: user.id,
        action: 'member_quota.quota_exceeded',
        errorCode: 'MEMBER_QUOTA_EXCEEDED',
        message: 'member_quota_exceeded',
        statusCode: 429,
        retryAfterSeconds: memberQuotaCheck.retry_after_seconds,
        metadata: {
          effective_daily_token_limit: memberQuotaCheck.effective_daily_token_limit,
          current_tokens_today: memberQuotaCheck.current_tokens_today,
          quota_key: 'endpoint.daily_token_limit',
        },
      });
      return true;
    }
    const rateCheck = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      userId: user.id,
      policy: policyCheck.policy,
    });
    if (!rateCheck.allowed) {
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        endUserId: user.id,
        action: 'resource_policy.rate_limited',
        errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
        message: 'resource_policy_rate_limited',
        statusCode: 429,
        retryAfterSeconds: rateCheck.retry_after_seconds,
        metadata: {
          effective_limit_per_minute: rateCheck.effective_limit_per_minute,
          scope: rateCheck.scope,
        },
      });
      return true;
    }

    const startedAtMs = Date.now();
    try {
      await proxyJsonRequest(req, res, {
        upstreamUrl: buildUpstreamUrl(endpoint.base_url, resolved.proxyPath || proxyPath),
        apiKey,
        model: resolvedModel,
        timeoutSeconds: endpoint.limits?.timeout_seconds,
        responsesFallbackToChat:
          proxyPath.replace(/^\/+/, '') === 'responses'
          && endpoint.protocol === 'openai_compatible',
      });
      await writeProjectUsageFact(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        endUserId: user.id,
        requestId,
        requests: 1,
        durationMs: Date.now() - startedAtMs,
        result: 'ok',
        metadata: {
          endpoint_protocol: endpoint.protocol,
          capability,
          model: resolvedModel,
          proxy_path: resolved.proxyPath || proxyPath,
        },
      });
    } catch (error) {
      await writeProjectUsageFact(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        endUserId: user.id,
        requestId,
        requests: 1,
        durationMs: Date.now() - startedAtMs,
        result: 'error',
        metadata: {
          endpoint_protocol: endpoint.protocol,
          capability,
          model: resolvedModel,
          proxy_path: resolved.proxyPath || proxyPath,
          error: error instanceof Error ? error.message : 'proxy_request_error',
        },
      });
      throw error;
    }
    return true;
  };

  if (route.kind === 'credentials' && method === 'GET' && route.workspaceId && route.projectId) {
    const items = await deps.endpointResourceService.listCredentials(
      route.workspaceId,
      route.projectId,
    );
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'credentials' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as { name?: string; type?: string; value?: string };
    if (!raw.name?.trim() || !raw.value?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'credential_name_and_value_required' });
      return true;
    }
    const created = await deps.endpointResourceService.createCredential(
      route.workspaceId,
      route.projectId,
      {
        name: raw.name,
        value: raw.value,
        type: 'api_key',
      },
    );
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'credentialRotate' && method === 'POST' && route.workspaceId && route.projectId && route.credentialId) {
    const raw = (await readBody(req)) as { value?: string };
    if (!raw.value?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'credential_value_required' });
      return true;
    }
    const updated = await deps.endpointResourceService.rotateCredential(
      route.workspaceId,
      route.projectId,
      route.credentialId,
      raw.value,
    );
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'credential_not_found' });
      return true;
    }
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'credentialItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.credentialId) {
    const deleted = await deps.endpointResourceService.deleteCredential(
      route.workspaceId,
      route.projectId,
      route.credentialId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'credential_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'endpoints' && method === 'GET' && route.workspaceId && route.projectId) {
    const items = await deps.endpointResourceService.listEndpoints(
      route.workspaceId,
      route.projectId,
    );
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'endpoints' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as EndpointRecordInput;
    const hasModels = Array.isArray(raw.models) && raw.models.length > 0;
    if (!raw.name?.trim() || !raw.base_url?.trim() || (!raw.openai_model?.trim() && !hasModels)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_required_fields_missing' });
      return true;
    }
    try {
      const created = await deps.endpointResourceService.createEndpoint(
        route.workspaceId,
        route.projectId,
        raw,
      );
      json(res, 201, created);
    } catch (error) {
      if (error instanceof Error && error.message === 'endpoint_model_conflict') {
        json(res, 409, { error_code: 'ENDPOINT_MODEL_CONFLICT', message: 'endpoint_model_conflict' });
        return true;
      }
      if (error instanceof Error && error.message === 'endpoint_model_required') {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_model_required' });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (route.kind === 'endpointItem' && method === 'GET' && route.workspaceId && route.projectId && route.endpointId) {
    const endpoint = await deps.endpointResourceService.getEndpoint(
      route.workspaceId,
      route.projectId,
      route.endpointId,
    );
    if (!endpoint) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
      return true;
    }
    json(res, 200, endpoint);
    return true;
  }

  if (route.kind === 'endpointItem' && method === 'PUT' && route.workspaceId && route.projectId && route.endpointId) {
    const raw = (await readBody(req)) as EndpointRecordInput;
    const updated = await deps.endpointResourceService.updateEndpoint(
      route.workspaceId,
      route.projectId,
      route.endpointId,
      raw,
    );
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
      return true;
    }
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'endpointItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.endpointId) {
    const deleted = await deps.endpointResourceService.deleteEndpoint(
      route.workspaceId,
      route.projectId,
      route.endpointId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'endpointImportOpenAICompatible' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as EndpointImportPayload;
    const imported = await deps.endpointResourceService.importOpenAICompatible(
      route.workspaceId,
      route.projectId,
      raw,
    );
    json(res, 201, imported);
    return true;
  }

  if (route.kind === 'endpointProxy' && method === 'POST' && route.workspaceId && route.projectId && route.endpointId && route.proxyPath) {
    return proxyEndpointRequest(route.endpointId, route.proxyPath, inferActionFromProxyPath(route.proxyPath));
  }

  if (route.kind === 'endpointRerank' && method === 'POST' && route.endpointId) {
    return proxyEndpointRequest(route.endpointId, 'rerank', 'rerank');
  }

  if (route.kind === 'endpointImageGeneration' && method === 'POST' && route.endpointId) {
    return proxyEndpointRequest(route.endpointId, 'images/generations', 'image_generation');
  }

  if (route.kind === 'endpointVideoGenerationCreate' && method === 'POST' && route.endpointId) {
    return proxyEndpointRequest(route.endpointId, 'videos/generations', 'video_generation_create');
  }

  if (route.kind === 'endpointVideoGenerationPoll' && (method === 'GET' || method === 'POST') && route.endpointId && route.jobId) {
    return proxyEndpointRequest(
      route.endpointId,
      `videos/generations/${route.jobId}`,
      'video_generation_poll',
      route.jobId,
    );
  }

  if (route.kind === 'endpointVideoGenerationCancel' && method === 'POST' && route.endpointId && route.jobId) {
    return proxyEndpointRequest(
      route.endpointId,
      `videos/generations/${route.jobId}/cancel`,
      'video_generation_cancel',
      route.jobId,
    );
  }

  return false;
}
