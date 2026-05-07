import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { EndpointRecord } from './resource-models.js';
import { EndpointResourceService } from './endpoint-resource-service.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';

const {
  enforceEndpointGovernancePreflightMock,
  writeProjectAuditEventMock,
  writeProjectUsageFactMock,
} = vi.hoisted(() => ({
  enforceEndpointGovernancePreflightMock: vi.fn(),
  writeProjectAuditEventMock: vi.fn(),
  writeProjectUsageFactMock: vi.fn(),
}));

vi.mock('./governance-endpoint-preflight.js', () => ({
  enforceEndpointGovernancePreflight: enforceEndpointGovernancePreflightMock,
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent: writeProjectAuditEventMock,
  writeProjectUsageFact: writeProjectUsageFactMock,
}));

import { handleEndpointRoute, resolveEffectiveEndpointProxyPath } from './endpoint-route-handler.js';
import { buildUpstreamUrl } from './request-handler/build-upstream-url.js';

type MockIncomingMessage = EventEmitter & http.IncomingMessage & {
  aborted: boolean;
  complete: boolean;
  destroyed: boolean;
  headers: http.IncomingHttpHeaders;
  method: string;
  socket: EventEmitter & {
    destroyed: boolean;
  };
};

type MockServerResponse = EventEmitter & http.ServerResponse & {
  destroyed: boolean;
  headers: Map<string, string>;
  statusCode: number;
  writableDestroyed: boolean;
  writableEnded: boolean;
  writableFinished: boolean;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  socket: EventEmitter & {
    destroyed: boolean;
  };
};

type DirectProxyOptionsWithSignal = {
  upstreamUrl: string;
  apiKey: string;
  endpointProtocol?: string;
  proxyPath?: string;
  model?: string;
  timeoutSeconds?: number;
  requestBody?: unknown;
  passthroughHeaders?: Record<string, string>;
  signal?: AbortSignal;
};

function createEndpoint(overrides: Partial<EndpointRecord> = {}): EndpointRecord {
  return {
    id: 'ep_1',
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    name: 'Endpoint 1',
    model: 'placeholder-model',
    type: 'catalog',
    base_url: 'https://provider.example/v1',
    status: 'active',
    credential_ref: 'cred_1',
    upstream_protocol: 'openai_responses',
    capabilities: [
      { type: 'chat_completion', enabled: true },
      { type: 'rerank', enabled: true },
    ],
    created_at: '2026-04-24T00:00:00.000Z',
    updated_at: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

function createRequest(): MockIncomingMessage {
  const socket = new EventEmitter() as MockIncomingMessage['socket'];
  socket.destroyed = false;

  const req = new EventEmitter() as MockIncomingMessage;
  req.aborted = false;
  req.complete = true;
  req.destroyed = false;
  req.headers = {};
  req.method = 'POST';
  req.socket = socket;
  return req;
}

function createResponse(): MockServerResponse {
  const socket = new EventEmitter() as MockServerResponse['socket'];
  socket.destroyed = false;

  const res = new EventEmitter() as MockServerResponse;
  res.destroyed = false;
  res.headers = new Map<string, string>();
  res.statusCode = 200;
  res.writableDestroyed = false;
  res.writableEnded = false;
  res.writableFinished = false;
  res.socket = socket;
  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers.set(name.toLowerCase(), value);
    return res;
  });
  res.write = vi.fn(() => true);
  res.end = vi.fn(() => {
    res.writableEnded = true;
    res.writableFinished = true;
    res.emit('finish');
    return res;
  });
  return res;
}

function createDeps(args?: {
  endpoint?: EndpointRecord;
  universalProxyService?: {
    supportsEndpoint: ReturnType<typeof vi.fn>;
    supportsProxyPath: ReturnType<typeof vi.fn>;
    ensureEndpointNamespace: ReturnType<typeof vi.fn>;
    proxyJsonRequest: ReturnType<typeof vi.fn>;
  };
}): NodeApiDeps {
  const endpoint = args?.endpoint ?? createEndpoint();
  return {
    endpointResourceService: {
      getEndpoint: vi.fn(async () => endpoint),
      getCredentialSecret: vi.fn(async () => 'secret-key'),
    },
    universalProxyService: args?.universalProxyService,
  } as unknown as NodeApiDeps;
}

