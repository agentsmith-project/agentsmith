import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const auditHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/audit', () =>
    HttpResponse.json({
      items: p0.audit,
      total: p0.audit.length,
      page: 1,
      page_size: 25,
      has_more: false,
    }),
  ),
];
