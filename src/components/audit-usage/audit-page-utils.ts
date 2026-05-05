import type { AuditEvent, AuditListParams } from '@/lib/api/types';

import type { AuditOverviewSummary, AuditTraceLookup } from './audit-page-types';
import { isConfigurationChangeAction } from './audit-event-presenter';

export function getDefaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

export function asValidIsoTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export function asPositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function metadataContainsString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected;
  if (Array.isArray(value)) return value.some((item) => metadataContainsString(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => metadataContainsString(item, expected));
  }
  return false;
}

export function buildAuditOverviewSummary(events: AuditEvent[]): AuditOverviewSummary {
  const affectedResources = new Set<string>();
  let changeCount = 0;
  let anomalyCount = 0;

  for (const event of events) {
    if (event.resource_id || event.resource_type) {
      affectedResources.add(event.resource_id ?? `${event.resource_type}:unknown`);
    }
    if (isConfigurationChangeAction(event.action)) {
      changeCount += 1;
    }
    if (event.result === 'error') {
      anomalyCount += 1;
    }
  }

  return {
    eventCount: events.length,
    changeCount,
    anomalyCount,
    affectedResourceCount: affectedResources.size,
  };
}

export function matchesAuditInvestigationFilters(event: AuditEvent, filters: AuditListParams): boolean {
  const metadata = event.metadata_json ?? {};
  const decisionId = typeof metadata.decision_id === 'string' ? metadata.decision_id : undefined;
  const traceCandidates = [
    event.trace_ref,
    event.trace_incident_id,
    event.trace_escalation_id,
    event.trace_run_id,
    typeof metadata.trace_ref === 'string' ? metadata.trace_ref : undefined,
    typeof metadata.trace_incident_id === 'string' ? metadata.trace_incident_id : undefined,
    typeof metadata.trace_escalation_id === 'string' ? metadata.trace_escalation_id : undefined,
    typeof metadata.trace_run_id === 'string' ? metadata.trace_run_id : undefined,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  if (filters.request_id && event.request_id !== filters.request_id) return false;
  if (filters.decision_id && event.decision_id !== filters.decision_id && decisionId !== filters.decision_id) return false;
  if (filters.trace_ref && !traceCandidates.includes(filters.trace_ref) && !metadataContainsString(metadata, filters.trace_ref)) return false;
  if (filters.trace_incident_id && event.trace_incident_id !== filters.trace_incident_id && !metadataContainsString(metadata, filters.trace_incident_id)) return false;
  if (filters.trace_escalation_id && event.trace_escalation_id !== filters.trace_escalation_id && !metadataContainsString(metadata, filters.trace_escalation_id)) return false;
  if (filters.trace_run_id && event.trace_run_id !== filters.trace_run_id && !metadataContainsString(metadata, filters.trace_run_id)) return false;
  return true;
}

export function findTraceMatchedAuditEvent(events: AuditEvent[], trace: AuditTraceLookup): AuditEvent | null {
  if (!trace.ref && !trace.incidentId && !trace.escalationId && !trace.runId) return null;
  const candidates = [trace.ref, trace.incidentId, trace.escalationId, trace.runId].filter(
    (value): value is string => !!value && value.trim().length > 0,
  );

  for (const event of events) {
    const metadata = event.metadata_json ?? {};
    const normalizedRefs = [
      event.trace_ref,
      event.trace_incident_id,
      event.trace_escalation_id,
      event.trace_run_id,
    ].filter((value): value is string => !!value && value.trim().length > 0);

    const matched = candidates.some((candidate) =>
      event.id === candidate
      || event.request_id === candidate
      || event.resource_id === candidate
      || normalizedRefs.includes(candidate)
      || metadataContainsString(metadata, candidate),
    );
    if (matched) return event;
  }
  return null;
}

export function buildAuditFiltersFromSearchParams(
  searchParams: URLSearchParams,
  defaultEndUserId?: string,
): AuditListParams {
  const defaults = getDefaultTimeRange();
  const actorTypeRaw = searchParams.get('actor_type');
  const resultRaw = searchParams.get('result');
  const sortByRaw = searchParams.get('sort_by');
  const sortOrderRaw = searchParams.get('sort_order');
  const actorType =
    actorTypeRaw === 'user' || actorTypeRaw === 'runner' || actorTypeRaw === 'plugin'
      ? actorTypeRaw
      : undefined;
  const result = resultRaw === 'ok' || resultRaw === 'error' ? resultRaw : undefined;
  const sortBy = sortByRaw === 'timestamp' ? sortByRaw : 'timestamp';
  const sortOrder = sortOrderRaw === 'asc' || sortOrderRaw === 'desc' ? sortOrderRaw : 'desc';
  const requestId = searchParams.get('request_id') ?? undefined;
  const decisionId = searchParams.get('decision_id') ?? undefined;
  const traceRef = searchParams.get('trace_ref') ?? undefined;
  const traceIncidentId = searchParams.get('trace_incident_id') ?? undefined;
  const traceEscalationId = searchParams.get('trace_escalation_id') ?? undefined;
  const traceRunId = searchParams.get('trace_run_id') ?? undefined;
  const investigationMode = !!(
    requestId
    || decisionId
    || traceRef
    || traceIncidentId
    || traceEscalationId
    || traceRunId
  );

  return {
    start_time: asValidIsoTimestamp(searchParams.get('start_time')) ?? defaults.start_time,
    end_time: asValidIsoTimestamp(searchParams.get('end_time')) ?? defaults.end_time,
    action: searchParams.get('action') ?? undefined,
    actor_type: actorType,
    actor_id: searchParams.get('actor_id') ?? undefined,
    end_user_id: searchParams.get('end_user_id') ?? defaultEndUserId,
    resource_type: searchParams.get('resource_type') ?? undefined,
    resource_id: searchParams.get('resource_id') ?? undefined,
    request_id: requestId,
    decision_id: decisionId,
    trace_ref: traceRef,
    trace_incident_id: traceIncidentId,
    trace_escalation_id: traceEscalationId,
    trace_run_id: traceRunId,
    result,
    page: asPositiveInt(searchParams.get('page')) ?? 1,
    page_size: asPositiveInt(searchParams.get('page_size')) ?? (investigationMode ? 200 : 25),
    sort_by: sortBy,
    sort_order: sortOrder,
  };
}