const user: AuthenticatedUser = {
  id: 'user_1',
  email: 'user@example.com',
  name: 'User 1',
};

beforeEach(() => {
  enforceEndpointGovernancePreflightMock.mockReset();
  writeProjectAuditEventMock.mockReset();
  writeProjectUsageFactMock.mockReset();

  enforceEndpointGovernancePreflightMock.mockResolvedValue({
    allowed: true,
    decisionId: 'gdec_test',
  });
  writeProjectAuditEventMock.mockResolvedValue(undefined);
  writeProjectUsageFactMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveEffectiveEndpointProxyPath', () => {
  it('preserves explicit canonical responses path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'openai/responses', 'chat/completions')).toBe('openai/responses');
  });

  it('preserves explicit canonical anthropic messages path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/messages', 'chat/completions')).toBe('anthropic/messages');
  });

  it('falls back to resolved proxy path for legacy or alias chat paths', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/v1/messages', 'messages')).toBe('messages');
    expect(resolveEffectiveEndpointProxyPath('chat', 'messages/count_tokens', 'messages')).toBe('messages');
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/messages/count_tokens', 'messages')).toBe('messages');
  });

  it('falls back to resolved proxy path for non-chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('rerank', 'rerank', 'rerank')).toBe('rerank');
  });
});

