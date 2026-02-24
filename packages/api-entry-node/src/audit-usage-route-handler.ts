import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import { getNotebookRuntimeMetricsState } from './notebook-runtime-metrics.js';

type JsonResponder = (res: http.ServerResponse, status: number, payload: unknown) => void;

type HandlerArgs = {
  route: ProjectsRoute;
  method: string;
  requestUrl: URL;
  res: http.ServerResponse;
  json: JsonResponder;
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

function isDateInRange(now: Date, start: Date, end: Date): boolean {
  return now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
}

function formatBucket(date: Date, groupBy: 'day' | 'hour'): string {
  const iso = date.toISOString();
  if (groupBy === 'day') return iso.slice(0, 10);
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
}

export async function handleAuditUsageRoute({
  route,
  method,
  requestUrl,
  res,
  json,
}: HandlerArgs): Promise<boolean> {
  if (route.kind === 'usageKpi' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const metrics = getNotebookRuntimeMetricsState();
    const now = new Date();
    const inRange = isDateInRange(now, range.start, range.end);
    json(res, 200, {
      requests_today: inRange ? metrics.task_runs_started : 0,
      errors_today: inRange ? metrics.task_runs_failed : 0,
      tokens_today: undefined,
      requests_yesterday: 0,
      errors_yesterday: 0,
      tokens_yesterday: undefined,
    });
    return true;
  }

  if (route.kind === 'usage' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const page = parsePositiveInt(requestUrl.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(requestUrl.searchParams.get('page_size'), 25, 200);
    const resourceType = requestUrl.searchParams.get('resource_type');
    const groupBy = requestUrl.searchParams.get('group_by') === 'hour' ? 'hour' : 'day';

    const metrics = getNotebookRuntimeMetricsState();
    const now = new Date();
    const inRange = isDateInRange(now, range.start, range.end);
    const canEmitSynthetic = !resourceType || resourceType === 'notebook_task';
    const items =
      inRange && canEmitSynthetic && metrics.task_runs_started > 0
        ? [
            {
              id: `usage_notebook_runtime_${groupBy}`,
              time_bucket: formatBucket(now, groupBy),
              workspace_id: route.workspaceId,
              project_id: route.projectId,
              resource_type: 'notebook_task',
              resource_id: 'notebook_runtime',
              requests: metrics.task_runs_started,
              duration_p95_ms: undefined,
              bytes_in: undefined,
              bytes_out: undefined,
              tokens: undefined,
            },
          ]
        : [];

    const startIndex = (page - 1) * pageSize;
    const paged = items.slice(startIndex, startIndex + pageSize);
    json(res, 200, {
      items: paged,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: startIndex + pageSize < items.length,
    });
    return true;
  }

  if (route.kind === 'audit' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const page = parsePositiveInt(requestUrl.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(requestUrl.searchParams.get('page_size'), 25, 200);
    json(res, 200, {
      items: [],
      total: 0,
      page,
      page_size: pageSize,
      has_more: false,
    });
    return true;
  }

  return false;
}

