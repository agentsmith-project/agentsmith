import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { projectFixtures, projectMembershipFixtures, CURRENT_USER_ID } from '../fixtures/projects';

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', () => HttpResponse.json({ items: p0.projects.length ? p0.projects : projectFixtures })),
  http.get('/api/v1/workspaces/:ws/projects/:prj', ({ params }) => {
    const projectId = params.prj as string;
    const project = projectFixtures.find((p) => p.id === projectId);
    const membership = projectMembershipFixtures.find(
      (m) => m.project_id === projectId && m.user_id === CURRENT_USER_ID,
    );
    if (!project) {
      return HttpResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    return HttpResponse.json({
      ...project,
      role: membership?.role,
      permissions: membership?.permissions ?? [],
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/join-requests', () => HttpResponse.json({ items: p0.join_requests })),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/approve', () => HttpResponse.json({ status: 'approved' })),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/reject', async ({ request }) => {
    const body: any = await request.json().catch(() => ({}));
    return HttpResponse.json({ status: 'rejected', reject_reason: body?.reason ?? '' });
  }),
];
