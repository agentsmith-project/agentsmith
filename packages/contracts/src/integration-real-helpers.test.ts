import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../e2e/integration-workspace-access', () => ({
  ensureWorkspaceProjectCreatorAccess: vi.fn(),
  readStoredAuthToken: vi.fn(async () => 'fixture-token'),
}));

import {
  API_BASE,
  BACKEND_REAL_MODEL,
  createInternalChatAgent,
  resolveChatWireApiForEndpointUpstreamProtocol,
} from '../../../e2e/integration-real-helpers';

type SupportedChatEndpointUpstreamProtocol = Parameters<typeof resolveChatWireApiForEndpointUpstreamProtocol>[0];

function createJsonResponse(payload: unknown) {
  return {
    ok: () => true,
    json: async () => payload,
  };
}

function createInternalChatAgentPageStub(
  upstreamProtocol: SupportedChatEndpointUpstreamProtocol,
): {
  page: Page;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn().mockResolvedValue(
    createJsonResponse({ upstream_protocol: upstreamProtocol }),
  );
  const post = vi.fn().mockResolvedValue(
    createJsonResponse({ id: 'agent_internal_chat_123' }),
  );

  return {
    page: {
      request: {
        get,
        post,
      },
    } as unknown as Page,
    get,
    post,
  };
}

describe('resolveChatWireApiForEndpointUpstreamProtocol', () => {
  it.each([
    ['openai_chat_completions', 'chat'],
    ['openai_responses', 'responses'],
    ['anthropic_messages', 'anthropic_messages'],
  ] as const)('maps %s to %s', (upstreamProtocol, expectedWireApi) => {
    expect(resolveChatWireApiForEndpointUpstreamProtocol(upstreamProtocol)).toBe(expectedWireApi);
  });
});

describe('createInternalChatAgent', () => {
  it.each([
    ['openai_responses', 'responses'],
    ['anthropic_messages', 'anthropic_messages'],
  ] as const)('uses %s endpoint protocol when creating the internal chat agent', async (upstreamProtocol, expectedWireApi) => {
    const { page, get, post } = createInternalChatAgentPageStub(upstreamProtocol);

    const agent = await createInternalChatAgent(page, {
      workspaceId: 'ws_default',
      projectId: 'proj_default',
      endpointId: 'endpoint_123',
      title: 'internal-chat',
    });

    expect(get).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/proj_default/endpoints/endpoint_123`,
      {
        headers: { Authorization: 'Bearer fixture-token' },
      },
    );
    expect(post).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/proj_default/agents`,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer fixture-token',
          'Content-Type': 'application/json',
        },
        data: expect.objectContaining({
          mode: 'internal',
          interaction_kind: 'chat',
          execution_preferences: {
            chat: {
              endpoint_id: 'endpoint_123',
              wire_api: expectedWireApi,
              model: BACKEND_REAL_MODEL,
            },
          },
        }),
      }),
    );
    expect(agent.agentId).toBe('agent_internal_chat_123');
    expect(agent.agentName).toMatch(/^internal-chat-\d+$/);
  });
});
