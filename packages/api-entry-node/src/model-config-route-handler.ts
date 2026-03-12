import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { executeModelRequest } from './model-request-execution.js';
import { createModelConfigStore, type ModelCatalogModelProjectionRecord, type ProjectPricingRecord } from './model-config-store.js';
import { readActiveModelCatalogSnapshot, syncModelCatalogFromModelsDev } from './model-catalog-service.js';
import { parseProjectPricingPayload } from './model-config-validation.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
}

interface ModelConfigHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

function requireProjectScope(
  route: AnyRoute,
  json: ModelConfigHandlerArgs['json'],
  res: http.ServerResponse,
): { workspaceId: string; projectId: string } | null {
  if (!route.workspaceId || !route.projectId) {
    json(res, 400, { error_code: 'BAD_REQUEST', message: 'workspace_and_project_required' });
    return null;
  }
  return { workspaceId: route.workspaceId, projectId: route.projectId };
}

function filterCatalogModels(
  items: ModelCatalogModelProjectionRecord[],
  reqUrl: string | undefined,
): ModelCatalogModelProjectionRecord[] {
  const url = new URL(reqUrl ?? '', 'http://localhost');
  const provider = url.searchParams.get('provider');
  const capability = url.searchParams.get('capability');
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  return items.filter((item) => {
    if (provider && item.provider_key !== provider && item.provider_id !== provider) return false;
    if (capability && !item.capabilities.includes(capability)) return false;
    if (q && !`${item.provider_name} ${item.model_id} ${item.name}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function handleModelConfigRoute(args: ModelConfigHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody } = args;

  const scope = requireProjectScope(route, json, res);
  if (!scope) return false;
  const { workspaceId, projectId } = scope;
  const modelConfigStore = createModelConfigStore(deps.docStore);
  const projectScope = { workspaceId, projectId };

  if (route.kind === 'llmUnifiedChat' && method === 'POST') {
    const result = await executeModelRequest({
      deps,
      workspaceId,
      projectId,
      rawBody: await readBody(req),
      endUserId: user.id,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    });
    if (typeof result.body !== 'undefined') {
      json(res, result.statusCode, result.body);
      return true;
    }
    res.statusCode = result.statusCode;
    res.setHeader('content-type', result.contentType ?? 'application/octet-stream');
    res.end(result.text ?? '');
    return true;
  }

  if (route.kind === 'modelCatalogProviders' && method === 'GET') {
    const snapshot = await readActiveModelCatalogSnapshot(deps.docStore);
    if (!snapshot.version) {
      json(res, 503, { error_code: 'CATALOG_NOT_INITIALIZED', message: 'model_catalog_not_initialized' });
      return true;
    }
    json(res, 200, {
      version: snapshot.version,
      items: snapshot.providers.sort((a, b) => a.name.localeCompare(b.name)),
    });
    return true;
  }

  if (route.kind === 'modelCatalogModels' && method === 'GET') {
    const snapshot = await readActiveModelCatalogSnapshot(deps.docStore);
    if (!snapshot.version) {
      json(res, 503, { error_code: 'CATALOG_NOT_INITIALIZED', message: 'model_catalog_not_initialized' });
      return true;
    }
    const items = filterCatalogModels(snapshot.models, req.url);
    json(res, 200, {
      version: snapshot.version,
      items,
      total: items.length,
    });
    return true;
  }

  if (route.kind === 'modelCatalogSync' && method === 'POST') {
    const version = await syncModelCatalogFromModelsDev(deps.docStore, user.id);
    json(res, 201, { version });
    return true;
  }

  if (route.kind === 'projectPricing' && method === 'GET') {
    const resolved = await modelConfigStore.resolvePricing(projectScope);
    json(res, 200, resolved.pricing_map ?? {});
    return true;
  }

  if (route.kind === 'projectPricing' && method === 'PATCH') {
    const parsedPricing = parseProjectPricingPayload(await readBody(req));
    if (!parsedPricing.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedPricing.message });
      return true;
    }

    const record: ProjectPricingRecord = {
      id: modelConfigStore.pricingRecordId(projectScope),
      workspace_id: workspaceId,
      project_id: projectId,
      pricing_map: parsedPricing.value,
      updated_at: modelConfigStore.nowIso(),
    };

    await modelConfigStore.upsertPricing(record);
    json(res, 200, record.pricing_map);
    return true;
  }

  return false;
}
