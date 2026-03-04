import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import type { EndpointImportPayload, EndpointRecord } from './resource-models.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import {
  checkProjectEndpointRateLimitsForUser,
  checkProjectEndpointSpendingLimitsForUser,
} from './project-resource-policy-enforcer.js';
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

function hasValidRuntimeProfile(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  const positiveNumber = (field: string) => typeof profile[field] === 'number' && Number.isFinite(profile[field]) && (profile[field] as number) > 0;
  const nonNegativeNumber = (field: string) => typeof profile[field] === 'number' && Number.isFinite(profile[field]) && (profile[field] as number) >= 0;
  const boolField = (field: string) => typeof profile[field] === 'boolean';
  const ratio = (field: string) => typeof profile[field] === 'number' && Number.isFinite(profile[field]) && (profile[field] as number) >= 0 && (profile[field] as number) <= 1;
  if (
    !positiveNumber('max_context_tokens')
    || !positiveNumber('max_output_tokens')
    || !boolField('supports_file')
    || !boolField('supports_tool_call')
    || !boolField('supports_reasoning')
    || !nonNegativeNumber('price_input_per_1m')
    || !nonNegativeNumber('price_output_per_1m')
    || !ratio('cache_read_discount_ratio')
  ) {
    return false;
  }
  if (
    typeof profile.cache_write_discount_ratio !== 'undefined'
    && !nonNegativeNumber('cache_write_discount_ratio')
  ) {
    return false;
  }
  return (profile.max_output_tokens as number) <= (profile.max_context_tokens as number);
}

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
      endpointProtocol?: string;
      proxyPath?: string;
      model?: string;
      timeoutSeconds?: number;
      requestBody?: unknown;
      passthroughHeaders?: Record<string, string>;
    },
  ) => Promise<{ upstream_status: number; tokens_total?: number }>;
}

