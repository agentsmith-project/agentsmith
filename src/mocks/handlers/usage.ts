import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { usageRecordFixtures, usageKPI } from '../fixtures/usage';

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', () => {
    const usageItems = p0.usage as Array<{ resource_type?: string | null }> | undefined;
    const hasStructuredUsage = Array.isArray(usageItems) && usageItems.some((item) => Boolean(item?.resource_type));
    const items = hasStructuredUsage ? p0.usage : usageRecordFixtures;
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      page_size: 25,
      has_more: false,
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/kpi', () => HttpResponse.json(usageKPI)),
];
