import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import type { EndpointImportPayload, EndpointRecord } from './resource-models.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { enforceEndpointGovernancePreflight } from './governance-endpoint-preflight.js';
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

function hasValidModelProfile(value: unknown): boolean {
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

export function resolveEffectiveEndpointProxyPath(
  action: EndpointTaskAction,
  originalProxyPath: string,
  resolvedProxyPath: string,
): string {
  const normalizedOriginal = originalProxyPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^v1\//i, '')
    .replace(/\/+$/, '');
  const preserveClientWirePath = action === 'chat' && new Set([
    'openai/chat/completions',
    'openai/v1/chat/completions',
    'openai/responses',
    'openai/v1/responses',
    'messages/count_tokens',
    'anthropic/messages',
    'anthropic/v1/messages',
    'anthropic/messages/count_tokens',
    'anthropic/v1/messages/count_tokens',
  ]).has(normalizedOriginal);

  return preserveClientWirePath ? normalizedOriginal : (resolvedProxyPath || originalProxyPath);
}

function legacyBridgeProxyPath(proxyPath: string): string {
  const normalized = proxyPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^v1\//i, '')
    .replace(/^(openai|anthropic)\/v1\//i, '$1/')
    .replace(/\/+$/, '');
  if (normalized === 'openai/chat/completions') return 'chat/completions';
  if (normalized === 'openai/responses') return 'responses';
  if (normalized === 'anthropic/messages') return 'messages';
  if (normalized === 'anthropic/messages/count_tokens') return 'messages/count_tokens';
  return normalized;
}

function canonicalUniversalProxyPath(proxyPath: string): string | null {
  const normalized = proxyPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^v1\//i, '')
    .replace(/^(openai|anthropic)\/v1\//i, '$1/')
    .replace(/\/+$/, '');
  if (
    normalized === 'openai/chat/completions'
    || normalized === 'openai/responses'
    || normalized === 'anthropic/messages'
    || normalized === 'anthropic/messages/count_tokens'
  ) {
    return normalized;
  }
  if (normalized === 'chat/completions' || normalized === 'responses') {
    return `openai/${normalized}`;
  }
  if (normalized === 'messages' || normalized === 'messages/count_tokens') {
    return `anthropic/${normalized}`;
  }
  return null;
}

function isCanonicalProtocolProxyPath(proxyPath: string): boolean {
  const normalized = proxyPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^v1\//i, '')
    .replace(/\/+$/, '');
  return normalized.startsWith('openai/') || normalized.startsWith('anthropic/');
}

export async function handleEndpointRoute(args: EndpointHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody, buildUpstreamUrl, proxyJsonRequest } = args;
  const inferActionFromProxyPath = (proxyPath: string): EndpointTaskAction => {
    const normalized = proxyPath
      .trim()
      .replace(/^\/+/, '')
      .replace(/^v1\//i, '')
      .replace(/^(openai|anthropic|google)(?:\/v1beta)?\//i, '');
    if (normalized.startsWith('rerank')) return 'rerank';
    if (normalized.startsWith('images/generations')) return 'image_generation';
    if (normalized.startsWith('videos/generations')) return 'video_generation_create';
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
    if (endpoint.model === model) return true;
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
    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
    const governancePreflight = await enforceEndpointGovernancePreflight({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      endpoint,
      userId: user.id,
      requestId,
      source: 'endpoint_proxy_preflight',
    });
    if (!governancePreflight.allowed) {
      if (governancePreflight.retryAfterSeconds) {
        res.setHeader('Retry-After', String(governancePreflight.retryAfterSeconds));
      }
      json(res, governancePreflight.statusCode, governancePreflight.responseBody);
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
      endpoint.model;
    if (!resolvedModel) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_model_required' });
      return true;
    }

    const estimatedCostPerTokenUsd = governancePreflight.estimatedCostPerTokenUsd;

    const startedAtMs = Date.now();
    try {
      const normalizedOriginalProxyPath = normalizeGatewayProxyPath(proxyPath);
      const universalProxyService = deps.universalProxyService;
      const effectiveProxyPath = resolveEffectiveEndpointProxyPath(
        action,
        normalizedOriginalProxyPath,
        resolved.proxyPath,
      );
      const universalProxyPath =
        action === 'chat'
          ? canonicalUniversalProxyPath(effectiveProxyPath)
          : null;
      if (
        action === 'chat'
        && universalProxyPath
        && !isCanonicalProtocolProxyPath(normalizedOriginalProxyPath)
      ) {
        json(res, 422, {
          error_code: 'VALIDATION_ERROR',
          message: 'gateway_proxy_path_requires_protocol_prefix',
        });
        return true;
      }
      const requiresUniversalProxyForLlm = Boolean(universalProxyPath);
      if (requiresUniversalProxyForLlm && !universalProxyService) {
        json(res, 503, {
          error_code: 'UNIVERSAL_PROXY_REQUIRED',
          message: 'universal_proxy_required_for_llm_requests',
        });
        return true;
      }
      if (
        requiresUniversalProxyForLlm
        && universalProxyService
        && !universalProxyService.supportsEndpoint(endpoint)
      ) {
        json(res, 422, {
          error_code: 'VALIDATION_ERROR',
          message: 'universal_proxy_endpoint_protocol_not_supported',
        });
        return true;
      }
      if (
        requiresUniversalProxyForLlm
        && universalProxyService
        && universalProxyPath
        && !universalProxyService.supportsProxyPath(universalProxyPath)
      ) {
        json(res, 422, {
          error_code: 'VALIDATION_ERROR',
          message: 'universal_proxy_path_not_supported',
        });
        return true;
      }
      const canUseUniversalProxy =
        universalProxyService
        && universalProxyService.supportsEndpoint(endpoint)
        && universalProxyPath
        && universalProxyService.supportsProxyPath(universalProxyPath);
      const resolvedRequestBody =
        typeof requestBody !== 'undefined'
          ? requestBody
          : (method !== 'GET' && method !== 'HEAD' ? await readBody(req) : {});
      const legacyProxyPath = legacyBridgeProxyPath(effectiveProxyPath);
      const targetUpstreamProxyPath =
        normalizedOriginalProxyPath === 'anthropic/messages/count_tokens'
          ? 'messages/count_tokens'
          : resolved.proxyPath;
      const proxyResult = canUseUniversalProxy
        ? await (async () => {
          const namespace = await universalProxyService.ensureEndpointNamespace(
            route.workspaceId,
            route.projectId,
            endpoint,
            apiKey,
          );
          return universalProxyService.proxyJsonRequest({
            req,
            res,
            namespace,
            proxyPath: universalProxyPath ?? effectiveProxyPath,
            model: resolvedModel,
            requestBody: resolvedRequestBody,
            passthroughHeaders: collectPassthroughHeaders(req),
          });
        })()
        : await proxyJsonRequest(req, res, {
          upstreamUrl: buildUpstreamUrl(
            endpoint.base_url,
            targetUpstreamProxyPath,
          ),
          apiKey,
          endpointProtocol: endpoint.protocol,
          proxyPath: legacyProxyPath,
          model: resolvedModel,
          timeoutSeconds: endpoint.limits?.timeout_seconds,
          requestBody: resolvedRequestBody,
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
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'credential.create',
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      resourceType: 'credential',
      resourceId: created.id,
      metadata: { name: created.name, type: created.type },
    });
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
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'credential.rotate',
        result: 'error',
        errorCode: 'RESOURCE_NOT_FOUND',
        errorMessage: 'credential_not_found',
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
        resourceType: 'credential',
        resourceId: route.credentialId,
      });
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'credential_not_found' });
      return true;
    }
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'credential.rotate',
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      resourceType: 'credential',
      resourceId: updated.id,
      metadata: { name: updated.name, type: updated.type },
    });
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
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'credential.delete',
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      resourceType: 'credential',
      resourceId: route.credentialId,
    });
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
    if (!raw.name?.trim() || !raw.base_url?.trim() || (!raw.model?.trim() && !hasModels)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_required_fields_missing' });
      return true;
    }
    if (raw.model_profile !== undefined && !hasValidModelProfile(raw.model_profile)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_model_profile_invalid' });
      return true;
    }
    try {
      const created = await deps.endpointResourceService.createEndpoint(
        route.workspaceId,
        route.projectId,
        raw,
      );
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'endpoint.create',
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
        resourceType: 'endpoint',
        resourceId: created.id,
        metadata: { name: created.name, model: created.model, protocol: created.protocol },
      });
      json(res, 201, created);
    } catch (error) {
      if (error instanceof Error && error.message === 'endpoint_model_required') {
        await writeProjectAuditEvent(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actor: { type: 'user', id: user.id },
          action: 'endpoint.create',
          result: 'error',
          errorCode: 'VALIDATION_ERROR',
          errorMessage: 'endpoint_model_required',
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
          resourceType: 'endpoint',
          metadata: { name: raw.name },
        });
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
    if (raw.model_profile !== undefined && !hasValidModelProfile(raw.model_profile)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'endpoint_model_profile_invalid' });
      return true;
    }
    const updated = await deps.endpointResourceService.updateEndpoint(
      route.workspaceId,
      route.projectId,
      route.endpointId,
      raw,
    );
    if (!updated) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'endpoint.update',
        result: 'error',
        errorCode: 'RESOURCE_NOT_FOUND',
        errorMessage: 'endpoint_not_found',
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
        resourceType: 'endpoint',
        resourceId: route.endpointId,
      });
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
      return true;
    }
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'endpoint.update',
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      resourceType: 'endpoint',
      resourceId: updated.id,
      metadata: { name: updated.name, model: updated.model, protocol: updated.protocol },
    });
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
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'endpoint.delete',
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      resourceType: 'endpoint',
      resourceId: route.endpointId,
    });
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
    const proxyPath = normalizeGatewayProxyPath(route.proxyPath);
    const supportedProxyPaths = new Set([
      'openai/chat/completions',
      'openai/responses',
      'anthropic/messages',
      'anthropic/messages/count_tokens',
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
