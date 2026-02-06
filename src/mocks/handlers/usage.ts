import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { usageRecordFixtures, usageKPI } from '../fixtures/usage';

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage', () => {
    const items = p0.usage.length ? p0.usage : usageRecordFixtures;
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
