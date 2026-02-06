import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { projectFixtures, projectMembershipFixtures, CURRENT_USER_ID } from '../fixtures/projects';
import type { Project } from '@/lib/api/types';

const projects = [...(p0.projects.length ? p0.projects : projectFixtures)];

export const projectHandlers = [
  http.get('/api/v1/workspaces/:ws/projects', () =>
    HttpResponse.json({ items: projects }),
  ),
  http.get('/api/v1/workspaces/:ws/projects/:prj', ({ params }) => {
    const projectId = params.prj as string;
    const project = projects.find((p) => p.id === projectId) || projectFixtures.find((p) => p.id === projectId);
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
  http.post('/api/v1/workspaces/:ws/projects', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const visibility: 'public' | 'private' =
      body.visibility === 'public' ? 'public' : 'private';
    const joinPolicy: 'open' | 'approval_required' =
      body.join_policy === 'open' ? 'open' : 'approval_required';
    const created: Project = {
      id: `proj_${Date.now()}`,
      workspace_id: params.ws as string,
      name: (body.name as string) ?? 'New Project',
      description: (body.description as string) ?? '',
      visibility,
      join_policy: joinPolicy,
      owner_id: 'user_001',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    projects.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = projects.findIndex((p) => p.id === params.prj);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    projects[idx] = { ...projects[idx], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(projects[idx]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj', ({ params }) => {
    const idx = projects.findIndex((p) => p.id === params.prj);
    if (idx >= 0) projects.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/join-requests', () =>
    HttpResponse.json({ items: p0.join_requests }),
  ),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/approve', () =>
    HttpResponse.json({ status: 'approved' }),
  ),
  http.post('/api/v1/workspaces/:ws/projects/:prj/join-requests/:id/reject', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return HttpResponse.json({ status: 'rejected', reject_reason: (body?.reason as string) ?? '' });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/invites', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const invite = {
      id: `inv_${Date.now()}`,
      email: (body.email as string) ?? '',
      role_template: (body.role_template as string) ?? 'user',
      invite_url: `/join?token=mock_token_${Date.now()}`,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    return HttpResponse.json(invite, { status: 201 });
  }),
];
