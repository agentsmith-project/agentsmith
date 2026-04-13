import { http, HttpResponse } from 'msw';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docProjectMembershipFixtures } from '../doc-fixtures/workspace-projects';
import { memberProjectMembershipFixtures } from '../fixtures/members';
import { readMockAuthActorFromRequest } from '../utils/mock-auth-token';

type ContextScope = 'member' | 'task' | 'project_member' | 'project' | 'workspace';
type ContextContentType = 'text' | 'json' | 'markdown' | 'yaml';
type ProjectMembershipStatus = 'active' | 'pending' | 'suspended' | 'removed';

type ContextEntry = {
  id: string;
  scope: ContextScope;
  key: string;
  content: string;
  content_type: ContextContentType;
  user_id?: string | null;
  task_id?: string | null;
  project_id?: string | null;
  workspace_id?: string | null;
  read_only: boolean;
  updated_at: string;
  updated_by: string;
};

type ProjectMembershipRecord = {
  project_id: string;
  user_id: string;
  status: ProjectMembershipStatus;
};

function nowIso(): string {
  return new Date().toISOString();
}

function getRequestUserId(request: Request): string {
  return readMockAuthActorFromRequest(request).userId;
}

function buildContextId(entry: Pick<ContextEntry, 'scope' | 'key' | 'user_id' | 'workspace_id' | 'project_id' | 'task_id'>): string {
  return [
    'ctx',
    entry.scope,
    entry.key,
    entry.user_id ?? '',
    entry.workspace_id ?? '',
    entry.project_id ?? '',
    entry.task_id ?? '',
  ].join('__');
}

const projectMembershipSources: ReadonlyArray<ReadonlyArray<ProjectMembershipRecord>> = DOC_FIXTURES_ENABLED
  ? [docProjectMembershipFixtures as ReadonlyArray<ProjectMembershipRecord>, memberProjectMembershipFixtures as ReadonlyArray<ProjectMembershipRecord>]
  : [memberProjectMembershipFixtures as ReadonlyArray<ProjectMembershipRecord>];

function getProjectMembership(projectId: string, userId: string): ProjectMembershipRecord | null {
  for (const source of projectMembershipSources) {
    const membership = source.find((item) => item.project_id === projectId && item.user_id === userId);
    if (membership) return membership;
  }
  return null;
}

function isActiveProjectMember(projectId: string, userId: string): boolean {
  return getProjectMembership(projectId, userId)?.status === 'active';
}

const contextEntries: ContextEntry[] = [
  {
    id: buildContextId({
      scope: 'workspace',
      key: 'shared.runbook',
      workspace_id: 'ws_default',
      project_id: null,
      task_id: null,
      user_id: null,
    }),
    scope: 'workspace',
    key: 'shared.runbook',
    content: '# Workspace Guide\nDefault workspace guidance.',
    content_type: 'markdown',
    workspace_id: 'ws_default',
    project_id: null,
    task_id: null,
    user_id: null,
    read_only: false,
    updated_at: nowIso(),
    updated_by: 'user_002',
  },
  {
    id: buildContextId({
      scope: 'project',
      key: 'shared.schema',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
      task_id: null,
      user_id: null,
    }),
    scope: 'project',
    key: 'shared.schema',
    content: 'orders(id, total_amount, created_at)',
    content_type: 'text',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    task_id: null,
    user_id: null,
    read_only: false,
    updated_at: nowIso(),
    updated_by: 'user_001',
  },
];

function isContextScope(value: string | null): value is ContextScope {
  return value === 'member'
    || value === 'task'
    || value === 'project_member'
    || value === 'project'
    || value === 'workspace';
}

function filterEntries(params: URLSearchParams, request: Request): ContextEntry[] {
  const scope = params.get('scope');
  const workspaceId = params.get('workspace_id');
  const projectId = params.get('project_id');
  const taskId = params.get('task_id');
  const userId = getRequestUserId(request);
  return contextEntries.filter((entry) => {
    if (scope && entry.scope !== scope) return false;
    if (workspaceId && entry.workspace_id !== workspaceId) return false;
    if (projectId && entry.project_id !== projectId) return false;
    if (taskId && entry.task_id !== taskId) return false;
    if ((entry.scope === 'member' || entry.scope === 'task') && entry.user_id !== userId) return false;
    if (entry.scope === 'project_member') {
      if (entry.user_id !== userId) return false;
      if (!entry.workspace_id || !entry.project_id) return false;
      if (!isActiveProjectMember(entry.project_id, userId)) return false;
    }
    return true;
  });
}