export async function handleEndpointRoute(args: EndpointHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody, buildUpstreamUrl, proxyJsonRequest } = args;
  type GovernancePreflightFailureSpec = {
    action: string;
    errorCode: string;
    message: string;
    statusCode: 403 | 429;
    metadata: Record<string, unknown>;
    endUserId?: string;
    retryAfterSeconds?: number;
    spendingKey?: string;
  };
  const governanceMetadata = (
    kind: 'access_denied' | 'policy_spending' | 'policy_rate',
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    switch (kind) {
      case 'access_denied':
        return { governance_kind: 'resource_policy', enforcement_kind: 'allow_list', ...extra };
      case 'policy_spending':
        return { governance_kind: 'resource_policy', enforcement_kind: 'spending_limit', ...extra };
      case 'policy_rate':
        return { governance_kind: 'resource_policy', enforcement_kind: 'rate_limit', ...extra };
    }
  };
  const policyAccessDeniedFailure = (reason: string): GovernancePreflightFailureSpec => ({
    action: 'resource_policy.access_denied',
    errorCode: 'RESOURCE_POLICY_DENIED',
    message: 'resource_policy_denied',
    statusCode: 403,
    metadata: governanceMetadata('access_denied', { reason }),
  });
  const policyRateFailure = (params: {
    retryAfterSeconds: number;
    rateKey: string;
    effectiveLimit: number;
    currentRequests: number;
    windowSeconds: number;
    scope?: string;
  }): GovernancePreflightFailureSpec => ({
    action: 'resource_policy.rate_limited',
    errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
    message: 'resource_policy_rate_limited',
    statusCode: 429,
    retryAfterSeconds: params.retryAfterSeconds,
    endUserId: user.id,
    metadata: governanceMetadata('policy_rate', {
      rate_key: params.rateKey,
      effective_limit: params.effectiveLimit,
      current_requests: params.currentRequests,
      window_seconds: params.windowSeconds,
      scope: params.scope,
    }),
  });
  const policySpendingFailure = (params: {
    retryAfterSeconds: number;
    spendingKey: string;
    effectiveLimitUsd: number;
    currentSpendingUsd: number;
    windowSeconds: number;
    scope?: string;
  }): GovernancePreflightFailureSpec => ({
    action: 'resource_policy.spending_limited',
    errorCode: 'RESOURCE_POLICY_SPENDING_LIMITED',
    message: 'resource_policy_spending_limited',
    statusCode: 429,
    retryAfterSeconds: params.retryAfterSeconds,
    spendingKey: params.spendingKey,
    metadata: governanceMetadata('policy_spending', {
      spending_key: params.spendingKey,
      effective_limit_usd: params.effectiveLimitUsd,
      current_spending_usd: params.currentSpendingUsd,
      window_seconds: params.windowSeconds,
      scope: params.scope,
    }),
  });
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
    spendingKey?: string;
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
      ...(params.spendingKey ? { spending_key: params.spendingKey } : {}),
    });
  };
  const inferActionFromProxyPath = (proxyPath: string): EndpointTaskAction => {
    if (proxyPath.startsWith('rerank')) return 'rerank';
    if (proxyPath.startsWith('images/generations')) return 'image_generation';
    if (proxyPath.startsWith('videos/generations')) return 'video_generation_create';
    return 'chat';
  };
  const normalizeGatewayProxyPath = (value: string): string =>
    value
      .trim()
      .replace(/^\/+/, '')
      .replace(/^v1\//i, '')
      .replace(/\/+$/, '');
  const collectPassthroughHeaders = (request: http.IncomingMessage): Record<string, string> => {
    const collected: Record<string, string> = {};
    const keys = ['anthropic-version', 'anthropic-beta', 'x-stainless-helper-method'] as const;
    for (const key of keys) {
      const raw = request.headers[key];
      if (typeof raw === 'string' && raw.trim()) {
        collected[key] = raw.trim();
      } else if (Array.isArray(raw) && raw.length > 0) {
        const joined = raw.map((item) => item.trim()).filter(Boolean).join(',');
        if (joined) collected[key] = joined;
      }
    }
    return collected;
  };
  const asObject = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };
  const asNonEmptyString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const endpointMatchesModel = (endpoint: EndpointRecord, model: string): boolean => {
    if (endpoint.openai_model === model) return true;
    if (Array.isArray(endpoint.models) && endpoint.models.some((item) => item.model_id === model)) return true;
    const defaults = endpoint.defaults;
    if (!defaults) return false;
    return [
      defaults.chat_model_id,
      defaults.multimodal_model_id,
      defaults.embedding_model_id,
      defaults.rerank_model_id,
      defaults.image_model_id,
      defaults.video_model_id,
    ].includes(model);
  };
  const endpointMatchesInternalGatewayModel = (endpoint: EndpointRecord, model: string): boolean =>
    endpoint.id === model || endpoint.name === model;
  const proxyEndpointRequest = async (
    endpointId: string,
    proxyPath: string,
    action: EndpointTaskAction = 'chat',
    jobId?: string,
    requestBody?: unknown,
    forceModel?: string,
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
      const failure = policyAccessDeniedFailure(policyCheck.reason ?? 'not_allowed');
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        endUserId: user.id,
        ...failure,
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
      forceModel ??
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
    const rateCheck = await checkProjectEndpointRateLimitsForUser({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceId: endpoint.id,
      userId: user.id,
      policy: policyCheck.policy,
    });
    if (!rateCheck.allowed) {
      const failure = policyRateFailure({
        retryAfterSeconds: rateCheck.retry_after_seconds,
        rateKey: rateCheck.rate_key,
        effectiveLimit: rateCheck.effective_limit,
        currentRequests: rateCheck.current_requests,
        windowSeconds: rateCheck.window_seconds,
        scope: rateCheck.scope,
      });
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        ...failure,
      });
      return true;
    }
    const estimatedCostPerTokenUsd = (() => {
      const profile = endpoint.runtime_profile;
      if (!profile) return undefined;
      const inputPrice = typeof profile.price_input_per_1m === 'number' ? profile.price_input_per_1m : undefined;
      const outputPrice = typeof profile.price_output_per_1m === 'number' ? profile.price_output_per_1m : undefined;
      const effectivePricePer1M = Math.max(inputPrice ?? 0, outputPrice ?? 0);
      if (!Number.isFinite(effectivePricePer1M) || effectivePricePer1M <= 0) return undefined;
      return effectivePricePer1M / 1_000_000;
    })();
    const spendingCheck = await checkProjectEndpointSpendingLimitsForUser({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceId: endpoint.id,
      userId: user.id,
      policy: policyCheck.policy,
      estimatedCostPerTokenUsd,
    });
    if (!spendingCheck.allowed) {
      const failure = policySpendingFailure({
        retryAfterSeconds: spendingCheck.retry_after_seconds,
        spendingKey: spendingCheck.spending_key,
        effectiveLimitUsd: spendingCheck.effective_limit_usd,
        currentSpendingUsd: spendingCheck.current_spending_usd,
        windowSeconds: spendingCheck.window_seconds,
        scope: spendingCheck.scope,
      });
      await writeGovernancePreflightFailure({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        endpointId: endpoint.id,
        requestId,
        endUserId: user.id,
        ...failure,
      });
      return true;
    }

    const startedAtMs = Date.now();
    try {
      const effectiveProxyPath =
        action === 'chat' && normalizeGatewayProxyPath(proxyPath) === 'messages/count_tokens'
          ? normalizeGatewayProxyPath(proxyPath)
          : (resolved.proxyPath || proxyPath);
      const proxyResult = await proxyJsonRequest(req, res, {
        upstreamUrl: buildUpstreamUrl(endpoint.base_url, effectiveProxyPath),
        apiKey,
        endpointProtocol: endpoint.protocol,
        proxyPath,
        model: resolvedModel,
        timeoutSeconds: endpoint.limits?.timeout_seconds,
        requestBody,
        passthroughHeaders: collectPassthroughHeaders(req),
      });
      await writeProjectUsageFact(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        endUserId: user.id,
        requestId,
        requests: 1,
        tokensTotal: proxyResult.tokens_total,
        durationMs: Date.now() - startedAtMs,
        result: 'ok',
        metadata: {
          ...(typeof estimatedCostPerTokenUsd === 'number' && proxyResult.tokens_total
            ? { cost_usd: Number((proxyResult.tokens_total * estimatedCostPerTokenUsd).toFixed(6)) }
            : {}),
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
    if (raw.runtime_profile !== undefined && !hasValidRuntimeProfile(raw.runtime_profile)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_runtime_profile_invalid' });
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
    if (raw.runtime_profile !== undefined && !hasValidRuntimeProfile(raw.runtime_profile)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_runtime_profile_invalid' });
      return true;
    }
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

  if (route.kind === 'llmGatewayProxy' && method === 'POST' && route.workspaceId && route.projectId && route.proxyPath) {
    const normalizedProxyPath = normalizeGatewayProxyPath(route.proxyPath);
    const proxyPath = normalizedProxyPath === 'completions' ? 'chat/completions' : normalizedProxyPath;
    const supportedProxyPaths = new Set([
      'chat/completions',
      'responses',
      'messages',
      'messages/count_tokens',
    ]);
    if (!supportedProxyPaths.has(proxyPath)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'gateway_proxy_path_not_supported' });
      return true;
    }
    const body = await readBody(req);
    const bodyObj = asObject(body);
    const requestedModel = asNonEmptyString(bodyObj?.model);
    const rawExplicitEndpointId = req.headers['x-agentsmith-endpoint-id'];
    const explicitEndpointId = asNonEmptyString(
      Array.isArray(rawExplicitEndpointId) ? rawExplicitEndpointId[0] : rawExplicitEndpointId,
    );
    if (!requestedModel && !explicitEndpointId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'gateway_model_or_endpoint_required' });
      return true;
    }
    const endpoints = await deps.endpointResourceService.listEndpoints(route.workspaceId, route.projectId);
    let endpoint: EndpointRecord | undefined;
    let upstreamModelOverride: string | undefined;
    if (explicitEndpointId) {
      endpoint = endpoints.find((item) => item.id === explicitEndpointId);
      if (!endpoint) {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
        return true;
      }
      if (requestedModel && !endpointMatchesInternalGatewayModel(endpoint, requestedModel)) {
        upstreamModelOverride = requestedModel;
      }
    } else if (requestedModel) {
      const internalMatched = endpoints.filter((item) => endpointMatchesInternalGatewayModel(item, requestedModel));
      if (internalMatched.length > 1) {
        json(res, 409, { error_code: 'GATEWAY_MODEL_AMBIGUOUS', message: 'gateway_model_ambiguous' });
        return true;
      }
      if (internalMatched.length === 1) {
        endpoint = internalMatched[0];
        upstreamModelOverride = undefined;
      }
      if (endpoint) {
        return proxyEndpointRequest(
          endpoint.id,
          proxyPath,
          inferActionFromProxyPath(proxyPath),
          undefined,
          bodyObj ?? body,
          upstreamModelOverride,
        );
      }
      const matched = endpoints.filter((item) => endpointMatchesModel(item, requestedModel));
      if (matched.length === 0) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'gateway_model_not_routable' });
        return true;
      }
      if (matched.length > 1) {
        json(res, 409, { error_code: 'GATEWAY_MODEL_AMBIGUOUS', message: 'gateway_model_ambiguous' });
        return true;
      }
      endpoint = matched[0];
      upstreamModelOverride = requestedModel;
    }
    if (!endpoint) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'gateway_endpoint_resolution_failed' });
      return true;
    }
    return proxyEndpointRequest(
      endpoint.id,
      proxyPath,
      inferActionFromProxyPath(proxyPath),
      undefined,
      bodyObj ?? body,
      upstreamModelOverride,
    );
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
