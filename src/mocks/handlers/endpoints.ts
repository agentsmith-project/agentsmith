import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docEndpointFixtures } from '../doc-fixtures/workspace-projects';
import type { Endpoint } from '@/lib/api/types';

const endpoints: Endpoint[] = DOC_FIXTURES_ENABLED ? [...docEndpointFixtures] : [...((p0.endpoints ?? []) as unknown as Endpoint[])];
const API_V1_PATTERN = '*/api/v1';

type MockAgentTaskModelSetting = {
  workspace_id: string;
  project_id: string;
  endpoint_id: string;
  setting_revision: string;
  updated_at: string;
  updated_by_user_id: string;
};

function settingKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

const initialAgentTaskModelSettings: MockAgentTaskModelSetting[] = [
  {
    workspace_id: 'ws_1',
    project_id: 'proj_001',
    endpoint_id: 'ep_1',
    setting_revision: 'set_mock_1',
    updated_at: '2026-05-07T00:00:00.000Z',
    updated_by_user_id: 'user_1',
  },
  {
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    endpoint_id: 'ep_1',
    setting_revision: 'set_mock_visual_default',
    updated_at: '2026-05-07T00:00:00.000Z',
    updated_by_user_id: 'user_1',
  },
];

const agentTaskModelSettings = new Map<string, MockAgentTaskModelSetting>(
  initialAgentTaskModelSettings.map((setting) => [settingKey(setting.workspace_id, setting.project_id), setting]),
);

export function resetMockAgentTaskModelSettings() {
  agentTaskModelSettings.clear();
  for (const setting of initialAgentTaskModelSettings) {
    agentTaskModelSettings.set(settingKey(setting.workspace_id, setting.project_id), setting);
  }
}

function canUpdateAgentTaskModelSetting(request: Request): boolean {
  const permission = request.headers.get('x-mock-agent-task-model-permission')?.trim().toLowerCase();
  return permission !== 'task-only' && permission !== 'none' && permission !== 'denied';
}

function canUseAgentTaskModelSetting(request: Request): boolean {
  const permission = request.headers.get('x-mock-agent-task-model-permission')?.trim().toLowerCase();
  return permission !== 'none' && permission !== 'denied';
}

function resolveDefaultModel(endpoint: Endpoint | undefined): string {
  if (!endpoint) return '';
  return endpoint.defaults?.chat_model_id
    ?? endpoint.defaults?.multimodal_model_id
    ?? endpoint.capabilities?.find((item) => (
      (item.type === 'chat_completion' || item.type === 'multimodal_completion')
      && item.enabled
      && typeof item.default_model_id === 'string'
      && item.default_model_id.length > 0
    ))?.default_model_id
    ?? endpoint.models?.find((item) => item.capability === 'chat_completion')?.model_id
    ?? endpoint.models?.find((item) => item.capability === 'multimodal_completion')?.model_id
    ?? endpoint.model
    ?? '';
}

function buildUseForAgentTasksAction(endpoint: Endpoint, visible: boolean) {
  const allowed = endpoint.status === 'active' && resolveDefaultModel(endpoint).length > 0;
  return {
    operation: 'use_for_agent_tasks' as const,
    visible,
    allowed: visible && allowed,
    ...(visible && !allowed ? { reason_code: endpoint.status !== 'active' ? 'agent_task_model_endpoint_disabled' : 'agent_task_model_default_missing' } : {}),
    required_permissions: ['project:governance:update'],
    danger_level: 'none' as const,
  };
}

function shapeEndpointForAgentTaskModel(
  endpoint: Endpoint,
  setting: MockAgentTaskModelSetting | undefined,
  request: Request,
): Endpoint {
  const visible = canUpdateAgentTaskModelSetting(request);
  return {
    ...endpoint,
    agent_task_model_selected: setting?.endpoint_id === endpoint.id,
    actions: {
      ...endpoint.actions,
      use_for_agent_tasks: buildUseForAgentTasksAction(endpoint, visible),
    },
  };
}

function readinessForSetting(setting: MockAgentTaskModelSetting | undefined) {
  return setting
    ? {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      }
    : {
        state: 'not_configured',
        display_summary: 'Agent task model is not configured.',
      };
}

function settingResponse(
  workspaceId: string,
  projectId: string,
  request: Request,
) {
  const setting = agentTaskModelSettings.get(settingKey(workspaceId, projectId));
  const readiness = readinessForSetting(setting);
  if (!canUpdateAgentTaskModelSetting(request)) {
    return { readiness };
  }
  const endpoint = endpoints.find((item) => item.id === setting?.endpoint_id && item.project_id === projectId);
  return {
    readiness,
    ...(setting && endpoint
      ? {
          setting: {
            ...setting,
            endpoint_display_name: endpoint.name,
            default_model: resolveDefaultModel(endpoint),
          },
        }
      : {}),
    actions: {
      update: {
        operation: 'update' as const,
        visible: true,
        allowed: true,
        required_permissions: ['project:governance:update'],
        danger_level: 'none' as const,
      },
    },
  };
}

