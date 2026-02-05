import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { workspaceFixtures } from '../fixtures/workspaces';

const workspaceItems = (() => {
  const fromP0 = p0.workspaces ?? [];
  if (!fromP0.length) {
    return workspaceFixtures;
  }
  const hasDefault = fromP0.some((workspace) => workspace.id === 'ws_default');
  return hasDefault ? fromP0 : [...workspaceFixtures, ...fromP0];
})();

export const workspaceHandlers = [
  http.get('/api/v1/workspaces', () => HttpResponse.json({ items: workspaceItems })),
  http.get('/api/v1/workspaces/:ws/members', () => HttpResponse.json({ items: p0.workspace_members })),
];
