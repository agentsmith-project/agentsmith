import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docAuditEvents } from '../doc-fixtures/audit-usage';

type MockAuditEvent = (typeof p0.audit)[number];
const auditEvents = DOC_FIXTURES_ENABLED ? (docAuditEvents as MockAuditEvent[]) : (p0.audit as MockAuditEvent[]);

function asPositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const auditHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/audit', ({ request }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const actorType = url.searchParams.get('actor_type');
    const actorId = url.searchParams.get('actor_id');
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const result = url.searchParams.get('result');
    const page = asPositiveInt(url.searchParams.get('page'), 1);
    const pageSize = asPositiveInt(url.searchParams.get('page_size'), 25);

    const filtered = auditEvents.filter((event) => {
      if (action && event.action !== action) return false;
      if (actorType && event.actor_type !== actorType) return false;
      if (actorId && event.actor_id !== actorId) return false;
      if (resourceType && event.resource_type !== resourceType) return false;
      if (resourceId && event.resource_id !== resourceId) return false;
      if (result && event.result !== result) return false;
      return true;
    });

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return HttpResponse.json({
      items,
      total: filtered.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < filtered.length,
    });
  }),
];
