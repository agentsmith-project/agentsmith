import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { aggregateUsageRecords, getUsageKpi, listAuditEvents } from './audit-usage-store.js';

type JsonResponder = (res: http.ServerResponse, status: number, payload: unknown) => void;

type HandlerArgs = {
  route: ProjectsRoute;
  method: string;
  requestUrl: URL;
  res: http.ServerResponse;
  json: JsonResponder;
  deps: NodeApiDeps;
};

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (typeof max === 'number') return Math.min(parsed, max);
  return parsed;
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
  return { start, end };
}

export async function handleAuditUsageRoute({
  route,
  method,
  requestUrl,
  res,
  json,
  deps,
}: HandlerArgs): Promise<boolean> {
  if (route.kind === 'usageKpi' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const payload = await getUsageKpi(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      endUserId: requestUrl.searchParams.get('end_user_id'),
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usage' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const page = parsePositiveInt(requestUrl.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(requestUrl.searchParams.get('page_size'), 25, 200);
    const resourceType = requestUrl.searchParams.get('resource_type');
    const resourceId = requestUrl.searchParams.get('resource_id');
    const endUserId = requestUrl.searchParams.get('end_user_id');
    const groupBy = requestUrl.searchParams.get('group_by') === 'hour' ? 'hour' : 'day';
    const sortByRaw = requestUrl.searchParams.get('sort_by');
    const sortOrder = requestUrl.searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';
    const sortBy =
      sortByRaw === 'resource_type' || sortByRaw === 'requests' || sortByRaw === 'time_bucket'
        ? sortByRaw
        : 'time_bucket';
    const payload = await aggregateUsageRecords(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      resourceType,
      resourceId,
      endUserId,
      groupBy,
      sortBy,
      sortOrder,
      page,
      pageSize,
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
