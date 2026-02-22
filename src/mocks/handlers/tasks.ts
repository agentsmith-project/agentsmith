import { http, HttpResponse } from 'msw';
import {
  taskFixtures,
  taskMessageFixtures,
  artifactFixtures,
  sourceFileFixtures,
  taskTraceFixtures,
} from '../fixtures/notebook';

const tasks = [...taskFixtures];
const taskMessages = [...taskMessageFixtures];
const artifacts = [...artifactFixtures];
const taskTraces = [...taskTraceFixtures];

export const taskHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('page_size') ?? 20);
    const start = (page - 1) * pageSize;
    const items = tasks.slice(start, start + pageSize);
    return HttpResponse.json({
      items,
      total: tasks.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < tasks.length,
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id', ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    return HttpResponse.json(task);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/tasks', async ({ request, params }) => {
    const body: any = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const newTask = {
      id: `task_${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: params.ws as string,
      project_id: params.prj as string,
      owner_user_id: 'user_001',
      title: body?.title ?? 'New Task',
      agent_id: body?.agent_id ?? 'agent_001',
      agent_name: body?.agent_name ?? 'AgentA',
      status: body?.status ?? 'active',
      attached_source_ids: body?.source_ids ?? [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    tasks.unshift(newTask);
    return HttpResponse.json(newTask);
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/tasks/:id', async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const body: any = await request.json().catch(() => ({}));
    Object.assign(task, body, { updated_at: new Date().toISOString() });
    return HttpResponse.json(task);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/tasks/:id', ({ params }) => {
    const taskId = params.id as string;
    const index = tasks.findIndex((r) => r.id === taskId);
    if (index >= 0) {
      tasks.splice(index, 1);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/sources', async ({ request, params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const body: any = await request.json().catch(() => ({}));
    const sourceIds = Array.isArray(body?.source_ids) ? body.source_ids : [];
    task.attached_source_ids = Array.from(new Set([...(task.attached_source_ids ?? []), ...sourceIds]));
    task.updated_at = new Date().toISOString();
    return HttpResponse.json(task);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/sources', ({ params }) => {
    const taskId = params.id as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    const items = sourceFileFixtures.filter((f) => (task.attached_source_ids ?? []).includes(f.id));
    return HttpResponse.json(items);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/sources/:sourceId', ({ params }) => {
    const taskId = params.id as string;
    const sourceId = params.sourceId as string;
    const task = tasks.find((r) => r.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: 'task_not_found' }, { status: 404 });
    }
    task.attached_source_ids = (task.attached_source_ids ?? []).filter((id) => id !== sourceId);
    task.updated_at = new Date().toISOString();
    return HttpResponse.json(task);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/messages', ({ params }) => {
    const taskId = params.id as string;
    const items = taskMessages.filter((m) => m.task_id === taskId);
    return HttpResponse.json(items);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/traces', ({ request, params }) => {
    const taskId = params.id as string;
    const url = new URL(request.url);
    const messageId = url.searchParams.get('message_id');
    const runId = url.searchParams.get('run_id');
    const afterId = url.searchParams.get('after_id');
    const beforeId = url.searchParams.get('before_id');
    const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('page_size') ?? 100)));

    let items = taskTraces
      .filter((t) => t.task_id === taskId)
      .sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
    if (messageId) items = items.filter((t) => t.message_id === messageId);
    if (runId) items = items.filter((t) => t.run_id === runId);

    if (afterId) {
      const idx = items.findIndex((t) => t.id === afterId);
      if (idx >= 0) items = items.slice(idx + 1);
      const sliced = items.slice(0, pageSize);
      return HttpResponse.json({
        items: sliced,
        total: sliced.length,
        has_more: items.length > sliced.length,
        next_after_id: null,
      });
    }

    if (beforeId) {
      const idx = items.findIndex((t) => t.id === beforeId);
      const older = idx >= 0 ? items.slice(0, idx) : items;
      const start = Math.max(0, older.length - pageSize);
      const sliced = older.slice(start);
      return HttpResponse.json({
        items: sliced,
        total: sliced.length,
        has_more: start > 0,
        next_after_id: start > 0 ? sliced[0]?.id ?? null : null,
      });
    }

    // Default behavior: return latest page to exercise UI "load earlier logs".
    const start = Math.max(0, items.length - Math.min(pageSize, 3));
    const sliced = items.slice(start);
    return HttpResponse.json({
      items: sliced,
      total: sliced.length,
      has_more: start > 0,
      next_after_id: start > 0 ? sliced[0]?.id ?? null : null,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/messages', async ({ request, params }) => {
    const taskId = params.id as string;
    const body: any = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const message = {
      id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      role: body?.role ?? 'user',
      content: body?.content ?? '',
      created_at: now,
      referenced_source_ids: body?.referenced_source_ids ?? [],
    };
    taskMessages.push(message);
    return HttpResponse.json(message);
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/artifacts', ({ params }) => {
    const taskId = params.id as string;
    const items = artifacts.filter((a) => a.task_id === taskId);
    return HttpResponse.json(items);
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/artifacts/:artifactId/save', async ({ params }) => {
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
  http.get('/api/v1/workspaces/:ws/projects/:prj/tasks/:id/artifacts/:artifactId/download', () => {
    return new HttpResponse('Mock artifact content', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }),
];
