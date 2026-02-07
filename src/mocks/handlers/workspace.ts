import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { workspaceFixtures } from '../fixtures/workspaces';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

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

  if (!fromP0.some((member) => member.user_id === 'user_001')) {
    fromP0.push({
      id: 'wm_user_001',
      user_id: 'user_001',
      name: 'Test User',
      email: 'test@example.com',
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
  http.get('/api/v1/workspaces/:ws/members', () =>
    HttpResponse.json({ items: workspaceMembers, total: workspaceMembers.length })),
];
