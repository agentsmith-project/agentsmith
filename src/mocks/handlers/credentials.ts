import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docCredentialFixtures } from '../doc-fixtures/workspace-projects';

const credentials = DOC_FIXTURES_ENABLED ? [...docCredentialFixtures] : [...(p0.credentials ?? [])];

export const credentialHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/credentials', () =>
    HttpResponse.json({ items: credentials }),
  ),
  http.post('/api/v1/workspaces/:ws/projects/:prj/credentials', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name : 'New Credential';
    const type = typeof body.type === 'string' ? body.type : 'api_key';
    const created = {
      id: `cred_${Date.now()}`,
      project_id: 'proj_001',
      name,
      type,
      fingerprint: `sk-...${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
    };
    credentials.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/credentials/:id/rotate', ({ params }) => {
    const cred = credentials.find((c) => c.id === params.id);
    if (!cred) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const rotated = { ...cred, last_rotated_at: new Date().toISOString() };
    return HttpResponse.json(rotated);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/credentials/:id', ({ params }) => {
    const idx = credentials.findIndex((c) => c.id === params.id);
    if (idx >= 0) credentials.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
];
