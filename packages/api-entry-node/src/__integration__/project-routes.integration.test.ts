import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { AfscpClientError } from '../afscp-error-mapper.js';
import {
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from '../project-afscp-namespace-store.js';
import { setProjectAdminGroupMembersPersisted } from '../project-member-governance-persistence.js';
import {
  ProjectStorageBootstrapService,
  type ProjectStorageBootstrapAfscpClient,
  type ProjectStorageBootstrapServicePort,
} from '../project-storage-bootstrap-service.js';
import { seedPersistedSystemWorkspacesForTest } from '../../../../src/lib/system-admin/workspace-registry/persistence.js';
import { apiFetch, apiFetchWithToken, startServer, startServerWithDeps } from './test-support.js';

const originalKeycloakAdmin = process.env.KEYCLOAK_ADMIN;
const originalKeycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;

beforeEach(() => {
  process.env.KEYCLOAK_ADMIN = 'agentsmith-admin';
  process.env.KEYCLOAK_ADMIN_PASSWORD = 'admin-secret';
});

afterEach(() => {
  if (originalKeycloakAdmin === undefined) delete process.env.KEYCLOAK_ADMIN;
  else process.env.KEYCLOAK_ADMIN = originalKeycloakAdmin;
  if (originalKeycloakAdminPassword === undefined) delete process.env.KEYCLOAK_ADMIN_PASSWORD;
  else process.env.KEYCLOAK_ADMIN_PASSWORD = originalKeycloakAdminPassword;
});

function workspaceRecord(args: {
  id: string;
  name: string;
  adminEmail: string;
  adminUserId?: string;
  adminName?: string;
  projectCreators?: Array<{ user_id: string; email: string; name: string }>;
  provisioningStatus?: 'draft' | 'provisioning' | 'ready' | 'failed' | 'disabled';
  issuerUrl: string;
  realm: string;
  clientId: string;
}) {
  return {
    id: args.id,
    name: args.name,
    workspace_admin: args.adminEmail,
    workspace_admin_user_id: args.adminUserId,
    workspace_admin_name: args.adminName,
    project_creators: args.projectCreators ?? [],
    login_idp: {
      kind: 'keycloak' as const,
      url: args.issuerUrl,
      realm: args.realm,
      client_id: args.clientId,
    },
    directory_idp: {
      client_id: 'agentsmith-directory',
      client_secret: 'directory-secret',
    },
    tenant: {
      workspace_id: args.id,
      workspace_name: args.name,
      substrate_label: 'default',
      database_name: `agentsmith_${args.id}`,
      collection_prefix: `${args.id}_`,
      key_prefix: `${args.id}:`,
    },
    provisioning_status: args.provisioningStatus ?? 'ready',
    last_initialized_at: null,
    last_init_error: null,
    created_at: '2026-03-18T00:00:00.000Z',
    updated_at: '2026-03-18T00:00:00.000Z',
  };
}

describe('api-entry-node project routes integration', () => {
  it('keeps integration auth hermetic when ambient keycloak env points at a different issuer', async () => {
    process.env.KEYCLOAK_BASE_URL = 'http://127.0.0.1:18080';
    process.env.PUBLIC_KEYCLOAK_BASE_URL = 'http://127.0.0.1:18080';
    process.env.INTERNAL_KEYCLOAK_BASE_URL = 'http://127.0.0.1:18080';
    process.env.KEYCLOAK_ISSUER_URL = 'http://127.0.0.1:18080/realms/mbos';
    process.env.KEYCLOAK_REALM = 'mbos';
    process.env.KEYCLOAK_CLIENT_ID = 'agentsmith';

    const { baseUrl } = startServer();

    const workspaces = await apiFetch(baseUrl, '/api/v1/workspaces');
    expect(workspaces.status).toBe(200);
    const workspaceBody = (await workspaces.json()) as { items: Array<{ id: string }> };
    expect(workspaceBody.items[0]?.id).toBe('ws_default');
  });

  it('returns authenticated workspace and member payload', async () => {
    const { baseUrl } = startServer();

    const workspaces = await apiFetch(baseUrl, '/api/v1/workspaces');
    expect(workspaces.status).toBe(200);
    const workspaceBody = (await workspaces.json()) as { items: Array<{ id: string }> };
    expect(workspaceBody.items[0]?.id).toBe('ws_default');

    const members = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/members');
    expect(members.status).toBe(200);
    const membersBody = (await members.json()) as {
      items: Array<{ user_id: string; permissions: string[] }>;
    };
    const workspaceAdmin = membersBody.items.find((item) => item.permissions.includes('workspace:project:create'));
    expect(workspaceAdmin?.user_id).toBe('user_owner');
    expect(workspaceAdmin?.permissions).toContain('workspace:project:create');
  });

  it('does not expose disabled registered workspaces in runtime workspace list', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_test', email: 'test@example.com', name: 'Test User' }],
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
      workspaceRecord({
        id: 'ws_disabled',
        name: 'Disabled Workspace',
        adminEmail: 'disabled-owner@example.com',
        projectCreators: [{ user_id: 'disabled@example.com', email: 'disabled@example.com', name: 'Disabled User' }],
        provisioningStatus: 'disabled',
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'disabled',
        clientId: 'agentsmith-disabled',
      }),
    ]);

    const workspaces = await apiFetch(baseUrl, '/api/v1/workspaces');
    expect(workspaces.status).toBe(200);
    const body = (await workspaces.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((item) => item.id)).toEqual(['ws_default']);
  });

  it('blocks project listing and creation for disabled registered workspaces', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_test', email: 'test@example.com', name: 'Test User' }],
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
      workspaceRecord({
        id: 'ws_disabled',
        name: 'Disabled Workspace',
        adminEmail: 'disabled-owner@example.com',
        projectCreators: [{ user_id: 'disabled@example.com', email: 'disabled@example.com', name: 'Disabled User' }],
        provisioningStatus: 'disabled',
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'disabled',
        clientId: 'agentsmith-disabled',
      }),
    ]);

    const listRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_disabled/projects');
    expect(listRes.status).toBe(404);
    await expect(listRes.json()).resolves.toEqual({
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'workspace_not_found',
    });

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_disabled/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Blocked Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(404);
    await expect(createRes.json()).resolves.toEqual({
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'workspace_not_found',
    });
  });

  it('lets workspace admins manage project creators and exposes creator permissions in workspace members', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_alt', email: 'alt@example.com', name: 'Alt User' }],
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
    ]);

    const creatorsRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/project-creators', 'owner-token');
    expect(creatorsRes.status).toBe(200);
    const creatorsBody = (await creatorsRes.json()) as { items: Array<{ user_id: string }> };
    expect(creatorsBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'user_alt' }),
      ]),
    );

    const updateRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/project-creators', 'owner-token', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_creator_user_ids: ['user_alt', 'user_creator'] }),
    });
    expect(updateRes.status).toBe(200);

    const membersRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/members', 'owner-token');
    expect(membersRes.status).toBe(200);
    const membersBody = (await membersRes.json()) as {
      items: Array<{
        user_id: string;
        permissions: string[];
        groups?: Array<{ id: string; system_key?: string }>;
      }>;
    };
    expect(membersBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 'user_alt',
          permissions: expect.arrayContaining(['workspace:project:create']),
          groups: expect.arrayContaining([
            expect.objectContaining({ id: 'grp_workspace_project_creators', system_key: 'project_creators' }),
          ]),
        }),
      ]),
    );
  });

  it('forbids plain workspace members from creating projects while allowing project creators', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_alt', email: 'alt@example.com', name: 'Alt User' }],
        issuerUrl: 'http://localhost:8080',
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
    ]);

    const deniedRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'member-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Blocked Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(deniedRes.status).toBe(403);
    await expect(deniedRes.json()).resolves.toEqual({
      error_code: 'PERMISSION_DENIED',
      message: 'workspace_project_create_required',
    });

    const allowedRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'alt-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Creator Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(allowedRes.status).toBe(201);
    const created = (await allowedRes.json()) as { owner_id: string; name: string };
    expect(created.name).toBe('Creator Project');
    expect(created.owner_id).toBe('user_alt');
  });

  it('keeps workspace admin permissions when the actor email matches after an idp switch', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_alt', email: 'alt@example.com', name: 'Alt User' }],
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
    ]);

    const membersRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/members', 'owner-email-switch-token');
    expect(membersRes.status).toBe(200);
    const membersBody = (await membersRes.json()) as {
      items: Array<{ user_id: string; email: string; permissions: string[] }>;
    };
    expect(membersBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 'user_owner_v2',
          email: 'owner@example.com',
          permissions: expect.arrayContaining(['workspace:governance:update', 'workspace:project:create']),
        }),
      ]),
    );
  });

  it('keeps project creator permissions when the actor email matches after an idp switch', async () => {
    const { baseUrl } = startServer();
    seedPersistedSystemWorkspacesForTest([
      workspaceRecord({
        id: 'ws_default',
        name: 'Default Workspace',
        adminEmail: 'owner@example.com',
        adminUserId: 'user_owner',
        adminName: 'Owner User',
        projectCreators: [{ user_id: 'user_alt', email: 'alt@example.com', name: 'Alt User' }],
        issuerUrl: process.env.KEYCLOAK_ISSUER_URL!,
        realm: 'mbos',
        clientId: 'agentsmith-web',
      }),
    ]);

    const allowedRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'creator-email-switch-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Creator Project After IdP Switch',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(allowedRes.status).toBe(201);
    const created = (await allowedRes.json()) as { owner_id: string; name: string };
    expect(created.name).toBe('Creator Project After IdP Switch');
    expect(created.owner_id).toBe('user_alt_v2');
  });

  it('supports create then list flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects');
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const legacyCreateRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Legacy Project',
        visibility: 'private',
        join_policy: 'approval_required',
        execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
      }),
    });
    expect(legacyCreateRes.status).toBe(400);
    const legacyCreateBody = (await legacyCreateRes.json()) as {
      error_code?: string;
      message?: string;
    };
    expect(legacyCreateBody.error_code).toBe('VALIDATION_ERROR');
    expect(legacyCreateBody.message).toContain('execution_preferences_json');

    const listAfterLegacyCreate = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects');
    expect(listAfterLegacyCreate.status).toBe(200);
    expect(await listAfterLegacyCreate.json()).toEqual({ items: [] });

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Demo Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string; workspace_id: string };
    expect(created.id).toContain('proj_');
    expect(created.name).toBe('Demo Project');
    expect(created.workspace_id).toBe('ws_default');

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects?from=test');
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listAfter.status).toBe(200);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { id: string; name: string };
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('Demo Project');

    const patchRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Renamed Project',
        description: 'Updated from patch',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { id: string; name: string; description: string };
    expect(patched.id).toBe(created.id);
    expect(patched.name).toBe('Renamed Project');
    expect(patched.description).toBe('Updated from patch');

    const getAfterPatch = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    const gotAfterPatch = (await getAfterPatch.json()) as { name: string; description: string };
    expect(getAfterPatch.status).toBe(200);
    expect(gotAfterPatch.name).toBe('Renamed Project');
    expect(gotAfterPatch.description).toBe('Updated from patch');

    const legacyExecutionPrefsRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Legacy Should Fail',
        execution_preferences_json: { notebook_endpoint_id: 'ep_notebook' },
      }),
    });
    expect(legacyExecutionPrefsRes.status).toBe(400);
    const legacyExecutionPrefsBody = (await legacyExecutionPrefsRes.json()) as {
      error_code?: string;
      message?: string;
    };
    expect(legacyExecutionPrefsBody.error_code).toBe('VALIDATION_ERROR');
    expect(legacyExecutionPrefsBody.message).toContain('execution_preferences_json');

    const gotAfterLegacyPatch = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(gotAfterLegacyPatch.status).toBe(200);
    const unchanged = (await gotAfterLegacyPatch.json()) as { name: string; execution_preferences_json?: unknown };
    expect(unchanged.name).toBe('Renamed Project');
    expect(unchanged).not.toHaveProperty('execution_preferences_json');

    const deleteRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('invokes project storage bootstrap after project create without changing the response shape', async () => {
    const deps = createDefaultNodeApiDeps();
    const bootstrapProjectStorage = vi.fn<ProjectStorageBootstrapServicePort['bootstrapProjectStorage']>(
      async () => undefined,
    );
    deps.projectStorageBootstrapService = {
      enabled: true,
      bootstrapProjectStorage,
      reconcileProjectStorage: vi.fn(),
      ensureProjectStorageReady: vi.fn(),
    };
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-project-bootstrap',
      },
      body: JSON.stringify({
        name: 'Storage Bootstrapped Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(Object.keys(created).sort()).toEqual([
      'created_at',
      'id',
      'join_policy',
      'name',
      'owner_id',
      'status',
      'updated_at',
      'visibility',
      'workspace_id',
    ]);
    expect(created.name).toBe('Storage Bootstrapped Project');
    expect(bootstrapProjectStorage).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: created.id,
      actorUserId: 'user_test',
      requestId: 'req-project-bootstrap',
    });
  });

  it('keeps project create response stable and non-leaking when bootstrap hits an unexpected internal error', async () => {
    const deps = createDefaultNodeApiDeps();
    const namespaceStore = new ProjectAfscpNamespaceStore(deps.docStore);
    const resourceOwnershipStore = new ProjectAfscpResourceOwnershipStore(deps.docStore);
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new Error('bootstrap_programmer_error token=svc-secret-token /internal/v1/namespaces/ns_secret');
      },
    );
    deps.projectAfscpNamespaceStore = namespaceStore;
    deps.projectStorageBootstrapService = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: {
        upsertNamespace,
        putNamespaceVolumeBinding: vi.fn(),
        getOperation: vi.fn(),
      },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      orchestratorCallerService: 'agentsmith-sandbox-manager',
      correlationIdFactory: () => 'corr-generated',
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-project-bootstrap-failed',
      },
      body: JSON.stringify({
        name: 'Storage Failure Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });

    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { id: string; name: string };
    expect(body.name).toBe('Storage Failure Project');
    expect(JSON.stringify(body)).not.toContain('svc-secret-token');
    expect(JSON.stringify(body)).not.toContain('/internal/v1');
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: body.id,
    })).resolves.toMatchObject({
      status: 'blocked',
      stage: 'namespace_upsert',
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      last_error_code: 'project_storage_bootstrap_failed',
    });
  });

  it('keeps project create response stable when project storage bootstrap records an AFSCP failure internally', async () => {
    const deps = createDefaultNodeApiDeps();
    const namespaceStore = new ProjectAfscpNamespaceStore(deps.docStore);
    const resourceOwnershipStore = new ProjectAfscpResourceOwnershipStore(deps.docStore);
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new AfscpClientError({
          status: 503,
          code: 'unavailable',
          message: 'unavailable',
          retryable: true,
          correlation_id: 'req-project-bootstrap-afscp-failed',
          operation_id: 'op_namespace_failed',
        });
      },
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    deps.projectAfscpNamespaceStore = namespaceStore;
    deps.projectStorageBootstrapService = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: {
        upsertNamespace,
        putNamespaceVolumeBinding,
        getOperation: vi.fn(),
      },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      orchestratorCallerService: 'agentsmith-sandbox-manager',
      correlationIdFactory: () => 'corr-generated',
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-project-bootstrap-afscp-failed',
      },
      body: JSON.stringify({
        name: 'Storage Failure Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });

    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { id: string; name: string };
    expect(body.name).toBe('Storage Failure Project');
    expect(JSON.stringify(body)).not.toContain('svc-secret-token');
    expect(JSON.stringify(body)).not.toContain('/internal/v1');
    expect(upsertNamespace).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: 'user', id: 'user_test' },
      correlationId: 'req-project-bootstrap-afscp-failed',
    }));
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: body.id,
    })).resolves.toMatchObject({
      status: 'pending',
      stage: 'namespace_upsert',
      next_action: 'retry_now',
      retryable: true,
      namespace_upsert_operation_id: 'op_namespace_failed',
      volume_binding_operation_id: null,
      last_error_code: 'unavailable',
    });

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${body.id}`);
    expect(getRes.status).toBe(200);
  });

  it('returns admin permissions for configured project admins', async () => {
    const deps = createDefaultNodeApiDeps();
    const created = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_external',
      input: {
        name: 'Admin Shared Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    await setProjectAdminGroupMembersPersisted({
      docStore: deps.docStore,
      workspaceId: 'ws_default',
      projectId: created.id,
      memberIds: ['user_test'],
    });
    const { baseUrl } = startServerWithDeps(deps);

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as {
      owner_id: string;
      admin_member_ids?: string[];
      groups?: Array<{ id: string; system_key?: string }>;
      permissions: string[];
      membership_status: 'active' | 'pending' | 'suspended' | 'none';
    };
    expect(got.owner_id).toBe('user_external');
    expect(got.admin_member_ids).toContain('user_test');
    expect(got.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'grp_project_admins', system_key: 'admins' }),
      ]),
    );
    expect(got.permissions).toContain('project:endpoint:use');
    expect(got.permissions).toContain('project:agent_runner:manage');
    expect(got.permissions).toContain('project:governance:update');
    expect(got.membership_status).toBe('active');

    const listRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{
        id: string;
        admin_member_ids?: string[];
        groups?: Array<{ id: string; system_key?: string }>;
        permissions: string[];
        membership_status: 'active' | 'pending' | 'suspended' | 'none';
      }>;
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed?.admin_member_ids).toContain('user_test');
    expect(listed?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'grp_project_admins', system_key: 'admins' }),
      ]),
    );
    expect(listed?.permissions).toContain('project:governance:update');
    expect(listed?.membership_status).toBe('active');
  });

  it('lets workspace governance admins list private non-member projects through the governable projects route', async () => {
    const deps = createDefaultNodeApiDeps();
    const created = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_secret',
      input: {
        name: 'Governance Recovery Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const discoverableRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'owner-token');
    expect(discoverableRes.status).toBe(200);
    const discoverableBody = (await discoverableRes.json()) as { items: Array<{ id: string }> };
    expect(discoverableBody.items.find((item) => item.id === created.id)).toBeUndefined();

    const governanceRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/governable-projects',
      'owner-token',
    );
    expect(governanceRes.status).toBe(200);
    const governanceBody = (await governanceRes.json()) as {
      items: Array<{ id: string; owner_id: string; permissions: string[]; membership_status: string }>;
    };
    expect(governanceBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          owner_id: 'user_secret',
          permissions: [],
          membership_status: 'none',
        }),
      ]),
    );
  });

  it('rejects the governable projects route for actors without workspace governance permission', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/governable-projects',
      'member-token',
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error_code: 'PERMISSION_DENIED',
      message: 'workspace_governance_update_required',
    });
  });

  it('returns validation error for invalid payload', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('VALIDATION_ERROR');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown project id', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('project_not_found');
  });
});
