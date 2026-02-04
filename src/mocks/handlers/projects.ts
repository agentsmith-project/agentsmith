import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', () => HttpResponse.json({ items: p0.projects })),
  http.get('/api/v1/workspaces/:ws/projects/:prj', () => HttpResponse.json(p0.project_detail)),
  http.get('/api/v1/workspaces/:ws/projects/:prj/join-requests', () => HttpResponse.json({ items: p0.join_requests })),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/approve', () => HttpResponse.json({ status: 'approved' })),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/reject', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return HttpResponse.json({ status: 'rejected', reject_reason: body?.reason ?? '' });
  }),
];
