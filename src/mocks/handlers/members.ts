import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { memberFixtures, memberProjectMembershipFixtures } from '../fixtures/members';

const members = p0.members.length ? p0.members : memberFixtures.map((m, i) => ({
  ...m,
  role: memberProjectMembershipFixtures[i]?.role ?? 'member',
}));

export const memberHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/members', () =>
    HttpResponse.json({ items: members }),
  ),
  http.post('/api/v1/workspaces/:ws/projects/:prj/members', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : 'new@example.com';
    const role = typeof body.role === 'string' ? body.role : 'member';
    const invited = {
      id: `u_${Date.now()}`,
      email,
      name: email.split('@')[0] ?? 'New User',
      role,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    members.push(invited);
    return HttpResponse.json(invited, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/members/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const member = members.find((m) => m.id === params.id);
    if (!member) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json({ ...member, ...body });
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/members/:id', ({ params }) => {
    const idx = members.findIndex((m) => m.id === params.id);
    if (idx >= 0) members.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/members/:id/permissions', ({ params }) => {
    const membership = memberProjectMembershipFixtures.find(
      (m) => m.user_id === params.id,
    );
    return HttpResponse.json({ permissions: membership?.permissions ?? ['project:read'] });
  }),
];
