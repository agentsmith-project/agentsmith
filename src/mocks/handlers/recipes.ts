import { http, HttpResponse } from 'msw';
import {
  recipeFixtures,
  recipeMessageFixtures,
  artifactFixtures,
  sourceFileFixtures,
} from '../fixtures/studio';

const recipes = [...recipeFixtures];
const recipeMessages = [...recipeMessageFixtures];
const artifacts = [...artifactFixtures];

export const recipeHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/recipes', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('page_size') ?? 20);
    const start = (page - 1) * pageSize;
    const items = recipes.slice(start, start + pageSize);
    return HttpResponse.json({
      items,
      total: recipes.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < recipes.length,
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/recipes/:id', ({ params }) => {
    const recipeId = params.id as string;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      return HttpResponse.json({ error: 'recipe_not_found' }, { status: 404 });
    }
    return HttpResponse.json(recipe);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/recipes', async ({ request, params }) => {
    const body: any = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const newRecipe = {
      id: `recipe_${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: params.ws as string,
      project_id: params.prj as string,
      owner_user_id: 'user_001',
      title: body?.title ?? 'New Recipe',
      agent_id: body?.agent_id ?? 'agent_001',
      agent_name: body?.agent_name ?? 'AgentA',
      status: body?.status ?? 'active',
      attached_source_ids: body?.source_ids ?? [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    recipes.unshift(newRecipe);
    return HttpResponse.json(newRecipe);
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/recipes/:id', async ({ request, params }) => {
    const recipeId = params.id as string;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      return HttpResponse.json({ error: 'recipe_not_found' }, { status: 404 });
    }
    const body: any = await request.json().catch(() => ({}));
    Object.assign(recipe, body, { updated_at: new Date().toISOString() });
    return HttpResponse.json(recipe);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/recipes/:id', ({ params }) => {
    const recipeId = params.id as string;
    const index = recipes.findIndex((r) => r.id === recipeId);
    if (index >= 0) {
      recipes.splice(index, 1);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/sources', async ({ request, params }) => {
    const recipeId = params.id as string;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      return HttpResponse.json({ error: 'recipe_not_found' }, { status: 404 });
    }
    const body: any = await request.json().catch(() => ({}));
    const sourceIds = Array.isArray(body?.source_ids) ? body.source_ids : [];
    recipe.attached_source_ids = Array.from(new Set([...(recipe.attached_source_ids ?? []), ...sourceIds]));
    recipe.updated_at = new Date().toISOString();
    return HttpResponse.json(recipe);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/sources/:sourceId', ({ params }) => {
    const recipeId = params.id as string;
    const sourceId = params.sourceId as string;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      return HttpResponse.json({ error: 'recipe_not_found' }, { status: 404 });
    }
    recipe.attached_source_ids = (recipe.attached_source_ids ?? []).filter((id) => id !== sourceId);
    recipe.updated_at = new Date().toISOString();
    return HttpResponse.json(recipe);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/messages', ({ params }) => {
    const recipeId = params.id as string;
    const items = recipeMessages.filter((m) => m.recipe_id === recipeId);
    return HttpResponse.json(items);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/messages', async ({ request, params }) => {
    const recipeId = params.id as string;
    const body: any = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const message = {
      id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      recipe_id: recipeId,
      role: body?.role ?? 'user',
      content: body?.content ?? '',
      created_at: now,
      referenced_source_ids: body?.referenced_source_ids ?? [],
    };
    recipeMessages.push(message);
    return HttpResponse.json(message);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/artifacts', ({ params }) => {
    const recipeId = params.id as string;
    const items = artifacts.filter((a) => a.recipe_id === recipeId);
    return HttpResponse.json(items);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/artifacts/:artifactId/save', async ({ params }) => {
    const artifactId = params.artifactId as string;
    const artifact = artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      return HttpResponse.json({ error: 'artifact_not_found' }, { status: 404 });
    }
    const file = sourceFileFixtures[0];
    return HttpResponse.json({
      id: file.id,
      project_id: file.project_id,
      file_name: file.file_name,
      file_type: file.file_type,
      file_size: file.file_size,
      status: 'ready',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/recipes/:id/artifacts/:artifactId/download', () => {
    return new HttpResponse('Mock artifact content', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),
];
