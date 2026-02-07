import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

const sources = [...(p0.sources ?? [])];
const sourceLibraries = [
  {
    id: 'lib_shared_default',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Shared Docs',
    description: 'Default shared library',
    visibility: 'shared' as const,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_policy_rules',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Policy Rules',
    description: 'Shared policy and governance references',
    visibility: 'shared' as const,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-02T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_product_specs',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Product Specs',
    description: 'Shared product and API specifications',
    visibility: 'shared' as const,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-03T00:00:00Z').toISOString(),
  },
];

export const sourceHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/sources', ({ params }) => {
    const projectId = String(params.prj ?? '');
    return HttpResponse.json({ items: sources.filter((item) => item.project_id === projectId) });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/source-libraries', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const workspaceId = String(params.ws ?? '');
    return HttpResponse.json({
      items: sourceLibraries.filter(
        (item) => item.project_id === projectId && item.workspace_id === workspaceId
      ),
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/source-libraries', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      visibility?: 'shared';
    };
    if (!body.name) {
      return HttpResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const created = {
      id: `lib_${Date.now()}`,
      workspace_id: String(params.ws ?? ''),
      project_id: String(params.prj ?? ''),
      name: body.name,
      description: body.description ?? '',
      visibility: 'shared' as const,
      created_by_user_id: 'user_001',
      created_at: now,
      updated_at: now,
    };
    sourceLibraries.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/source-libraries/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    const index = sourceLibraries.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    }
    sourceLibraries[index] = {
      ...sourceLibraries[index],
      ...body,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(sourceLibraries[index]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/source-libraries/:id', ({ params }) => {
    const index = sourceLibraries.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    }
    sourceLibraries.splice(index, 1);
    return HttpResponse.json(null, { status: 204 });
  }),
];