export const contextHandlers = [
  http.get(/\/api\/v1\/context\/list$/, ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    if (!isContextScope(scope)) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_scope_required' }, { status: 400 });
    }
    if (scope === 'project_member' && (!url.searchParams.get('workspace_id') || !url.searchParams.get('project_id'))) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_project_member_scope_requires_ids' }, { status: 400 });
    }
    if (scope === 'project_member') {
      const workspaceId = url.searchParams.get('workspace_id') ?? '';
      const projectId = url.searchParams.get('project_id') ?? '';
      const userId = getRequestUserId(request);
      if (!isActiveProjectMember(projectId, userId)) {
        return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
      }
      if (!workspaceId) {
        return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_project_member_scope_requires_ids' }, { status: 400 });
      }
    }
    const items = filterEntries(url.searchParams, request).sort((left, right) => left.key.localeCompare(right.key));
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get(/\/api\/v1\/context$/, ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    const key = url.searchParams.get('key');
    if (!isContextScope(scope) || !key) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' }, { status: 400 });
    }
    if (scope === 'project_member' && (!url.searchParams.get('workspace_id') || !url.searchParams.get('project_id'))) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_project_member_scope_requires_ids' }, { status: 400 });
    }
    if (scope === 'project_member') {
      const workspaceId = url.searchParams.get('workspace_id') ?? '';
      const projectId = url.searchParams.get('project_id') ?? '';
      const userId = getRequestUserId(request);
      if (!workspaceId || !projectId || !isActiveProjectMember(projectId, userId)) {
        return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
      }
    }
    const item = filterEntries(url.searchParams, request).find((entry) => entry.key === key);
    if (!item) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
    }
    return HttpResponse.json(item);
  }),

  http.put(/\/api\/v1\/context$/, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as Partial<ContextEntry> | null;
    const scope = typeof body?.scope === 'string' ? body.scope : null;
    if (!body || !isContextScope(scope) || typeof body.key !== 'string') {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' }, { status: 400 });
    }
    const userId = getRequestUserId(request);
    if (scope === 'project_member' && (!body.workspace_id || !body.project_id)) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_project_member_scope_requires_ids' }, { status: 400 });
    }
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (scope === 'project_member' && !isActiveProjectMember(projectId, userId)) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
    }
    const next: ContextEntry = {
      id: buildContextId({
        scope,
        key: body.key,
        user_id: scope === 'member' || scope === 'task' || scope === 'project_member' ? userId : null,
        workspace_id: body.workspace_id ?? null,
        project_id: projectId || null,
        task_id: body.task_id ?? null,
      }),
      scope,
      key: body.key,
      content: typeof body.content === 'string' ? body.content : '',
      content_type: body.content_type ?? 'text',
      user_id: scope === 'member' || scope === 'task' || scope === 'project_member' ? userId : null,
      workspace_id: body.workspace_id ?? null,
      project_id: projectId || null,
      task_id: body.task_id ?? null,
      read_only: false,
      updated_at: nowIso(),
      updated_by: userId,
    };
    const existingIndex = contextEntries.findIndex((entry) => entry.id === next.id);
    if (existingIndex >= 0) {
      contextEntries[existingIndex] = next;
    } else {
      contextEntries.push(next);
    }
    return HttpResponse.json(next);
  }),

  http.delete(/\/api\/v1\/context$/, ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    const key = url.searchParams.get('key');
    if (!isContextScope(scope) || !key) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_scope_and_key_required' }, { status: 400 });
    }
    if (scope === 'project_member' && (!url.searchParams.get('workspace_id') || !url.searchParams.get('project_id'))) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'context_project_member_scope_requires_ids' }, { status: 400 });
    }
    if (scope === 'project_member') {
      const workspaceId = url.searchParams.get('workspace_id') ?? '';
      const projectId = url.searchParams.get('project_id') ?? '';
      const userId = getRequestUserId(request);
      if (!workspaceId || !projectId || !isActiveProjectMember(projectId, userId)) {
        return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
      }
    }
    const item = filterEntries(url.searchParams, request).find((entry) => entry.key === key);
    if (!item) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'context_not_found' }, { status: 404 });
    }
    const index = contextEntries.findIndex((entry) => entry.id === item.id);
    if (index >= 0) contextEntries.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
