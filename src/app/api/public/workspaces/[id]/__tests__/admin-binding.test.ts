import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const registryModule = vi.hoisted(() => ({
  bindPendingWorkspaceAdminByEmail: vi.fn(),
  getPublicSystemWorkspace: vi.fn(),
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => Symbol('jwks')),
  jwtVerify: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { POST } from '../admin-binding/route';

describe('/api/public/workspaces/[id]/admin-binding', () => {
  const createRemoteJWKSetMock = vi.mocked(createRemoteJWKSet);
  const jwtVerifyMock = vi.mocked(jwtVerify);

  beforeEach(() => {
    registryModule.bindPendingWorkspaceAdminByEmail.mockReset();
    registryModule.getPublicSystemWorkspace.mockReset();
    createRemoteJWKSetMock.mockReset();
    createRemoteJWKSetMock.mockReturnValue(Symbol('jwks') as never);
    jwtVerifyMock.mockReset();
    delete process.env.PUBLIC_KEYCLOAK_BASE_URL;
    delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
  });

  it('binds a pending admin when userinfo matches a real user', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
    jwtVerifyMock.mockResolvedValue({
      protectedHeader: { alg: 'RS256' },
      payload: {
        sub: 'user_123',
        email: 'owner@example.com',
        name: 'Owner User',
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(registryModule.bindPendingWorkspaceAdminByEmail).toHaveBeenCalledWith({
      workspaceId: 'ws_alpha',
      user: {
        user_id: 'user_123',
        email: 'owner@example.com',
        name: 'Owner User',
      },
    });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('https://login.example.com/realms/alpha/protocol/openid-connect/certs'),
    );
  });

  it('returns 202 when bearer token verification fails', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
    jwtVerifyMock.mockRejectedValue(new Error('invalid_token'));

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(202);
    expect(registryModule.bindPendingWorkspaceAdminByEmail).not.toHaveBeenCalled();
  });

  it('prefers internal keycloak base for JWKS when deployment env provides both', async () => {
    process.env.PUBLIC_KEYCLOAK_BASE_URL = 'https://login.example.com';
    process.env.INTERNAL_KEYCLOAK_BASE_URL = 'http://keycloak:8080';
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
    jwtVerifyMock.mockResolvedValue({
      protectedHeader: { alg: 'RS256' },
      payload: {
        sub: 'user_123',
        email: 'owner@example.com',
        preferred_username: 'owner-user',
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(200);
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('http://keycloak:8080/realms/alpha/protocol/openid-connect/certs'),
    );
    expect(registryModule.bindPendingWorkspaceAdminByEmail).toHaveBeenCalledWith({
      workspaceId: 'ws_alpha',
      user: {
        user_id: 'user_123',
        email: 'owner@example.com',
        name: 'owner-user',
      },
    });
  });

  it('returns 401 when authorization is missing', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(401);
    expect(registryModule.bindPendingWorkspaceAdminByEmail).not.toHaveBeenCalled();
  });
});