describe('handleEndpointRoute downstream abort timing', () => {
  it('routes anthropic messages/count_tokens through the direct bridge instead of universal proxy', async () => {
    const req = createRequest();
    req.headers = {
      'anthropic-version': '2023-06-01',
    };
    const res = createResponse();
    const universalProxyService = {
      supportsEndpoint: vi.fn(() => true),
      supportsProxyPath: vi.fn(() => true),
      ensureEndpointNamespace: vi.fn(async () => 'ns_1'),
      proxyJsonRequest: vi.fn(),
    };
    const proxyJsonRequest = vi.fn(async (
      _req: http.IncomingMessage,
      _res: http.ServerResponse,
      options: DirectProxyOptionsWithSignal,
    ) => {
      expect(options.upstreamUrl).toBe('https://anthropic-compatible.provider.example/v1/messages/count_tokens');
      expect(options.endpointProtocol).toBe('anthropic_messages');
      expect(options.proxyPath).toBe('messages/count_tokens');
      expect(options.requestBody).toEqual({ messages: [{ role: 'user', content: 'hello' }] });
      expect(options.passthroughHeaders).toEqual({ 'anthropic-version': '2023-06-01' });
      return { upstream_status: 200, tokens_total: 0 };
    });

    const handled = await handleEndpointRoute({
      route: {
        kind: 'endpointProxy',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_1',
        proxyPath: 'anthropic/messages/count_tokens',
      },
      method: 'POST',
      req,
      res,
      deps: createDeps({
        endpoint: createEndpoint({
          base_url: 'https://anthropic-compatible.provider.example',
          upstream_protocol: 'anthropic_messages',
        }),
        universalProxyService,
      }),
      user,
      internalTicket: null,
      json: vi.fn(),
      readBody: vi.fn(async () => ({ messages: [{ role: 'user', content: 'hello' }] })),
      buildUpstreamUrl,
      proxyJsonRequest,
    });

    expect(handled).toBe(true);
    expect(universalProxyService.ensureEndpointNamespace).not.toHaveBeenCalled();
    expect(universalProxyService.proxyJsonRequest).not.toHaveBeenCalled();
    expect(proxyJsonRequest).toHaveBeenCalledTimes(1);
  });

  it('forwards only whitelisted non-credential headers to the universal proxy data plane', async () => {
    const req = createRequest();
    req.headers = {
      authorization: 'Bearer frontend-jwt',
      'x-api-key': 'frontend-api-key',
      cookie: 'session=frontend-session',
      'x-agentsmith-provider-credential': 'frontend-provider-key',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': ['tools-2024-04-04', 'files-2024-05-01'],
      'x-stainless-helper-method': 'stream',
    };
    const res = createResponse();
    const universalProxyService = {
      supportsEndpoint: vi.fn(() => true),
      supportsProxyPath: vi.fn(() => true),
      ensureEndpointNamespace: vi.fn(async () => 'ns_1'),
      proxyJsonRequest: vi.fn(async (options: {
        passthroughHeaders?: Record<string, string>;
        providerCredential?: string;
      }) => {
        expect(options.providerCredential).toBe('secret-key');
        expect(options.passthroughHeaders).toEqual({
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'tools-2024-04-04,files-2024-05-01',
          'x-stainless-helper-method': 'stream',
        });
        expect(options.passthroughHeaders).not.toHaveProperty('authorization');
        expect(options.passthroughHeaders).not.toHaveProperty('x-api-key');
        expect(options.passthroughHeaders).not.toHaveProperty('cookie');
        expect(options.passthroughHeaders).not.toHaveProperty('x-agentsmith-provider-credential');
        return { upstream_status: 200, tokens_total: 11 };
      }),
    };

    const handled = await handleEndpointRoute({
      route: {
        kind: 'endpointProxy',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_1',
        proxyPath: 'openai/responses',
      },
      method: 'POST',
      req,
      res,
      deps: createDeps({ universalProxyService }),
      user,
      internalTicket: null,
      json: vi.fn(),
      readBody: vi.fn(async () => ({ input: 'hello' })),
      buildUpstreamUrl: vi.fn((baseUrl: string, proxyPath: string) => `${baseUrl}/${proxyPath}`),
      proxyJsonRequest: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(universalProxyService.proxyJsonRequest).toHaveBeenCalledTimes(1);
  });

  it('passes an already-aborted signal to universal proxy when response close fires immediately after body read', async () => {
    const req = createRequest();
    const res = createResponse();
    const universalProxyService = {
      supportsEndpoint: vi.fn(() => true),
      supportsProxyPath: vi.fn(() => true),
      ensureEndpointNamespace: vi.fn(async () => 'ns_1'),
      proxyJsonRequest: vi.fn(async (options: { providerCredential?: string; signal?: AbortSignal }) => {
        expect(options.signal?.aborted).toBe(true);
        expect(options.signal?.reason).toMatchObject({
          name: 'AbortError',
          message: 'endpoint_proxy_response_closed',
        });
        expect(options.providerCredential).toBe('secret-key');
        throw options.signal?.reason ?? new Error('expected_aborted_signal');
      }),
    };

    const pending = handleEndpointRoute({
      route: {
        kind: 'endpointProxy',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_1',
        proxyPath: 'openai/responses',
      },
      method: 'POST',
      req,
      res,
      deps: createDeps({ universalProxyService }),
      user,
      internalTicket: null,
      json: vi.fn(),
      readBody: vi.fn(async () => {
        queueMicrotask(() => {
          res.emit('close');
        });
        return { input: 'hello' };
      }),
      buildUpstreamUrl: vi.fn((baseUrl: string, proxyPath: string) => `${baseUrl}/${proxyPath}`),
      proxyJsonRequest: vi.fn(),
    });

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'endpoint_proxy_response_closed',
    });
    expect(universalProxyService.ensureEndpointNamespace).toHaveBeenCalledTimes(1);
    expect(universalProxyService.ensureEndpointNamespace).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      expect.objectContaining({ id: 'ep_1' }),
    );
    expect(universalProxyService.proxyJsonRequest).toHaveBeenCalledTimes(1);
  });

  it('passes an already-aborted signal to direct proxy when response socket close fires immediately after body read', async () => {
    const req = createRequest();
    const res = createResponse();
    const proxyJsonRequest = vi.fn(async (_req: http.IncomingMessage, _res: http.ServerResponse, options: DirectProxyOptionsWithSignal) => {
      expect(options.signal?.aborted).toBe(true);
      expect(options.signal?.reason).toMatchObject({
        name: 'AbortError',
        message: 'endpoint_proxy_response_closed',
      });
      expect(options.requestBody).toEqual({ query: 'hello' });
      throw options.signal?.reason ?? new Error('expected_aborted_signal');
    });

    const pending = handleEndpointRoute({
      route: {
        kind: 'endpointRerank',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_1',
      },
      method: 'POST',
      req,
      res,
      deps: createDeps({
        endpoint: createEndpoint({
          upstream_protocol: 'openai_chat_completions',
          capabilities: [{ type: 'rerank', enabled: true }],
        }),
      }),
      user,
      internalTicket: null,
      json: vi.fn(),
      readBody: vi.fn(async () => {
        queueMicrotask(() => {
          res.socket.emit('close');
        });
        return { query: 'hello' };
      }),
      buildUpstreamUrl: vi.fn((baseUrl: string, proxyPath: string) => `${baseUrl}/${proxyPath}`),
      proxyJsonRequest,
    });

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'endpoint_proxy_response_closed',
    });
    expect(proxyJsonRequest).toHaveBeenCalledTimes(1);
  });
});

