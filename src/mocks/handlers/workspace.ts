import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { workspaceFixtures } from '../fixtures/workspaces';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import { CURRENT_USER_ID } from '../fixtures/projects';

const workspaceItems = (() => {
  const fromP0 = p0.workspaces ?? [];
  if (!fromP0.length) {
    return workspaceFixtures;
  }
  const hasDefault = fromP0.some((workspace) => workspace.id === 'ws_default');
  return hasDefault ? fromP0 : [...workspaceFixtures, ...fromP0];
})();

const workspaceMembers = (() => {
  const fromP0 = (p0.workspace_members ?? []).map((member) => {
    const userId = String(member.id ?? '');
    const role = member.role === 'owner' || member.role === 'admin' || member.role === 'developer'
      ? member.role
      : 'user';
    return {
      id: `wm_${userId}`,
      user_id: userId,
      name: member.name ?? member.email ?? userId,
      email: member.email ?? `${userId}@example.com`,
      role,
      governance_group: role === 'owner' || role === 'admin' ? 'wheel' : 'user',
      permissions: [...ROLE_TEMPLATES[role]],
      status: 'active' as const,
      joined_at: '2026-01-01T00:00:00Z',
    };
  });

  if (!fromP0.some((member) => member.user_id === CURRENT_USER_ID)) {
    fromP0.push({
      id: `wm_${CURRENT_USER_ID}`,
      user_id: CURRENT_USER_ID,
      name: p0.auth.user.name,
      email: p0.auth.user.email,
      role: 'owner',
      governance_group: 'wheel',
      permissions: [...ROLE_TEMPLATES.owner],
      status: 'active' as const,
      joined_at: '2026-01-01T00:00:00Z',
    });
  }

  return fromP0;
})();

export const workspaceHandlers = [
  http.get('/api/v1/workspaces', () => HttpResponse.json({ items: workspaceItems })),
  http.get('/api/v1/workspaces/:ws', ({ params }) => {
    const workspaceId = String(params.ws ?? '');
    const workspace = workspaceItems.find((item) => item.id === workspaceId);
    if (!workspace) {
      return HttpResponse.json({ error: 'workspace_not_found' }, { status: 404 });
    }
    return HttpResponse.json(workspace);
  }),
  http.get('/api/v1/workspaces/:ws/members', () =>
    HttpResponse.json({ items: workspaceMembers, total: workspaceMembers.length })),
  http.patch('/api/v1/workspaces/:ws/members/:memberId/governance', async ({ params, request }) => {
    const memberId = String(params.memberId ?? '');
    const body = (await request.json().catch(() => ({}))) as { governance_group?: 'wheel' | 'user' };
    const target = workspaceMembers.find((member) => member.id === memberId || member.user_id === memberId);
    if (!target) {
      return HttpResponse.json({ error: 'workspace_member_not_found' }, { status: 404 });
    }
    if (body.governance_group !== 'wheel' && body.governance_group !== 'user') {
      return HttpResponse.json({ error: 'invalid_governance_group' }, { status: 400 });
    }
    target.governance_group = body.governance_group;
    return HttpResponse.json(target);
  }),
];
