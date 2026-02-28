import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import {
  acknowledgeUsageReportDelivery,
  aggregateUsageRecords,
  createUsageReportSchedule,
  deleteUsageReportSchedule,
  exportUsageData,
  getQuotaSummary,
  getUsageReportEvidence,
  getRuntimeObservability,
  getUsageOperationsSummary,
  getUsageKpi,
  getUsageTimeseries,
  listAuditEvents,
  listUsageReportSchedules,
  listUsageFactRecords,
  retryUsageReportDelivery,
  runDueUsageReportSchedules,
  runUsageReportScheduleNow,
  testUsageReportScheduleDelivery,
  updateUsageReportSchedule,
} from './audit-usage-store.js';
import { createUsageReportDeliveryDispatcher } from './usage-report-delivery.js';

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

function parseRuntimeErrorClass(value: string | null): 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null {
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
  const deliveryDispatch = createUsageReportDeliveryDispatcher();

  if (route.kind === 'usageReportSchedules' && method === 'GET') {
    const payload = await listUsageReportSchedules(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportSchedules' && method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const cadence = body.cadence === 'weekly' || body.cadence === 'monthly' ? body.cadence : 'daily';
    const format = body.format === 'json' ? 'json' : 'csv';
    const timeWindow = body.time_window === 'last_24h' || body.time_window === 'last_30d' ? body.time_window : 'last_7d';
    const status = body.status === 'paused' ? 'paused' : 'active';
    const deliveryChannel = body.delivery_channel === 'in_app' ? 'in_app' : 'in_app';
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : null;
    if (!name) {
      return badRequest(json, res, 'name is required');
    }
    const payload = await createUsageReportSchedule(deps.docStore, {
      workspace_id: route.workspaceId,
      project_id: route.projectId,
      name,
      cadence,
      status,
      format,
      time_window: timeWindow,
      delivery_channel: deliveryChannel,
      filters: typeof body.filters === 'object' && body.filters ? body.filters as Record<string, unknown> : undefined,
      release_evidence_required: body.release_evidence_required !== false,
      empty_result_policy: body.empty_result_policy === 'fail' ? 'fail' : 'deliver',
    });
    json(res, 201, payload);
    return true;
  }

  if (route.kind === 'usageReportSchedulesRunDue' && method === 'POST') {
    const payload = await runDueUsageReportSchedules(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportEvidence' && method === 'GET') {
    const payload = await getUsageReportEvidence(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      runnerHealth: deps.usageReportRunner?.getStatus(),
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportScheduleItem' && method === 'PATCH') {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const payload = await updateUsageReportSchedule(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
      patch: {
        name: typeof body.name === 'string' ? body.name.trim() : undefined,
        cadence: body.cadence === 'daily' || body.cadence === 'weekly' || body.cadence === 'monthly' ? body.cadence : undefined,
        status: body.status === 'active' || body.status === 'paused' ? body.status : undefined,
        format: body.format === 'csv' || body.format === 'json' ? body.format : undefined,
        time_window: body.time_window === 'last_24h' || body.time_window === 'last_7d' || body.time_window === 'last_30d'
          ? body.time_window
          : undefined,
        delivery_channel: body.delivery_channel === 'in_app' ? 'in_app' : undefined,
        filters: typeof body.filters === 'object' && body.filters ? body.filters as Record<string, unknown> : undefined,
        release_evidence_required: typeof body.release_evidence_required === 'boolean' ? body.release_evidence_required : undefined,
        empty_result_policy: body.empty_result_policy === 'deliver' || body.empty_result_policy === 'fail' ? body.empty_result_policy : undefined,
      },
    });
    if (!payload) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_schedule_not_found' });
      return true;
    }
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportScheduleItem' && method === 'DELETE') {
    const deleted = await deleteUsageReportSchedule(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
    });
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_schedule_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'usageReportScheduleTestDelivery' && method === 'POST') {
    const payload = await testUsageReportScheduleDelivery(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
      deliveryDispatch,
      recipientUserId: user?.id,
    });
    if (!payload) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_schedule_not_found' });
      return true;
    }
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportScheduleRunNow' && method === 'POST') {
    const payload = await runUsageReportScheduleNow(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
      deliveryDispatch,
      recipientUserId: user?.id,
    });
    if (!payload) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_schedule_not_found' });
      return true;
    }
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportScheduleDeliveryRetry' && method === 'POST') {
    const payload = await retryUsageReportDelivery(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
      deliveryId: route.deliveryId,
      deliveryDispatch,
      recipientUserId: user?.id,
    });
    if (!payload) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_delivery_not_found' });
      return true;
    }
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageReportScheduleDeliveryAcknowledge' && method === 'POST') {
    if (!user) {
      json(res, 401, { error_code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' });
      return true;
    }
    const payload = await acknowledgeUsageReportDelivery(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      scheduleId: route.scheduleId,
      deliveryId: route.deliveryId,
      acknowledgedBy: user.id,
    });
    if (!payload) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'usage_report_delivery_not_found' });
      return true;
    }
    json(res, 200, payload);
    return true;
  }

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

  if (route.kind === 'usageExport' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const format = requestUrl.searchParams.get('format') === 'json' ? 'json' : 'csv';
    const result = await exportUsageData(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      startTime: range.start.toISOString(),
      endTime: range.end.toISOString(),
      format,
      resourceType: requestUrl.searchParams.get('resource_type'),
      resourceId: requestUrl.searchParams.get('resource_id'),
      endUserId: requestUrl.searchParams.get('end_user_id'),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseRuntimeErrorClass(requestUrl.searchParams.get('error_class')),
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename.replace(/"/g, '')}"`);
    res.end(result.body);
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
    const provider = requestUrl.searchParams.get('provider');
    const model = requestUrl.searchParams.get('model');
    const result = requestUrl.searchParams.get('result') === 'error'
      ? 'error'
      : requestUrl.searchParams.get('result') === 'ok'
        ? 'ok'
        : null;
    const errorClass = parseRuntimeErrorClass(requestUrl.searchParams.get('error_class'));
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
      provider,
      model,
      result,
      errorClass,
      groupBy,
      sortBy,
      sortOrder,
      page,
      pageSize,
    });
    json(res, 200, payload);
    return true;
  }

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
      endUserId: requestUrl.searchParams.get('end_user_id'),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseRuntimeErrorClass(requestUrl.searchParams.get('error_class')),
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

  if (route.kind === 'quotaSummary' && method === 'GET') {
    const payload = await getQuotaSummary(deps.docStore, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, payload);
    return true;
  }

  if (route.kind === 'usageRuntimeObservability' && method === 'GET') {
    const range = requireTimeRange(requestUrl, json, res);
    if (range === true) return true;
    const payload = await getRuntimeObservability(deps.docStore, {
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
      errorClass: parseRuntimeErrorClass(requestUrl.searchParams.get('error_class')),
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
      endUserId: requestUrl.searchParams.get('end_user_id'),
      provider: requestUrl.searchParams.get('provider'),
      model: requestUrl.searchParams.get('model'),
      result: requestUrl.searchParams.get('result') === 'error'
        ? 'error'
        : requestUrl.searchParams.get('result') === 'ok'
          ? 'ok'
          : null,
      errorClass: parseRuntimeErrorClass(requestUrl.searchParams.get('error_class')),
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
