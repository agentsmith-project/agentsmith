import type http from 'node:http';
import { InMemoryCache } from '@mbos/adapters-private';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBearerToken, verifyBearerToken, verifyRequestAuth } from './auth.js';
import { issueInternalTicket, resetInternalTicketsForTest } from './internal-ticket-store.js';
import { issueSSETicket, resetSSETicketsForTest } from './sse-ticket-store.js';
import { listPersistedSystemWorkspaces } from './system-workspace-persistence.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => Symbol('jwks')),
  decodeJwt: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock('./system-workspace-persistence.js', () => ({
  listPersistedSystemWorkspaces: vi.fn(async () => []),
}));

function makeRequest(args: {
  url: string;
  authorization?: string;
  executionTicketHeader?: string;
}): http.IncomingMessage {
  const headers: Record<string, string> = {};
  if (args.authorization) {
    headers.authorization = args.authorization;
  }
  if (args.executionTicketHeader) {
    headers['x-agentsmith-execution-ticket'] = args.executionTicketHeader;
  }
  return {
    url: args.url,
    headers,
  } as http.IncomingMessage;
}

describe('auth', () => {
  const cache = new InMemoryCache();
  const issuedTickets: string[] = [];
  const issuer = 'http://issuer.test/realms/mbos';
  const createRemoteJWKSetMock = vi.mocked(createRemoteJWKSet);
  const decodeJwtMock = vi.mocked(decodeJwt);
  const jwtVerifyMock = vi.mocked(jwtVerify);
  const listPersistedSystemWorkspacesMock = vi.mocked(listPersistedSystemWorkspaces);

  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER_URL = issuer;
    delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
    createRemoteJWKSetMock.mockReset();
    createRemoteJWKSetMock.mockReturnValue(Symbol('jwks') as never);
    decodeJwtMock.mockReset();
    decodeJwtMock.mockReturnValue({ iss: issuer } as never);
    jwtVerifyMock.mockReset();
    listPersistedSystemWorkspacesMock.mockReset();
    listPersistedSystemWorkspacesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    const issued = issuedTickets.splice(0);
    return Promise.all([
      resetSSETicketsForTest(cache, issued),
      resetInternalTicketsForTest(cache, issued),
      Promise.resolve().then(() => {
        vi.restoreAllMocks();
        delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
        delete process.env.KEYCLOAK_REALM;
        delete process.env.KEYCLOAK_ISSUER_URL;
        delete process.env.PUBLIC_KEYCLOAK_BASE_URL;
      }),
    ]);
  });

  it('extracts bearer token only from authorization header', () => {
    expect(extractBearerToken(makeRequest({
      url: '/api/v1/events?ticket=sse_123',
      authorization: 'Bearer jwt-token-123',
    }))).toBe('jwt-token-123');
    expect(extractBearerToken(makeRequest({
      url: '/api/v1/events?ticket=sse_123',
    }))).toBeNull();
  });

  it('accepts issued sse tickets on sse routes', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toMatchObject({ id: 'user_test' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('http://issuer.test/realms/mbos/protocol/openid-connect/certs'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-123',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('accepts internal execution tickets on bearer routes', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_exec',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });
    issuedTickets.push(issued.ticket);

    const auth = await verifyRequestAuth(makeRequest({
      url: '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/openai/responses',
      authorization: `Bearer ${issued.ticket}`,
    }), { cache });

    expect(auth?.tokenType).toBe('internal_ticket');
    expect(auth?.user).toMatchObject({ id: 'user_exec' });
    expect(auth?.internalTicket).toMatchObject({
      purpose: 'agent_execution',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      payload: expect.objectContaining({
        endpoint_id: 'ep_1',
      }),
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('does not treat the execution ticket header as implicit global auth by default', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_exec',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });
    issuedTickets.push(issued.ticket);

    const auth = await verifyRequestAuth(makeRequest({
      url: '/api/v1/me/profile',
      executionTicketHeader: issued.ticket,
    }), { cache });

    expect(auth).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('accepts an explicit internal ticket token channel without requiring bearer authorization', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_exec',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });
    issuedTickets.push(issued.ticket);

    const auth = await verifyRequestAuth(
      makeRequest({
        url: '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/openai/responses',
        executionTicketHeader: issued.ticket,
      }),
      {
        cache,
        internalTicketToken: issued.ticket,
      } as { cache: InMemoryCache; internalTicketToken: string },
    );

    expect(auth?.tokenType).toBe('internal_ticket');
    expect(auth?.user).toMatchObject({ id: 'user_exec' });
    expect(auth?.internalTicket).toMatchObject({
      purpose: 'agent_execution',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('prefers an explicit internal ticket token over an unrelated bearer authorization header', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_exec',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });
    issuedTickets.push(issued.ticket);

    const auth = await verifyRequestAuth(
      makeRequest({
        url: '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/openai/responses',
        authorization: 'Bearer unrelated-token',
        executionTicketHeader: issued.ticket,
      }),
      {
        cache,
        internalTicketToken: issued.ticket,
      },
    );

    expect(auth?.tokenType).toBe('internal_ticket');
    expect(auth?.user).toMatchObject({ id: 'user_exec' });
    expect(auth?.internalTicket).toMatchObject({
      purpose: 'agent_execution',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      payload: expect.objectContaining({
        endpoint_id: 'ep_1',
      }),
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('does not keep retired dsk_ prefix knowledge ahead of the current bearer verifier', async () => {
    const token = 'dsk_current_verifier_token';
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_current_verifier',
        email: 'current-verifier@example.com',
        name: 'Current Verifier User',
      },
    } as never);

    const auth = await verifyRequestAuth(makeRequest({
      url: '/api/v1/me/profile',
      authorization: `Bearer ${token}`,
    }), { cache });

    expect(auth?.tokenType).toBe('jwt');
    expect(auth?.internalTicket).toBeNull();
    expect(auth?.user).toMatchObject({
      id: 'user_current_verifier',
      email: 'current-verifier@example.com',
    });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      token,
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('prefers internal keycloak base url over public issuer url for jwks discovery', async () => {
    process.env.INTERNAL_KEYCLOAK_BASE_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_REALM = 'mbos';
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_internal',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-internal',
    }));

    expect(user).toMatchObject({ id: 'user_internal' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('http://keycloak:8080/realms/mbos/protocol/openid-connect/certs'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-internal',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('accepts tokens from a ready workspace-specific keycloak issuer', async () => {
    process.env.PUBLIC_KEYCLOAK_BASE_URL = 'https://platform.example.com';
    listPersistedSystemWorkspacesMock.mockResolvedValue([
      {
        id: 'lab',
        name: 'lab',
        workspace_admin: 'owner@example.com',
        workspace_admin_binding_required: false,
        workspace_admin_user_id: 'user_owner',
        workspace_admin_name: 'Owner',
        project_creators: [],
        login_idp: {
          kind: 'keycloak',
          url: 'https://keycloak.imotion.ai',
          realm: 'master',
          client_id: 'mbos',
        },
        tenant: {
          workspace_id: 'lab',
          workspace_name: 'lab',
          substrate_label: 'test',
          database_name: 'lab_db',
          collection_prefix: 'lab_',
          key_prefix: 'lab/',
        },
        provisioning_status: 'ready',
        last_initialized_at: null,
        last_init_error: null,
        created_at: '2026-03-30T00:00:00.000Z',
        updated_at: '2026-03-30T00:00:00.000Z',
      },
    ] as never);
    decodeJwtMock.mockReturnValue({ iss: 'https://keycloak.imotion.ai/realms/master' } as never);
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_workspace',
        email: 'workspace@example.com',
        name: 'Workspace User',
      },
    } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-workspace',
    }));

    expect(user).toMatchObject({ id: 'user_workspace' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('https://keycloak.imotion.ai/realms/master/protocol/openid-connect/certs'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-workspace',
      expect.any(Symbol),
      expect.objectContaining({ issuer: 'https://keycloak.imotion.ai/realms/master' }),
    );
  });

  it('rejects tokens from issuers outside the allowed workspace list', async () => {
    decodeJwtMock.mockReturnValue({ iss: 'https://unknown.example.com/realms/rogue' } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-rogue',
    }));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('falls back to env issuer when workspace issuer persistence fails', async () => {
    listPersistedSystemWorkspacesMock.mockRejectedValue(new Error('registry_unavailable'));
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_env_fallback',
        email: 'fallback@example.com',
        name: 'Fallback User',
      },
    } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-fallback',
    }));

    expect(user).toMatchObject({ id: 'user_env_fallback' });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-fallback',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('returns structured auth results for cached jwt tokens', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_cached',
        email: 'cached@example.com',
        name: 'Cached User',
      },
    } as never);

    const request = makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-cached',
    });

    const first = await verifyRequestAuth(request);
    const second = await verifyRequestAuth(request);

    expect(first).toMatchObject({
      tokenType: 'jwt',
      internalTicket: null,
      user: {
        id: 'user_cached',
        email: 'cached@example.com',
        name: 'Cached User',
      },
    });
    expect(second).toMatchObject({
      tokenType: 'jwt',
      internalTicket: null,
      user: {
        id: 'user_cached',
        email: 'cached@example.com',
        name: 'Cached User',
      },
    });
    expect(jwtVerifyMock).toHaveBeenCalledTimes(1);
  });

  it('skips workspaces with incomplete login_idp config', async () => {
    listPersistedSystemWorkspacesMock.mockResolvedValue([
      {
        id: 'broken',
        name: 'broken',
        workspace_admin: 'owner@example.com',
        workspace_admin_binding_required: false,
        workspace_admin_user_id: 'user_owner',
        workspace_admin_name: 'Owner',
        project_creators: [],
        login_idp: {
          kind: 'keycloak',
          url: 'https://keycloak.example.com',
          realm: '',
          client_id: 'mbos',
        },
        tenant: {
          workspace_id: 'broken',
          workspace_name: 'broken',
          substrate_label: 'test',
          database_name: 'broken_db',
          collection_prefix: 'broken_',
          key_prefix: 'broken/',
        },
        provisioning_status: 'ready',
        last_initialized_at: null,
        last_init_error: null,
        created_at: '2026-03-30T00:00:00.000Z',
        updated_at: '2026-03-30T00:00:00.000Z',
      },
    ] as never);
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_default_after_skip',
        email: 'default@example.com',
        name: 'Default User',
      },
    } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-default-after-skip',
    }));

    expect(user).toMatchObject({ id: 'user_default_after_skip' });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-default-after-skip',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('skips non-ready workspaces when resolving allowed issuers', async () => {
    listPersistedSystemWorkspacesMock.mockResolvedValue([
      {
        id: 'draft-ws',
        name: 'draft-ws',
        workspace_admin: 'owner@example.com',
        workspace_admin_binding_required: false,
        workspace_admin_user_id: 'user_owner',
        workspace_admin_name: 'Owner',
        project_creators: [],
        login_idp: {
          kind: 'keycloak',
          url: 'https://keycloak.example.com',
          realm: 'draft',
          client_id: 'mbos',
        },
        tenant: {
          workspace_id: 'draft-ws',
          workspace_name: 'draft-ws',
          substrate_label: 'test',
          database_name: 'draft_db',
          collection_prefix: 'draft_',
          key_prefix: 'draft/',
        },
        provisioning_status: 'draft',
        last_initialized_at: null,
        last_init_error: null,
        created_at: '2026-03-30T00:00:00.000Z',
        updated_at: '2026-03-30T00:00:00.000Z',
      },
    ] as never);
    decodeJwtMock.mockReturnValue({ iss: 'https://keycloak.example.com/realms/draft' } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-draft-workspace',
    }));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('consumes single-use sse tickets after the first successful resolve', async () => {
    const bearerToken = 'jwt-token-single-use';
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_single_use',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
    const issued = await issueSSETicket(cache, { bearerToken });
    issuedTickets.push(issued.ticket);

    const first = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });
    const second = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(first).toMatchObject({ id: 'user_single_use' });
    expect(second).toBeNull();
    expect(jwtVerifyMock).toHaveBeenCalledTimes(1);
  });

  it('rejects query-token fallback', async () => {
    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/events?token=jwt-token-123',
    }));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects ticket query on non-sse routes', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/me/notifications?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });
});