describe('handleEndpointRoute Agent task model row actions', () => {
  async function createEndpointListDeps(permissions: string[]): Promise<NodeApiDeps> {
    const docStore = new InMemoryJsonDocStore();
    const deps = {
      cache: new InMemoryCache(),
      docStore,
      endpointResourceService: new EndpointResourceService(docStore),
      getProjectUseCase: {
        execute: vi.fn(async () => ({
          id: 'proj_1',
          workspace_id: 'ws_default',
          owner_id: 'owner_1',
          governance_json: null,
        })),
      },
    } as unknown as NodeApiDeps;
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      user_email: 'user@example.com',
      user_name: 'User 1',
      status: 'active',
      joined_at: '2026-05-07T00:00:00.000Z',
    });
    await upsertProjectMemberPermissionState(docStore, 'ws_default', 'proj_1', 'user_1', {
      mode: 'custom',
      template: null,
      permissions,
    });
    return deps;
  }

  async function createReadyEndpointForList(deps: NodeApiDeps): Promise<EndpointRecord> {
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'row-action-key',
      value: 'sk-row-action',
    });
    return deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'Ready Agent task endpoint',
      model: 'gpt-5.5',
      type: 'custom',
      base_url: 'https://provider.example/v1',
      credential_ref: credential.id,
      status: 'active',
      upstream_protocol: 'openai_responses',
      capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
      defaults: { chat_model_id: 'gpt-5.5' },
    });
  }

  it('returns backend-computed Agent task row actions without adding an endpoint capability enum', async () => {
    const deps = await createEndpointListDeps(['project:governance:update']);
    const ready = await createReadyEndpointForList(deps);
    const missingCredential = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'Missing credential endpoint',
      model: 'gpt-5.5',
      type: 'custom',
      base_url: 'https://provider.example/v1',
      status: 'active',
      upstream_protocol: 'openai_responses',
    });
    await new AgentTaskModelSettingService(deps).patchSetting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: ready.id,
      expectedSettingRevision: null,
      actorUserId: 'user_1',
    });
    const json = vi.fn();

    await expect(handleEndpointRoute({
      route: { kind: 'endpoints', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user,
      internalTicket: null,
      json,
      readBody: vi.fn(),
      buildUpstreamUrl,
      proxyJsonRequest: vi.fn(),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as { items: Array<Record<string, unknown>> };
    const readyRow = body.items.find((item) => item.id === ready.id);
    const blockedRow = body.items.find((item) => item.id === missingCredential.id);
    expect(readyRow).toMatchObject({
      agent_task_model_selected: true,
      actions: {
        use_for_agent_tasks: {
          operation: 'use_for_agent_tasks',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
        },
      },
    });
    expect(readyRow).not.toHaveProperty('agent_task_capable');
    expect(blockedRow).toMatchObject({
      agent_task_model_selected: false,
      actions: {
        use_for_agent_tasks: {
          visible: true,
          allowed: false,
          reason_code: 'agent_task_model_credential_missing',
        },
      },
    });
    expect(blockedRow).not.toHaveProperty('agent_task_capable');
  });

  it('hides Agent task row actions from callers without project governance update permission', async () => {
    const deps = await createEndpointListDeps(['project:agent_task:use']);
    await createReadyEndpointForList(deps);
    const json = vi.fn();

    await expect(handleEndpointRoute({
      route: { kind: 'endpoints', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user,
      internalTicket: null,
      json,
      readBody: vi.fn(),
      buildUpstreamUrl,
      proxyJsonRequest: vi.fn(),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({
      actions: {
        use_for_agent_tasks: {
          visible: false,
          allowed: false,
          required_permissions: ['project:governance:update'],
        },
      },
    });
  });
});
