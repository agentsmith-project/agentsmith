import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import {
  aggregateUsageRecords,
  getLimitsSummary,
  getUsageRecordsSummary,
  getUsageOperationsSummary,
  getUsageTimeseries,
  listAuditEvents,
  listUsageFactRecords,
} from './audit-usage-store.js';

type JsonResponder = (res: http.ServerResponse, status: number, payload: unknown) => void;

type HandlerArgs = {
  route: ProjectsRoute;
  method: string;
  req: http.IncomingMessage;
  requestUrl: URL;
  res: http.ServerResponse;
  json: JsonResponder;
  deps: NodeApiDeps;
  user?: AuthenticatedUser;
};

function parseProviderErrorClass(value: string | null): 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null {
  if (value === 'provider_retryable' || value === 'provider_non_retryable' || value === 'system_error') {
    return value;
  }
  return null;
}

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (typeof max === 'number') return Math.min(parsed, max);
  return parsed;
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function badRequest(json: JsonResponder, res: http.ServerResponse, message: string): true {
  json(res, 400, { error_code: 'BAD_REQUEST', message });
  return true;
}

function requireTimeRange(
  requestUrl: URL,
  json: JsonResponder,
  res: http.ServerResponse,
): { start: Date; end: Date } | true {
  const startRaw = requestUrl.searchParams.get('start_time');
  const endRaw = requestUrl.searchParams.get('end_time');
  if (!startRaw || !endRaw) {
    return badRequest(json, res, 'start_time and end_time are required');
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return badRequest(json, res, 'invalid_time_range');
  }
  if (end.getTime() < start.getTime()) {
    return badRequest(json, res, 'end_time must be >= start_time');
  }
  const maxRangeMs = 48 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxRangeMs) {
    return badRequest(json, res, 'time_range_exceeds_48h');
  }
  return { start, end };
}

export async function handleAuditUsageRoute({
  route,
  method,
  req,
  requestUrl,
  res,
  json,
  deps,
  user,
}: HandlerArgs): Promise<boolean> {
  const enforceOwnUsageScope = (_requestedEndUserId: string | null): string | null => {
    if (!user) return null;
    return user.id;
  };

  if (route.kind === 'usageFacts' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const page = parsePositiveInt(requestUrl.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(requestUrl.searchParams.get('page_size'), 20, 200);
    const payload = await listUsageFactRecords(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      resourceType: requestUrl.searchParams.get('resource_type'),
      resourceId: requestUrl.searchParams.get('resource_id'),
      endUserId: enforceOwnUsageScope(requestUrl.searchParams.get('end_user_id')),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseProviderErrorClass(requestUrl.searchParams.get('error_class')),
      sortOrder: requestUrl.searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc',
      page,
      pageSize,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageTimeseries' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const granularityRaw = requestUrl.searchParams.get('granularity');
    const granularity = (
      granularityRaw === 'hour'
      || granularityRaw === 'day'
      || granularityRaw === 'week'
      || granularityRaw === 'month'
    ) ? granularityRaw : 'day';
    const metricRaw = requestUrl.searchParams.get('metric');
    const metric = (
      metricRaw === 'tokens'
      || metricRaw === 'requests'
      || metricRaw === 'cost'
      || metricRaw === 'bytes'
    ) ? metricRaw : 'tokens';
    const resourceTypeRaw = requestUrl.searchParams.get('resource_type');
    const resourceType = (
      resourceTypeRaw === 'endpoint'
      || resourceTypeRaw === 'source_library'
      || resourceTypeRaw === 'agent'
    ) ? resourceTypeRaw : null;
    const payload = await getUsageTimeseries(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      granularity,
      metric,
      resourceType,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'limitsSummary' && method === 'GET') {
    const payload = await getLimitsSummary(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageRecordsSummary' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const payload = await getUsageRecordsSummary(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseProviderErrorClass(requestUrl.searchParams.get('error_class')),
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageOperationsSummary' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const payload = await getUsageOperationsSummary(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      resourceType: requestUrl.searchParams.get('resource_type'),
      resourceId: requestUrl.searchParams.get('resource_id'),
      endUserId: enforceOwnUsageScope(requestUrl.searchParams.get('end_user_id')),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseProviderErrorClass(requestUrl.searchParams.get('error_class')),
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'audit' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const page = parsePositiveInt(requestUrl.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(requestUrl.searchParams.get('page_size'), 25, 200);
    const sortOrder = requestUrl.searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';
    const payload = await listAuditEvents(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      action: requestUrl.searchParams.get('action'),
      actorType: requestUrl.searchParams.get('actor_type'),
      actorId: requestUrl.searchParams.get('actor_id'),
      endUserId: requestUrl.searchParams.get('end_user_id'),
      resourceType: requestUrl.searchParams.get('resource_type'),
      resourceId: requestUrl.searchParams.get('resource_id'),
      result: requestUrl.searchParams.get('result'),
      sortOrder,
      page,
      pageSize,
    });
    json(res, 200, payload);
    return true;
  }

  return false;
}
