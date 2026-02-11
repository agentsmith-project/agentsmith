import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { EndpointImportPayload, EndpointRecord } from './resource-models.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  credentialId?: string;
  endpointId?: string;
  proxyPath?: string;
}

type EndpointRecordInput = Partial<EndpointRecord>;

interface EndpointHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  buildUpstreamUrl: (baseUrl: string, proxyPath: string) => string;
  proxyJsonRequest: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: { upstreamUrl: string; apiKey: string; sourceModel?: string; timeoutSeconds?: number },
  ) => Promise<void>;
}

export async function handleEndpointRoute(args: EndpointHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, json, readBody, buildUpstreamUrl, proxyJsonRequest } = args;

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
    if (!raw.name?.trim() || !raw.openai_model?.trim() || !raw.base_url?.trim()) {
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
    const endpoint = await deps.endpointResourceService.getEndpoint(
      route.workspaceId,
      route.projectId,
      route.endpointId,
    );
    if (!endpoint) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' });
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
    await proxyJsonRequest(req, res, {
      upstreamUrl: buildUpstreamUrl(endpoint.base_url, route.proxyPath),
      apiKey,
      sourceModel: endpoint.source_model ?? endpoint.openai_model,
      timeoutSeconds: endpoint.limits?.timeout_seconds,
    });
    return true;
  }

  return false;
}