export const endpointHandlers = [
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-task-model-setting`, ({ params, request }) => {
    if (!canUseAgentTaskModelSetting(request)) {
      return HttpResponse.json({ error_code: 'FORBIDDEN', message: 'forbidden' }, { status: 403 });
    }
    return HttpResponse.json(settingResponse(String(params.ws ?? ''), String(params.prj ?? ''), request));
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-task-model-setting`, async ({ params, request }) => {
    if (!canUpdateAgentTaskModelSetting(request)) {
      return HttpResponse.json({ error_code: 'FORBIDDEN', message: 'forbidden' }, { status: 403 });
    }
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const endpointId = typeof body.endpoint_id === 'string' ? body.endpoint_id.trim() : '';
    if (!endpointId) {
      return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'endpoint_id_required', field: 'endpoint_id' }, { status: 422 });
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'expected_setting_revision')) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'expected_setting_revision_required',
        field: 'expected_setting_revision',
      }, { status: 422 });
    }
    const expectedRevision = typeof body.expected_setting_revision === 'string'
      ? body.expected_setting_revision
      : body.expected_setting_revision === null
        ? null
        : '';
    if (expectedRevision === '') {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'expected_setting_revision_required',
        field: 'expected_setting_revision',
      }, { status: 422 });
    }
    const key = settingKey(workspaceId, projectId);
    const current = agentTaskModelSettings.get(key);
    if ((current?.setting_revision ?? null) !== expectedRevision) {
      return HttpResponse.json({
        error_code: 'agent_task_model_setting_conflict',
        message: 'agent_task_model_setting_conflict',
        field: 'expected_setting_revision',
      }, { status: 409 });
    }
    const endpoint = endpoints.find((item) => item.id === endpointId && item.project_id === projectId);
    if (!endpoint) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'endpoint_not_found' }, { status: 404 });
    }
    const action = buildUseForAgentTasksAction(endpoint, true);
    if (!action.allowed) {
      return HttpResponse.json({ error_code: action.reason_code, message: action.reason_code }, { status: 409 });
    }
    const next: MockAgentTaskModelSetting = {
      workspace_id: workspaceId,
      project_id: projectId,
      endpoint_id: endpointId,
      setting_revision: `set_mock_${Date.now()}`,
      updated_at: new Date().toISOString(),
      updated_by_user_id: 'user_1',
    };
    agentTaskModelSettings.set(key, next);
    return HttpResponse.json(settingResponse(workspaceId, projectId, request));
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints`, ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const setting = agentTaskModelSettings.get(settingKey(String(params.ws ?? ''), projectId));
    return HttpResponse.json({
      items: endpoints
        .filter((endpoint) => endpoint.project_id === projectId)
        .map((endpoint) => shapeEndpointForAgentTaskModel(endpoint, setting, request)),
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints/:id`, ({ params }) => {
    const ep = endpoints.find((e) => e.id === params.id);
    if (!ep) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    return HttpResponse.json(ep);
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const created: Endpoint = {
      id: `ep_${Date.now()}`,
      project_id: 'proj_001',
      name: (body.name as string) ?? 'New Endpoint',
      description: (body.description as string) ?? '',
      type: body.type === 'custom' ? 'custom' : 'catalog',
      model: (body.model as string) ?? '',
      base_url: (body.base_url as string) ?? 'https://api.openai.com/v1',
      credential_ref: (body.credential_ref as string) ?? '',
      provider_family:
        body.provider_family === 'anthropic'
        || body.provider_family === 'openai'
        || body.provider_family === 'deepseek'
        || body.provider_family === 'minimax'
        || body.provider_family === 'kimi'
        || body.provider_family === 'google'
        || body.provider_family === 'glm'
        || body.provider_family === 'alibaba'
          ? body.provider_family
          : 'custom',
      upstream_protocol:
        body.upstream_protocol === 'anthropic_messages'
        || body.upstream_protocol === 'openai_responses'
          ? body.upstream_protocol
          : 'openai_chat_completions',
      capabilities: Array.isArray(body.capabilities) ? body.capabilities as Endpoint['capabilities'] : undefined,
      models: Array.isArray(body.models) ? body.models as Endpoint['models'] : undefined,
      defaults: body.defaults && typeof body.defaults === 'object' ? body.defaults as Endpoint['defaults'] : undefined,
      meta: (body.meta as Record<string, string>) ?? undefined,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    endpoints.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints/import-bulk`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const created: Endpoint[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      const model = typeof item.model === 'string' ? item.model : key;
      const now = new Date().toISOString();
      const endpoint: Endpoint = {
        id: `ep_${key}_${Date.now()}`,
        project_id: String(params.prj ?? 'proj_001'),
        name: model,
        description: '',
        type: 'custom',
        model,
        base_url: typeof item.api_base === 'string' ? item.api_base : 'https://api.example.com/v1',
        credential_ref: 'cred_imported',
        provider_family: 'custom',
        upstream_protocol: 'openai_chat_completions',
        status: 'active',
        capabilities: [{ type: key === 'embedding' ? 'embedding' : key === 'reranker' ? 'rerank' : 'chat_completion', enabled: true, default_model_id: model }],
        defaults: key === 'completion' ? { chat_model_id: model } : undefined,
        created_at: now,
        updated_at: now,
      };
      endpoints.push(endpoint);
      created.push(endpoint);
    }
    return HttpResponse.json({ items: created }, { status: 201 });
  }),
  http.put(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints/:id`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = endpoints.findIndex((e) => e.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    endpoints[idx] = { ...endpoints[idx], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(endpoints[idx]);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/endpoints/:id`, ({ params }) => {
    const idx = endpoints.findIndex((e) => e.id === params.id);
    if (idx >= 0) endpoints.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
];
