import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  AfscpFileLibraryStorageAdapter,
  JsonDocProjectFileLibraryAfscpMappingRepo,
} from './file-library-afscp-storage.js';
import { AfscpClientError, mapAfscpErrorEnvelope } from './afscp-error-mapper.js';
import {
  PROJECT_AFSCP_NAMESPACE_COLLECTION,
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';
import type { AfscpProductClientPort } from './afscp-client.js';

const repoOperation = {
  operation_id: 'op_repo_create',
  operation_state: 'queued',
  resource: { type: 'repo', id: 'repo_flib_123' },
  result: null,
  error: null,
};

const succeededRepoOperation = {
  operation_id: 'op_repo_create',
  operation_type: 'repo_create',
  operation_state: 'succeeded',
  phase: 'done',
  attempt: 1,
  lease_owner: null,
  lease_expires_at: null,
  idempotency_scope: 'agentsmith-api:ns_project_1:repo_create',
  idempotency_key: 'file-library:flib_123:create-repo',
  request_hash: 'hash',
  correlation_id: 'req_create',
  caller_service: 'agentsmith-api',
  authorized_actor: { type: 'user', id: 'user_1' },
  resource: { type: 'repo', id: 'repo_flib_123' },
  namespace_id: 'ns_project_1',
  repo_id: 'repo_flib_123',
  template_id: null,
  export_id: null,
  mount_binding_id: null,
  session_fence_id: null,
  external_resource_ids: {},
  input_summary: {},
  verification_result: null,
  compensation_status: null,
  error: null,
  created_at: '2026-05-09T00:00:00.000Z',
  started_at: '2026-05-09T00:00:00.000Z',
  finished_at: '2026-05-09T00:00:01.000Z',
};

type LegacyRestoreAdmissionClient = {
  admitRestoreRepo: ReturnType<typeof vi.fn>;
};

function createProductClient(
  overrides: Partial<AfscpProductClientPort & LegacyRestoreAdmissionClient> = {},
): AfscpProductClientPort & LegacyRestoreAdmissionClient {
  return {
    createRepo: vi.fn(async () => repoOperation),
    listRepos: vi.fn(async () => ({ repos: [] })),
    getRepo: vi.fn(async () => ({
      repo_id: 'repo_flib_123',
      namespace_id: 'ns_project_1',
      volume_id: 'vol_shared',
      repo_kind: 'repo',
      status: 'active',
      lifecycle: {
        status: 'active',
        retention_expires_at: null,
        last_lifecycle_operation_id: null,
      },
      created_at: '2026-05-09T00:00:00.000Z',
    })),
    listSavePoints: vi.fn(async () => ({
      save_points: [
        {
          save_point_id: 'sp_user_001',
          repo_id: 'repo_flib_123',
          message: 'User checkpoint',
          created_at: '2026-05-09T00:00:00.000Z',
        },
      ],
    })),
    createSavePoint: vi.fn(async () => ({
      operation_id: 'op_save_point',
      operation_state: 'queued',
      resource: { type: 'repo', id: 'repo_flib_123' },
      result: null,
      error: null,
    })),
    admitRestoreRepo: vi.fn(async () => ({
      admitted: true,
      repo_id: 'repo_flib_123',
      save_point_id: 'sp_user_001',
      operation_type: 'restore',
    })),
    restoreRepo: vi.fn(async () => ({
      operation_id: 'op_restore_direct',
      operation_state: 'queued',
      resource: { type: 'repo', id: 'repo_flib_123' },
      result: null,
      error: null,
    })),
    createRepoTemplate: vi.fn(async () => ({
      operation_id: 'op_template_create',
      operation_state: 'queued',
      resource: { type: 'repo_template', id: 'tmpl_template_1' },
      result: null,
      error: null,
    })),
    cloneRepoTemplate: vi.fn(async () => ({
      operation_id: 'op_template_clone',
      operation_state: 'queued',
      resource: { type: 'repo', id: 'repo_clone_1' },
      result: null,
      error: null,
    })),
    deleteRepo: vi.fn(async () => ({
      operation_id: 'op_repo_delete',
      operation_state: 'succeeded',
      resource: { type: 'repo', id: 'repo_flib_123' },
      result: null,
      error: null,
    })),
    createExport: vi.fn(async () => ({
      operation_id: 'op_export_create',
      operation_state: 'succeeded',
      resource: { type: 'export', id: 'export_flib_123' },
      result: {
        export: {
          export_id: 'export_flib_123',
          namespace_id: 'ns_project_1',
          repo_id: 'repo_flib_123',
          protocol: 'webdav',
          mode: 'read_write',
          status: 'active',
          created_by_caller_service: 'agentsmith-api',
          created_by_actor: { type: 'user', id: 'user_1' },
          created_at: '2026-05-09T00:00:00.000Z',
          updated_at: '2026-05-09T00:00:00.000Z',
          expires_at: '2026-05-09T01:00:00.000Z',
          revoked_at: null,
          last_accessed_at: null,
          active_request_count: 0,
          active_write_count: 0,
          last_observed_at: null,
          last_gateway_heartbeat_at: null,
          gateway_heartbeat_expires_at: null,
          write_drained_at: null,
          terminal_observed_at: null,
          status_reason: '',
        },
        access: {
          url: 'https://files.example.test/e/export_flib_123/',
          auth: {
            type: 'basic',
            username: 'export_flib_123',
            password: 'one-time-webdav-secret',
          },
          mode: 'read_write',
          expires_at: '2026-05-09T01:00:00.000Z',
        },
      },
      error: null,
    })),
    getExport: vi.fn(async () => ({})),
    revokeExport: vi.fn(async () => ({
      operation_id: 'op_export_revoke',
      operation_state: 'queued',
      resource: { type: 'export', id: 'export_flib_123' },
      result: null,
      error: null,
    })),
    getOperation: vi.fn(async () => succeededRepoOperation),
    pollOperation: vi.fn(async () => succeededRepoOperation),
    ...overrides,
  } as AfscpProductClientPort & LegacyRestoreAdmissionClient;
}

async function markNamespaceReady(input: {
  docStore: InMemoryJsonDocStore;
  namespaceStore: ProjectAfscpNamespaceStore;
  workspaceId?: string;
  projectId?: string;
  namespaceId?: string;
}): Promise<void> {
  const workspaceId = input.workspaceId ?? 'ws_default';
  const projectId = input.projectId ?? 'proj_1';
  const ready = await input.namespaceStore.markProjectNamespaceReady({
    workspaceId,
    projectId,
    namespaceUpsertOperationId: 'op_namespace_ready',
    volumeBindingOperationId: 'op_binding_ready',
  });
  await input.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, ready.id, {
    ...ready,
    namespace_id: input.namespaceId ?? 'ns_project_1',
  });
}

async function createMappedAdapter(input: {
  client?: AfscpProductClientPort;
  fetchFn?: typeof fetch;
  projectStorageGeneration?: number;
} = {}): Promise<{
  docStore: InMemoryJsonDocStore;
  client: AfscpProductClientPort;
  mappingRepo: JsonDocProjectFileLibraryAfscpMappingRepo;
  namespaceStore: ProjectAfscpNamespaceStore;
  ownershipStore: ProjectAfscpResourceOwnershipStore;
  adapter: AfscpFileLibraryStorageAdapter;
}> {
  const docStore = new InMemoryJsonDocStore();
  const client = input.client ?? createProductClient();
  const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
  const namespaceStore = new ProjectAfscpNamespaceStore(docStore);
  const ownershipStore = new ProjectAfscpResourceOwnershipStore(docStore);
  await markNamespaceReady({ docStore, namespaceStore });
  await mappingRepo.saveReady({
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    libraryId: 'flib_123',
    namespaceId: 'ns_project_1',
    repoId: 'repo_flib_123',
    projectStorageGeneration: input.projectStorageGeneration ?? 1,
    operationId: 'op_repo_create',
  });
  const adapter = new AfscpFileLibraryStorageAdapter({
    client,
    mappingRepo,
    projectAfscpNamespaceStore: namespaceStore,
    resourceOwnershipStore: ownershipStore,
    fetchFn: input.fetchFn ?? (vi.fn() as unknown as typeof fetch),
  });
  return {
    docStore,
    client,
    mappingRepo,
    namespaceStore,
    ownershipStore,
    adapter,
  };
}

describe('AFSCP File Library storage adapter', () => {
  it('creates a repo, stores only internal AFSCP mapping, and maps repo/operation ownership', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient();
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore);
    const ownershipStore = new ProjectAfscpResourceOwnershipStore(docStore);
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: namespaceStore,
      resourceOwnershipStore: ownershipStore,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    const result = await adapter.createRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      actorUserId: 'user_1',
      requestId: 'req_create',
    });

    expect(result).toMatchObject({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      operationId: 'op_repo_create',
      operationStatus: 'succeeded',
    });
    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toMatchObject({
      library_id: 'flib_123',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_flib_123',
      project_storage_generation: 1,
      operation_id: 'op_repo_create',
      operation_status: 'succeeded',
    });
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'repo',
      resourceId: 'repo_flib_123',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      namespace_id: 'ns_project_1',
    });
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'operation',
      resourceId: 'op_repo_create',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      namespace_id: 'ns_project_1',
    });

    const serializedDocs = JSON.stringify(await docStore.list('project_file_library_afscp_mappings'));
    expect(serializedDocs).not.toContain('one-time-webdav-secret');
    expect(serializedDocs).not.toContain('metadata_url');
    expect(serializedDocs).not.toContain('bucket');
    expect(serializedDocs).not.toContain('postgres://');
  });

  it('projects owned operation records with namespace visibility and redacts raw AFSCP details', async () => {
    const richOperation = {
      ...succeededRepoOperation,
      operation_id: 'op_repo_create',
      operation_type: 'repo_create',
      operation_state: 'succeeded',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_flib_123',
      result: {
        metadata_url: 'postgres://user:svc-secret-token@db/juicefs',
        path: '/var/lib/juicefs/ns_project_1/repo_flib_123',
        access: {
          url: 'https://files.example.test/e/export_flib_123/',
          auth: {
            type: 'basic',
            username: 'export_flib_123',
            password: 'one-time-webdav-secret',
          },
        },
      },
      input_summary: {
        run_command: 'mount.juicefs --token svc-secret-token',
        secret_ref: 'Secret/afscp/metadata',
      },
      verification_result: {
        stdout: 'mounted /var/lib/juicefs/ns_project_1',
        stderr: 'password=one-time-webdav-secret',
      },
    };
    const client = createProductClient({
      getOperation: vi.fn(async () => richOperation),
    });
    const { ownershipStore, adapter } = await createMappedAdapter({ client });
    await ownershipStore.ensureResourceOwnership({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      resourceKind: 'operation',
      resourceId: 'op_repo_create',
      namespaceId: 'ns_project_1',
    });

    const projection = await adapter.getOperationProjection({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_repo_create',
      requestId: 'req_projection',
    });

    expect(client.getOperation).toHaveBeenCalledWith({
      operationId: 'op_repo_create',
      correlationId: 'req_projection',
      signal: undefined,
    });
    expect(projection).toMatchObject({
      operation_id: 'op_repo_create',
      operation_state: 'succeeded',
      operation_type: 'repo_create',
      resource: { type: 'repo' },
      error: null,
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('ns_project_1');
    expect(serialized).not.toContain('repo_flib_123');
    expect(serialized).not.toContain('metadata_url');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('/var/lib/juicefs');
    expect(serialized).not.toContain('one-time-webdav-secret');
    expect(serialized).not.toContain('run_command');
    expect(serialized).not.toContain('Secret/afscp');
    expect(serialized).not.toContain('stdout');
  });

  it('keeps terminal save point ids internal on operation projections for public-id mapping', async () => {
    const client = createProductClient({
      getOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_save_point_terminal',
        operation_type: 'save_point_create',
        resource: { type: 'repo', id: 'repo_flib_123' },
        verification_result: { save_point_id: 'sp_raw_terminal_result' },
      })),
    });
    const { ownershipStore, adapter } = await createMappedAdapter({ client });
    await ownershipStore.ensureResourceOwnership({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      resourceKind: 'operation',
      resourceId: 'op_save_point_terminal',
      namespaceId: 'ns_project_1',
    });

    const projection = await adapter.getOperationProjection({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_save_point_terminal',
      requestId: 'req_save_point_terminal_projection',
    });

    expect(projection.resultSavePointId).toBe('sp_raw_terminal_result');
    expect(JSON.stringify(projection)).not.toContain('sp_raw_terminal_result');
  });

  it('hides operation projection for cross-project ownership before calling AFSCP', async () => {
    const client = createProductClient({
      getOperation: vi.fn(async () => succeededRepoOperation),
    });
    const { docStore, namespaceStore, ownershipStore, adapter } = await createMappedAdapter({ client });
    await markNamespaceReady({
      docStore,
      namespaceStore,
      workspaceId: 'ws_default',
      projectId: 'proj_other',
      namespaceId: 'ns_other',
    });
    await ownershipStore.ensureResourceOwnership({
      workspaceId: 'ws_default',
      projectId: 'proj_other',
      resourceKind: 'operation',
      resourceId: 'op_hidden_elsewhere',
      namespaceId: 'ns_other',
    });

    await expect(adapter.getOperationProjection({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_hidden_elsewhere',
      requestId: 'req_hidden',
    })).rejects.toThrow('file_library_operation_not_found');
    expect(client.getOperation).not.toHaveBeenCalled();
  });

  it('keeps operation projection visible for tombstoned project namespace mappings', async () => {
    const client = createProductClient({
      getOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_delete',
        operation_type: 'repo_delete',
      })),
    });
    const { namespaceStore, ownershipStore, adapter } = await createMappedAdapter({ client });
    await ownershipStore.ensureResourceOwnership({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      resourceKind: 'operation',
      resourceId: 'op_repo_delete',
      namespaceId: 'ns_project_1',
    });
    await namespaceStore.markProjectNamespaceDeleting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      lastErrorCode: null,
    });
    await namespaceStore.markProjectNamespaceTombstoned({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    await expect(adapter.getOperationProjection({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_repo_delete',
      requestId: 'req_tombstoned_projection',
    })).resolves.toMatchObject({
      operation_id: 'op_repo_delete',
      operation_state: 'succeeded',
      operation_type: 'repo_delete',
    });
  });

  it('requires explicit project storage generation when creating a repo', () => {
    const docStore = new InMemoryJsonDocStore();
    const adapter = new AfscpFileLibraryStorageAdapter({
      client: createProductClient(),
      mappingRepo: new JsonDocProjectFileLibraryAfscpMappingRepo(docStore),
      projectAfscpNamespaceStore: new ProjectAfscpNamespaceStore(docStore),
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    if (false) {
      void adapter.createRepoForLibrary({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        namespaceId: 'ns_project_1',
        // @ts-expect-error projectStorageGeneration is a required guard, never a default.
        actorUserId: 'user_1',
      });
    }

    expect(adapter.enabled).toBe(true);
  });

  it('keeps a repo create operation anchor when terminal polling does not succeed', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient({
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_create_pending',
        operation_state: 'running',
      })),
    });
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore);
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: namespaceStore,
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(adapter.createRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 7,
      actorUserId: 'user_1',
      requestId: 'req_create_pending',
    })).rejects.toThrow('file_library_repo_create_pending');

    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toMatchObject({
      library_id: 'flib_123',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_flib_123',
      project_storage_generation: 7,
      operation_id: 'op_repo_create_pending',
      operation_status: 'pending',
    });
  });

  it('persists repo create failure details as sanitized operation state instead of losing the mapping', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient({
      pollOperation: vi.fn(async () => {
        throw new Error('poll failed token=svc-secret-token metadata_url=postgres://db');
      }),
    });
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore);
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: namespaceStore,
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(adapter.createRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 3,
      actorUserId: 'user_1',
      requestId: 'req_create_failed',
    })).rejects.toThrow('file_library_repo_create_failed');

    const mapping = await mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123');
    expect(mapping).toMatchObject({
      operation_id: 'op_repo_create',
      operation_status: 'failed',
      last_error_code: 'file_library_repo_create_failed',
      project_storage_generation: 3,
    });
    expect(JSON.stringify(mapping)).not.toContain('svc-secret-token');
    expect(JSON.stringify(mapping)).not.toContain('metadata_url');
  });

  it('polls repo delete to terminal success before removing the mapping', async () => {
    const client = createProductClient({
      deleteRepo: vi.fn(async () => ({
        operation_id: 'op_repo_delete',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_flib_123' },
        result: null,
        error: null,
      })),
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_delete',
        operation_state: 'succeeded',
      })),
    });
    const { mappingRepo, ownershipStore, adapter } = await createMappedAdapter({ client });

    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_success',
      reason: 'file_library_delete',
    })).resolves.toBeUndefined();

    expect(client.pollOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_repo_delete',
    }));
    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toBeNull();
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'operation',
      resourceId: 'op_repo_delete',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      namespace_id: 'ns_project_1',
    });
  });

  it('keeps the mapping and delete operation anchor when repo delete remains pending', async () => {
    const client = createProductClient({
      deleteRepo: vi.fn(async () => ({
        operation_id: 'op_repo_delete_pending',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_flib_123' },
        result: null,
        error: null,
      })),
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_delete_pending',
        operation_state: 'running',
      })),
    });
    const { mappingRepo, adapter } = await createMappedAdapter({ client });

    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_pending',
      reason: 'file_library_delete',
    })).rejects.toThrow('file_library_repo_delete_pending');
    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_pending_probe',
      reason: 'file_library_delete',
    })).rejects.toMatchObject({
      name: 'FileLibraryStorageOperationPendingError',
      operationId: 'op_repo_delete_pending',
    });

    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toMatchObject({
      operation_id: 'op_repo_delete_pending',
      operation_status: 'pending',
      repo_id: 'repo_flib_123',
    });
  });

  it('fails repo delete when AFSCP reports pending without an operation id', async () => {
    const client = createProductClient({
      deleteRepo: vi.fn(async () => ({
        operation_id: null as unknown as string,
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_flib_123' },
        result: null,
        error: null,
      })),
      pollOperation: vi.fn(),
    });
    const { mappingRepo, adapter } = await createMappedAdapter({ client });

    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_pending_without_operation_id',
      reason: 'file_library_delete',
    })).rejects.toThrow('file_library_repo_delete_failed');

    expect(client.pollOperation).not.toHaveBeenCalled();
    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toMatchObject({
      operation_id: null,
      operation_status: 'failed',
      last_error_code: 'file_library_repo_delete_failed',
      repo_id: 'repo_flib_123',
    });
  });

  it('marks repo delete operator intervention as a terminal failed operation', async () => {
    const client = createProductClient({
      deleteRepo: vi.fn(async () => ({
        operation_id: 'op_repo_delete_control',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_flib_123' },
        result: null,
        error: null,
      })),
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_delete_control',
        operation_type: 'repo_delete',
        operation_state: 'operator_intervention_required',
        resource: { type: 'repo', id: 'repo_flib_123' },
        error: { code: 'operator_intervention_required', retryable: false },
      })),
    });
    const { mappingRepo, adapter } = await createMappedAdapter({ client });

    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_control',
      reason: 'file_library_delete',
    })).rejects.toThrow('file_library_repo_delete_failed');

    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toMatchObject({
      operation_id: 'op_repo_delete_control',
      operation_status: 'failed',
      last_error_code: 'operator_intervention_required',
      repo_id: 'repo_flib_123',
    });
  });

  it('reconciles a stored pending repo delete operation before issuing another delete mutation', async () => {
    const client = createProductClient({
      deleteRepo: vi.fn(async () => {
        throw new Error('delete should not be called while pending operation can be reconciled');
      }),
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_repo_delete_pending',
        operation_type: 'repo_delete',
        operation_state: 'succeeded',
      })),
    });
    const { mappingRepo, adapter } = await createMappedAdapter({ client });
    await mappingRepo.updateOperation({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      operationId: 'op_repo_delete_pending',
      operationStatus: 'pending',
    });

    await expect(adapter.deleteRepoForLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_delete_reconcile',
      reason: 'file_library_delete',
    })).resolves.toBeUndefined();

    expect(client.deleteRepo).not.toHaveBeenCalled();
    expect(client.pollOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_repo_delete_pending',
    }));
    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_123')).resolves.toBeNull();
  });

  it('uses one-time WebDAV export credentials internally for file writes and revokes them without persisting secrets', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient();
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore);
    await markNamespaceReady({ docStore, namespaceStore });
    await mappingRepo.saveReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      projectStorageGeneration: 1,
      operationId: 'op_repo_create',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 404 });
      }
      expect(String(input)).toBe('https://files.example.test/e/export_flib_123/docs/hello.txt');
      expect(init?.method).toBe('PUT');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('export_flib_123:one-time-webdav-secret', 'utf8').toString('base64')}`,
      );
      return new Response(null, {
        status: 201,
        headers: {
          ETag: '"etag-upload"',
          'Last-Modified': 'Sat, 09 May 2026 00:00:00 GMT',
        },
      });
    }) as unknown as typeof fetch;
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: namespaceStore,
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: fetchMock,
    });

    await expect(adapter.uploadObject({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_1',
      requestId: 'req_upload',
      objectPath: 'docs/hello.txt',
      contentType: 'text/plain',
      overwrite: false,
      body: Readable.toWeb(Readable.from(['hello'])) as unknown as ReadableStream<Uint8Array>,
    })).resolves.toMatchObject({
      kind: 'file',
      path: 'docs/hello.txt',
      name: 'hello.txt',
      content_type: 'text/plain',
      etag: '"etag-upload"',
    });

    expect(client.createExport).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      mode: 'read_write',
    }));
    expect(client.revokeExport).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      exportId: 'export_flib_123',
    }));
    const serializedDocs = JSON.stringify(await docStore.list('project_file_library_afscp_mappings'));
    expect(serializedDocs).not.toContain('one-time-webdav-secret');
    expect(serializedDocs).not.toContain('https://files.example.test');
  });

  it('classifies WebDAV collection entries with namespace attributes as directories', async () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<D:multistatus xmlns:D="DAV:">',
      '<D:response>',
      '<D:href>/</D:href>',
      '<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype></D:prop></D:propstat>',
      '</D:response>',
      '<D:response>',
      '<D:href>/docs/</D:href>',
      '<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype><D:displayname>docs</D:displayname></D:prop></D:propstat>',
      '</D:response>',
      '</D:multistatus>',
    ].join('');
    const fetchMock = vi.fn(async () => new Response(xml, {
      status: 207,
      headers: { 'Content-Type': 'application/xml' },
    })) as unknown as typeof fetch;
    const { adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: '',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list',
    })).resolves.toMatchObject({
      path: '',
      items: [
        {
          kind: 'directory',
          path: 'docs/',
          name: 'docs',
        },
      ],
      nextContinuationToken: null,
    });
  });

  it('continues WebDAV listings after the continuation token instead of replaying the first page', async () => {
    const fileResponse = (path: string) => [
      '<D:response>',
      `<D:href>/${path}</D:href>`,
      '<D:propstat><D:prop>',
      '<D:getcontentlength>1</D:getcontentlength>',
      '<D:getcontenttype>text/plain</D:getcontenttype>',
      '<D:getlastmodified>Sat, 09 May 2026 00:00:00 GMT</D:getlastmodified>',
      '</D:prop></D:propstat>',
      '</D:response>',
    ].join('');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<D:multistatus xmlns:D="DAV:">',
      '<D:response>',
      '<D:href>/</D:href>',
      '<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype></D:prop></D:propstat>',
      '</D:response>',
      fileResponse('docs/a.txt'),
      fileResponse('docs/b.txt'),
      fileResponse('docs/c.txt'),
      fileResponse('docs/d.txt'),
      '</D:multistatus>',
    ].join('');
    const fetchMock = vi.fn(async () => new Response(xml, {
      status: 207,
      headers: { 'Content-Type': 'application/xml' },
    })) as unknown as typeof fetch;
    const { adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    const firstPage = await adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: '',
      pageSize: 2,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list_page_1',
    });
    const secondPage = await adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: '',
      pageSize: 2,
      continuationToken: firstPage.nextContinuationToken ?? undefined,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list_page_2',
    });

    expect(firstPage.items.map((item) => item.path)).toEqual(['docs/a.txt', 'docs/b.txt']);
    expect(firstPage.nextContinuationToken).toBe('docs/b.txt');
    expect(secondPage.items.map((item) => item.path)).toEqual(['docs/c.txt', 'docs/d.txt']);
    expect(secondPage.nextContinuationToken).toBeNull();
  });

  it('retries a read export listing when the WebDAV collection is not visible yet', async () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<D:multistatus xmlns:D="DAV:">',
      '<D:response>',
      '<D:href>/workspace/.artifacts/</D:href>',
      '<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype></D:prop></D:propstat>',
      '</D:response>',
      '<D:response>',
      '<D:href>/workspace/.artifacts/post-restore.txt</D:href>',
      '<D:propstat><D:prop>',
      '<D:getcontentlength>19</D:getcontentlength>',
      '<D:getcontenttype>text/plain</D:getcontenttype>',
      '<D:getlastmodified>Sat, 09 May 2026 00:00:00 GMT</D:getlastmodified>',
      '</D:prop></D:propstat>',
      '</D:response>',
      '</D:multistatus>',
    ].join('');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml' },
      })) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: 'workspace/.artifacts/',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list_after_writer_release',
    })).resolves.toMatchObject({
      path: 'workspace/.artifacts/',
      items: [
        {
          kind: 'file',
          path: 'workspace/.artifacts/post-restore.txt',
          name: 'post-restore.txt',
        },
      ],
      nextContinuationToken: null,
    });

    expect(client.createExport).toHaveBeenCalledTimes(2);
    expect(client.revokeExport).toHaveBeenCalledTimes(2);
  });

  it('retries a read export listing when AFSCP reports a repo mutation in progress', async () => {
    const client = createProductClient();
    vi.mocked(client.createExport).mockRejectedValueOnce(new AfscpClientError(mapAfscpErrorEnvelope(409, {
      error: {
        code: 'REPO_JVS_MUTATION_IN_PROGRESS',
        message: 'repo mutation is in progress',
        retryable: true,
        correlation_id: 'corr_list_busy',
        operation_id: 'op_list_busy',
        details: {
          resource: { type: 'repo', id: 'repo_flib_123' },
        },
      },
    })));
    const fetchMock = vi.fn(async () => new Response([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<D:multistatus xmlns:D="DAV:">',
      '<D:response>',
      '<D:href>/workspace/.artifacts/</D:href>',
      '<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype></D:prop></D:propstat>',
      '</D:response>',
      '<D:response>',
      '<D:href>/workspace/.artifacts/restored.svg</D:href>',
      '<D:propstat><D:prop><D:getcontentlength>42</D:getcontentlength><D:getlastmodified>Sat, 09 May 2026 00:00:00 GMT</D:getlastmodified></D:prop></D:propstat>',
      '</D:response>',
      '</D:multistatus>',
    ].join(''), {
      status: 207,
      headers: { 'Content-Type': 'application/xml' },
    })) as unknown as typeof fetch;
    const { adapter } = await createMappedAdapter({ client, fetchFn: fetchMock });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: 'workspace/.artifacts/',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list_repo_busy',
    })).resolves.toMatchObject({
      items: [
        {
          kind: 'file',
          path: 'workspace/.artifacts/restored.svg',
          name: 'restored.svg',
        },
      ],
    });

    expect(client.createExport).toHaveBeenCalledTimes(2);
    expect(client.revokeExport).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('does not retry a WebDAV %s list permission failure', async (status) => {
    const fetchMock = vi.fn(async () => new Response(status === 401 ? 'unauthorized' : 'forbidden', {
      status,
    })) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: 'workspace/.artifacts/',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: `req_list_permission_${status}`,
    })).rejects.toThrow('file_library_storage_admin_action_required');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.createExport).toHaveBeenCalledTimes(1);
    expect(client.revokeExport).toHaveBeenCalledTimes(1);
  });

  it('does not retry a generic WebDAV list failure', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream error', {
      status: 500,
    })) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: 'workspace/.artifacts/',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      requestId: 'req_list_generic_failure',
    })).rejects.toThrow('file_library_list_failed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.createExport).toHaveBeenCalledTimes(1);
    expect(client.revokeExport).toHaveBeenCalledTimes(1);
  });

  it('releases WebDAV export credentials only after a download stream finishes', async () => {
    const fetchMock = vi.fn(async () => new Response(
      Readable.toWeb(Readable.from(['hello world'])) as unknown as BodyInit,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': '11',
          'Last-Modified': 'Sat, 09 May 2026 00:00:00 GMT',
        },
      },
    )) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    const result = await adapter.downloadObject({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      objectPath: 'docs/hello.txt',
      requestId: 'req_download',
    });

    expect(client.createExport).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'read_only',
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
    }));
    expect(client.revokeExport).not.toHaveBeenCalled();

    result.download.stream.resume();
    await finished(result.download.stream);
    await vi.waitFor(() => expect(client.revokeExport).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      exportId: 'export_flib_123',
    })));
  });

  it('retries a read export download when a just-released writer is not visible yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(
        Readable.toWeb(Readable.from(['durable writer content'])) as unknown as BodyInit,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': '22',
            'Last-Modified': 'Sat, 09 May 2026 00:00:00 GMT',
          },
        },
      )) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    const result = await adapter.downloadObject({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      objectPath: 'docs/from-terminal.txt',
      requestId: 'req_download_after_writer_release',
    });

    expect(client.createExport).toHaveBeenCalledTimes(2);
    expect(client.revokeExport).toHaveBeenCalledTimes(1);
    expect(client.revokeExport).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      exportId: 'export_flib_123',
    }));
    expect(result.meta.size_bytes).toBe(22);

    result.download.stream.resume();
    await finished(result.download.stream);
    await vi.waitFor(() => expect(client.revokeExport).toHaveBeenCalledTimes(2));
  });

  it('admits save point creation without polling terminal clone state or persisting raw ids in public state', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_save_point',
        operation_type: 'save_point_create',
        operation_state: 'succeeded',
        external_resource_ids: { save_point_id: 'sp_user_002' },
      })),
    });
    const { adapter, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.listSavePoints({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      requestId: 'req_save_point_list',
    })).resolves.toEqual([
      {
        savePointId: 'sp_user_001',
        repoId: 'repo_flib_123',
        message: 'User checkpoint',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
    ]);

    await expect(adapter.createSavePoint({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      message: 'Before risky change',
      actorUserId: 'user_1',
      idempotencyKey: 'save-point-key-1',
      requestId: 'req_save_point_create',
    })).resolves.toMatchObject({
      operationId: 'op_save_point',
      operationStatus: 'pending',
      savePointId: null,
    });
    expect(client.pollOperation).not.toHaveBeenCalled();

    expect(client.createSavePoint).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      message: 'Before risky change',
      idempotencyKey: 'save-point-key-1',
      actor: { type: 'user', id: 'user_1' },
    }));
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'operation',
      resourceId: 'op_save_point',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: 'sp_user_002',
    })).resolves.toBeNull();
  });

  it('does not surface AFSCP template source save points as user restore points', async () => {
    const client = createProductClient({
      listSavePoints: vi.fn(async () => ({
        save_points: [
          {
            save_point_id: 'sp_template_source_001',
            repo_id: 'repo_flib_123',
            message: 'Template source: Release starter',
            created_at: '2026-05-09T00:00:00.000Z',
            purpose: 'template_source',
          },
          {
            save_point_id: 'sp_user_001',
            repo_id: 'repo_flib_123',
            message: 'User checkpoint',
            created_at: '2026-05-09T00:01:00.000Z',
            purpose: 'user',
          },
        ],
      })),
    });
    const { adapter } = await createMappedAdapter({ client });

    await expect(adapter.listSavePoints({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      requestId: 'req_save_point_list_template_source',
    })).resolves.toEqual([
      {
        savePointId: 'sp_user_001',
        repoId: 'repo_flib_123',
        message: 'User checkpoint',
        createdAt: '2026-05-09T00:01:00.000Z',
      },
    ]);
  });

  it('preserves typed AFSCP save point list errors instead of collapsing them to list failed', async () => {
    const client = createProductClient({
      listSavePoints: vi.fn(async () => {
        throw new AfscpClientError({
          status: 503,
          code: 'afscp_operator_recovery_required',
          message: 'afscp_operator_recovery_required',
          retryable: false,
          correlation_id: 'corr_save_point_operator',
          operation_id: 'op_save_point_list_failed_hidden',
          resource_kind: 'operation',
        });
      }),
    });
    const { adapter } = await createMappedAdapter({ client });

    await expect(adapter.listSavePoints({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      requestId: 'req_save_point_list_operator',
    })).rejects.toThrow('file_library_storage_admin_action_required');
  });

  it.each([
    'REPO_MUTATION_IN_PROGRESS',
    'REPO_JVS_MUTATION_IN_PROGRESS',
  ] as const)('maps AFSCP save point list %s conflicts to pending instead of list failed', async (afscpCode) => {
    const client = createProductClient({
      listSavePoints: vi.fn(async () => {
        const mapped = mapAfscpErrorEnvelope(409, {
          error: {
            code: afscpCode,
            message: afscpCode === 'REPO_JVS_MUTATION_IN_PROGRESS'
              ? 'repo JVS mutation is in progress'
              : 'repo repo_hidden_elsewhere has an active mutation metadata_url=postgres://db',
            retryable: true,
            correlation_id: 'corr_save_point_list_busy',
            operation_id: 'op_repo_mutation_busy',
            details: {
              resource: { type: 'repo', id: 'repo_hidden_elsewhere' },
              namespace_id: 'ns_hidden',
              metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
            },
          },
        });
        expect(mapped.code).toBe('afscp_repo_mutation_in_progress');
        throw new AfscpClientError(mapped);
      }),
    });
    const { adapter } = await createMappedAdapter({ client });

    let caught: unknown;
    try {
      await adapter.listSavePoints({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        requestId: 'req_save_point_list_busy',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('file_library_save_point_list_pending');
    expect(JSON.stringify(caught)).not.toMatch(/file_library_save_point_list_failed|REPO_JVS_MUTATION_IN_PROGRESS|repo JVS mutation is in progress|repo_hidden_elsewhere|ns_hidden|metadata_url|postgres|corr_save_point_list_busy|op_repo_mutation_busy/);
  });

  it.each([
    'REPO_MUTATION_IN_PROGRESS',
    'REPO_JVS_MUTATION_IN_PROGRESS',
  ] as const)('maps AFSCP save point create %s conflicts to pending instead of create failed', async (afscpCode) => {
    const client = createProductClient({
      createSavePoint: vi.fn(async () => {
        const mapped = mapAfscpErrorEnvelope(409, {
          error: {
            code: afscpCode,
            message: afscpCode === 'REPO_JVS_MUTATION_IN_PROGRESS'
              ? 'repo JVS mutation is in progress'
              : 'repo repo_hidden_elsewhere has an active mutation metadata_url=postgres://db',
            retryable: true,
            correlation_id: 'corr_save_point_create_busy',
            operation_id: 'op_repo_mutation_busy',
            details: {
              resource: { type: 'repo', id: 'repo_hidden_elsewhere' },
              namespace_id: 'ns_hidden',
              metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
            },
          },
        });
        expect(mapped.code).toBe('afscp_repo_mutation_in_progress');
        throw new AfscpClientError(mapped);
      }),
    });
    const { adapter } = await createMappedAdapter({ client });

    let caught: unknown;
    try {
      await adapter.createSavePoint({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        message: 'Save point create busy fixture',
        actorUserId: 'user_1',
        idempotencyKey: 'save-point-create-busy-key',
        requestId: 'req_save_point_create_busy',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('file_library_save_point_create_pending');
    expect(JSON.stringify(caught)).not.toMatch(/file_library_save_point_create_failed|REPO_JVS_MUTATION_IN_PROGRESS|repo JVS mutation is in progress|repo_hidden_elsewhere|ns_hidden|metadata_url|postgres|corr_save_point_create_busy|op_repo_mutation_busy/);
    expect(client.pollOperation).not.toHaveBeenCalled();
  });

  it('does not wait for redacted terminal save point ids during admission', async () => {
    const savePointId = '1778481131647-4d2e0211';
    const client = createProductClient({
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_save_point_result',
        operation_type: 'save_point_create',
        operation_state: 'succeeded',
        external_resource_ids: { save_point_id: '[REDACTED]' },
        verification_result: { save_point_id: savePointId },
      })),
    });
    const { adapter, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.createSavePoint({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      message: 'Before risky change',
      actorUserId: 'user_1',
      idempotencyKey: 'save-point-result-key',
      requestId: 'req_save_point_create_result',
    })).resolves.toMatchObject({
      operationId: 'op_save_point',
      operationStatus: 'pending',
      savePointId: null,
    });
    expect(client.pollOperation).not.toHaveBeenCalled();

    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: savePointId,
    })).resolves.toBeNull();
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: '[REDACTED]',
    })).resolves.toBeNull();
  });

  it.each([
    [
      'operation.error.code',
      {
        error: {
          code: 'ACTIVE_WRITER_SESSIONS',
          message: '[REDACTED] repo_hidden_elsewhere',
          retryable: true,
          correlation_id: 'corr_save_point_busy',
          operation_id: 'op_save_point_busy',
          details: {
            repo_id: 'repo_hidden_elsewhere',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      },
    ],
    [
      'writer gate family',
      {
        error: {
          code: 'SAVE_POINT_CREATE_BLOCKED',
          message: '[REDACTED] repo_hidden_elsewhere',
          retryable: true,
          details: {
            writer_gate_error_family: 'ACTIVE_WRITER_SESSIONS',
            repo_id: 'repo_hidden_elsewhere',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      },
    ],
  ])('projects typed save point blockers from %s as an active writer blocker', async (_caseName, operationFields) => {
    const client = createProductClient({
      createSavePoint: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_save_point_busy',
        operation_type: 'save_point_create',
        operation_state: 'operator_intervention_required',
        phase: 'save_point_create_prepared',
        ...operationFields,
      })),
    });
    const { adapter } = await createMappedAdapter({ client });

    let caught: unknown;
    try {
      await adapter.createSavePoint({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        message: 'Before risky change',
        actorUserId: 'user_1',
        idempotencyKey: 'save-point-busy-key',
        requestId: 'req_save_point_busy',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('file_library_active_writer_blocked');
    expect(JSON.stringify(caught)).not.toMatch(/repo_hidden_elsewhere|corr_save_point_busy|metadata_url|postgres/);
  });

  it.each([
    [
      'error code',
      {
        error: {
          code: 'ACTIVE_WRITER_SESSIONS',
          message: 'save point failed for repo_hidden_elsewhere',
          retryable: true,
          correlation_id: 'corr_save_point_busy',
          operation_id: 'op_save_point_busy',
          details: {
            repo_id: 'repo_hidden_elsewhere',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      },
    ],
    [
      'writer gate family',
      {
        error: {
          code: 'SAVE_POINT_CREATE_BLOCKED',
          message: 'save point failed for repo_hidden_elsewhere',
          retryable: true,
          correlation_id: 'corr_save_point_busy',
          operation_id: 'op_save_point_busy',
          details: {
            writer_gate_error_family: 'ACTIVE_WRITER_SESSIONS',
            repo_id: 'repo_hidden_elsewhere',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      },
    ],
  ])('projects initial typed save point client errors from %s as an active writer blocker', async (_caseName, payload) => {
    const mapped = mapAfscpErrorEnvelope(500, payload);
    const client = createProductClient({
      createSavePoint: vi.fn(async () => {
        throw new AfscpClientError(mapped);
      }),
    });
    const { adapter } = await createMappedAdapter({ client });

    let caught: unknown;
    try {
      await adapter.createSavePoint({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        message: 'Before risky change',
        actorUserId: 'user_1',
        idempotencyKey: 'save-point-client-error-key',
        requestId: 'req_save_point_busy',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('file_library_active_writer_blocked');
    expect(JSON.stringify(caught)).not.toMatch(/repo_hidden_elsewhere|corr_save_point_busy|metadata_url|postgres/);
    expect(client.pollOperation).not.toHaveBeenCalled();
  });

  it('directly restores a save point through durable AFSCP restore once with save-point ownership anchors', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'repo_restore',
        operation_state: 'succeeded',
        external_resource_ids: {
          source_save_point_id: 'sp_user_001',
        },
        verification_result: {
          source_save_point_id: 'sp_user_001',
        },
      })),
    });
    const { adapter, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.restoreFileLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      savePointId: 'sp_user_001',
      idempotencyKey: 'restore-key-direct',
      actorUserId: 'user_1',
      requestId: 'req_restore_direct',
    })).resolves.toMatchObject({
      operationId: 'op_restore_direct',
      operationStatus: 'succeeded',
      sourceSavePointId: 'sp_user_001',
    });
    expect(client.restoreRepo).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      savePointId: 'sp_user_001',
      idempotencyKey: 'restore-key-direct',
    }));
    expect(client.restoreRepo).toHaveBeenCalledTimes(1);
    expect(client.admitRestoreRepo).not.toHaveBeenCalled();
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: 'sp_user_001',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
  });

  it('maps restore readiness failures before calling durable AFSCP restore or legacy admit', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient();
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    await mappingRepo.saveReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      projectStorageGeneration: 1,
      operationId: 'op_repo_create',
    });
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: new ProjectAfscpNamespaceStore(docStore),
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(adapter.restoreFileLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      savePointId: 'sp_user_001',
      idempotencyKey: 'restore-key-preflight-not-ready',
      actorUserId: 'user_1',
      requestId: 'req_restore_preflight_not_ready',
    })).rejects.toThrow('file_library_project_storage_not_ready');
    expect(client.admitRestoreRepo).not.toHaveBeenCalled();
    expect(client.restoreRepo).not.toHaveBeenCalled();
  });

  it('maps durable restore capability denials without calling legacy admit', async () => {
    const client = createProductClient({
      listSavePoints: vi.fn(async () => ({
        save_points: [
          {
            save_point_id: 'sp_user_001',
            repo_id: 'repo_flib_123',
            message: 'User checkpoint',
            created_at: '2026-05-09T00:00:00.000Z',
          },
        ],
      })),
      restoreRepo: vi.fn(async () => {
        throw new AfscpClientError({
          status: 403,
          code: 'afscp_capability_denied',
          message: 'restore disabled repo_hidden ns_hidden',
          retryable: false,
          correlation_id: 'corr_restore_preflight_capability',
          resource_kind: 'repo',
        });
      }),
    });
    const { adapter } = await createMappedAdapter({ client });

    await expect(adapter.restoreFileLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      savePointId: 'sp_user_001',
      idempotencyKey: 'restore-key-preflight-capability',
      actorUserId: 'user_1',
      requestId: 'req_restore_preflight_capability',
    })).rejects.toThrow('file_library_capability_denied');
    expect(client.restoreRepo).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      savePointId: 'sp_user_001',
      idempotencyKey: 'restore-key-preflight-capability',
    }));
    expect(client.restoreRepo).toHaveBeenCalledTimes(1);
    expect(client.admitRestoreRepo).not.toHaveBeenCalled();
    expect(client.listSavePoints).not.toHaveBeenCalled();
  });

  it('returns pending direct restore when AFSCP polling has not reached a terminal operation', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'repo_restore',
        operation_state: 'running',
        phase: 'repo_restore_apply',
        resource: { type: 'repo', id: 'repo_flib_123' },
        external_resource_ids: {
          source_save_point_id: '1778481131647-4d2e0211',
        },
        verification_result: {
          source_save_point_id: '1778481131647-4d2e0211',
        },
        finished_at: null,
      })),
    });
    const { adapter, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.restoreFileLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      savePointId: '1778481131647-4d2e0211',
      idempotencyKey: 'restore-key-pending',
      actorUserId: 'user_1',
      requestId: 'req_restore_pending',
    })).resolves.toMatchObject({
      operationId: 'op_restore_direct',
      operationStatus: 'pending',
      sourceSavePointId: '1778481131647-4d2e0211',
    });

    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: '1778481131647-4d2e0211',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
  });

  it('maps operator-intervention direct restore terminals to recovery_required instead of generic failed', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'repo_restore',
        operation_state: 'operator_intervention_required',
        phase: 'repo_restore_requires_operator',
        resource: { type: 'repo', id: 'repo_flib_123' },
        error: {
          code: 'OPERATION_RECOVERY_REQUIRED',
          message: 'manual recovery required at /var/lib/afscp/control-root/repo_flib_123',
          retryable: false,
        },
        external_resource_ids: {
          source_save_point_id: '1778481131647-4d2e0211',
        },
      })),
    });
    const { adapter } = await createMappedAdapter({ client });

    await expect(adapter.restoreFileLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      savePointId: '1778481131647-4d2e0211',
      idempotencyKey: 'restore-key-recovery',
      actorUserId: 'user_1',
      requestId: 'req_restore_recovery',
    })).resolves.toMatchObject({
      operationId: 'op_restore_direct',
      operationStatus: 'recovery_required',
      sourceSavePointId: '1778481131647-4d2e0211',
    });
  });

  it('reconciles existing direct restore operations from getOperation using public save point ids', async () => {
    const client = createProductClient({
      getOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'repo_restore',
        operation_state: 'succeeded',
        resource: { type: 'repo', id: 'repo_flib_123' },
        external_resource_ids: {
          save_point_id: '[REDACTED]',
        },
        verification_result: {
          save_point_id: '1778481131647-4d2e0211',
        },
      })),
      pollOperation: vi.fn(),
    });
    const { adapter, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.reconcileRestoreOperation({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      operationId: 'op_restore_long',
      requestId: 'req_restore_reconcile',
    })).resolves.toMatchObject({
      operationId: 'op_restore_long',
      operationStatus: 'succeeded',
      sourceSavePointId: '1778481131647-4d2e0211',
    });

    expect(client.getOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_restore_long',
      correlationId: 'req_restore_reconcile',
    }));
    expect(client.pollOperation).not.toHaveBeenCalled();
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: '1778481131647-4d2e0211',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: '[REDACTED]',
    })).resolves.toBeNull();
  });

  it('maps direct restore writer-session blockers without exposing AFSCP payload details', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async () => ({
        ...succeededRepoOperation,
        operation_id: 'op_restore_direct',
        operation_type: 'repo_restore',
        operation_state: 'failed',
        phase: 'repo_restore_writer_fenced',
        error: {
          code: 'RESTORE_RUN_WRITER_SESSIONS_DENIED',
          message: 'restore writer sessions denied repo_hidden_elsewhere',
          retryable: false,
          correlation_id: 'corr_writer_blocked',
          operation_id: 'op_restore_direct',
          details: {
            repo_id: 'repo_hidden_elsewhere',
            namespace_id: 'ns_hidden',
            export_id: 'export_hidden',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
        verification_result: {
          writer_gate_error_family: 'ACTIVE_WRITER_SESSIONS',
          export_id: 'export_hidden',
          namespace_id: 'ns_hidden',
        },
      })),
    });
    const { adapter } = await createMappedAdapter({ client });

    let caught: unknown;
    try {
      await adapter.restoreFileLibrary({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        savePointId: 'sp_user_001',
        idempotencyKey: 'restore-key-writer-blocked',
        actorUserId: 'user_1',
        requestId: 'req_writer_blocked',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('file_library_active_writer_blocked');
    expect(JSON.stringify(caught)).not.toMatch(/repo_hidden_elsewhere|ns_hidden|export_hidden|metadata_url|postgres/);
  });

  it('creates templates and clones them into a new file library repo without exposing raw template ids', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: input.operationId === 'op_template_create' ? 'template_create' : 'template_clone',
        operation_state: 'succeeded',
        external_resource_ids: input.operationId === 'op_template_create'
          ? { source_save_point_id: 'sp_template_source_001' }
          : {},
        verification_result: input.operationId === 'op_template_create'
          ? { source_save_point_id: 'sp_template_source_001' }
          : {},
      })),
    });
    const { adapter, mappingRepo, ownershipStore } = await createMappedAdapter({ client });

    await expect(adapter.createTemplateFromLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      templateId: 'tmpl_task_file_template_1',
      idempotencyKey: 'task-template-key-1',
      actorUserId: 'user_1',
      requestId: 'req_template_create',
    })).resolves.toMatchObject({
      templateId: 'tmpl_task_file_template_1',
      operationId: 'op_template_create',
      operationStatus: 'succeeded',
      sourceSavePointId: 'sp_template_source_001',
    });
    expect(client.createRepoTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tmpl_task_file_template_1',
      idempotencyKey: 'file-library:flib_123:template-create:tmpl_task_file_template_1:task-template-key-1',
    }));

    await expect(adapter.cloneTemplateToLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_clone_123',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      templateId: 'tmpl_task_file_template_1',
      actorUserId: 'user_1',
      requestId: 'req_template_clone',
    })).resolves.toMatchObject({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_clone_123',
      operationId: 'op_template_clone',
      operationStatus: 'succeeded',
      projectStorageGeneration: 1,
    });

    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_123')).resolves.toMatchObject({
      repo_id: 'repo_flib_clone_123',
      operation_id: 'op_template_clone',
      operation_status: 'succeeded',
    });
    await expect(ownershipStore.getResourceOwnership({
      resourceKind: 'repo_template',
      resourceId: 'tmpl_task_file_template_1',
    })).resolves.toMatchObject({
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    expect(JSON.stringify(await mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_123'))).not.toContain('tmpl_task_file_template_1');
  });

  it('uses a stable short AFSCP idempotency key for long template create keys', async () => {
    const createRepoTemplate = vi.fn(async () => ({
      operation_id: 'op_template_create',
      operation_state: 'queued',
      resource: { type: 'repo_template', id: 'tmpl_task_file_template_1' },
      result: null,
      error: null,
    }));
    const client = createProductClient({
      createRepoTemplate,
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'template_create',
        operation_state: 'succeeded',
        external_resource_ids: { source_save_point_id: 'sp_template_source_long_key' },
      })),
    });
    const { adapter } = await createMappedAdapter({ client });
    const longKey = `task-template-${'x'.repeat(400)}-${'unsafe value'.repeat(20)}`;

    for (const requestId of ['req_template_create_long_1', 'req_template_create_long_2']) {
      await expect(adapter.createTemplateFromLibrary({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_123',
        templateId: 'tmpl_task_file_template_1',
        idempotencyKey: longKey,
        actorUserId: 'user_1',
        requestId,
      })).resolves.toMatchObject({
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_template_source_long_key',
      });
    }

    const keys = createRepoTemplate.mock.calls.map((call) => call[0]?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(String(keys[0]).length).toBeLessThanOrEqual(128);
    expect(String(keys[0])).toMatch(/^file-library:[A-Za-z0-9_-]{32,}$/);
    expect(String(keys[0])).not.toContain('unsafe');
    expect(String(keys[0])).not.toContain('xxxx');
  });

  it('returns typed pending template create and clone results without marking clone mappings failed', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: input.operationId === 'op_template_create' ? 'template_create' : 'template_clone',
        operation_state: 'running',
        resource: input.operationId === 'op_template_create'
          ? { type: 'repo_template', id: 'tmpl_task_file_template_pending' }
          : { type: 'repo', id: 'repo_flib_clone_pending' },
        external_resource_ids: input.operationId === 'op_template_create'
          ? { source_save_point_id: '1778481131647-4d2e0211' }
          : {},
        verification_result: input.operationId === 'op_template_create'
          ? { source_save_point_id: '1778481131647-4d2e0211' }
          : {},
        finished_at: null,
      })),
    });
    const { adapter, mappingRepo } = await createMappedAdapter({ client });

    await expect(adapter.createTemplateFromLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      templateId: 'tmpl_task_file_template_pending',
      actorUserId: 'user_1',
      requestId: 'req_template_create_pending',
    })).resolves.toMatchObject({
      templateId: 'tmpl_task_file_template_pending',
      operationId: 'op_template_create',
      operationStatus: 'pending',
      sourceSavePointId: '1778481131647-4d2e0211',
    });

    await expect(adapter.cloneTemplateToLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_clone_pending',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      templateId: 'tmpl_task_file_template_pending',
      actorUserId: 'user_1',
      requestId: 'req_template_clone_pending',
    })).resolves.toMatchObject({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_clone_pending',
      operationId: 'op_template_clone',
      operationStatus: 'pending',
      projectStorageGeneration: 1,
    });

    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_pending')).resolves.toMatchObject({
      repo_id: 'repo_flib_clone_pending',
      operation_id: 'op_template_clone',
      operation_status: 'pending',
      last_error_code: null,
    });
  });

  it('reconciles pending template clone mappings to terminal operation state without leaking template ids', async () => {
    const client = createProductClient({
      pollOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'template_clone',
        operation_state: 'running',
        resource: { type: 'repo', id: 'repo_flib_clone_pending' },
        finished_at: null,
      })),
      getOperation: vi.fn(async (input) => ({
        ...succeededRepoOperation,
        operation_id: input.operationId,
        operation_type: 'template_clone',
        operation_state: 'succeeded',
        resource: { type: 'repo', id: 'repo_flib_clone_pending' },
        external_resource_ids: {
          template_id: '[REDACTED]',
        },
      })),
    });
    const { adapter, mappingRepo, ownershipStore } = await createMappedAdapter({ client });
    await ownershipStore.ensureResourceOwnership({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      namespaceId: 'ns_project_1',
      resourceKind: 'repo_template',
      resourceId: 'tmpl_task_file_template_pending',
    });

    await expect(adapter.cloneTemplateToLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_clone_pending',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      templateId: 'tmpl_task_file_template_pending',
      actorUserId: 'user_1',
      requestId: 'req_template_clone_pending',
    })).resolves.toMatchObject({
      operationStatus: 'pending',
      operationId: 'op_template_clone',
    });

    await expect(adapter.reconcileLibraryProvisioning({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_clone_pending',
      requestId: 'req_template_clone_reconcile',
    })).resolves.toMatchObject({
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_clone_pending',
      operationId: 'op_template_clone',
      operationStatus: 'succeeded',
      projectStorageGeneration: 1,
      lastErrorCode: null,
    });
    await expect(mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_pending')).resolves.toMatchObject({
      repo_id: 'repo_flib_clone_pending',
      operation_id: 'op_template_clone',
      operation_status: 'succeeded',
      last_error_code: null,
    });
    expect(JSON.stringify(await mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_pending'))).not.toContain('tmpl_task_file_template_pending');
  });

  it('projects template clone denials as safe public errors and sanitized mapping state', async () => {
    const client = createProductClient({
      cloneRepoTemplate: vi.fn(async () => {
        throw new AfscpClientError({
          status: 403,
          code: 'afscp_template_clone_not_allowed',
          message: 'afscp_template_clone_not_allowed',
          retryable: false,
          correlation_id: 'corr_template_denied',
          operation_id: 'op_template_hidden',
        });
      }),
    });
    const { adapter, mappingRepo } = await createMappedAdapter({ client });

    await expect(adapter.cloneTemplateToLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_clone_denied',
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      templateId: 'tmpl_task_file_template_1',
      actorUserId: 'user_1',
      requestId: 'req_template_clone_denied',
    })).rejects.toThrow('file_library_template_clone_not_allowed');

    const mapping = await mappingRepo.getByLibraryId('ws_default', 'proj_1', 'flib_clone_denied');
    expect(mapping).toMatchObject({
      operation_id: null,
      operation_status: 'failed',
      last_error_code: 'file_library_template_clone_not_allowed',
    });
    expect(JSON.stringify(mapping)).not.toMatch(/tmpl_task_file_template_1|op_template_hidden|corr_template_denied|credential|control_root/);
  });

  it('uses an independent short-lived signal when canceling a download export after request abort', async () => {
    const userAbort = new AbortController();
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      },
    )) as unknown as typeof fetch;
    const { client, adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    const result = await adapter.downloadObject({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      objectPath: 'docs/hello.txt',
      requestId: 'req_download_cancel',
      signal: userAbort.signal,
    });
    expect(client.revokeExport).not.toHaveBeenCalled();

    userAbort.abort(new Error('client aborted token=svc-secret-token'));
    await result.download.cancel(userAbort.signal.reason);
    await vi.waitFor(() => expect(client.revokeExport).toHaveBeenCalled());

    const revokeInput = vi.mocked(client.revokeExport).mock.calls[0]?.[0];
    expect(revokeInput?.signal).toBeInstanceOf(AbortSignal);
    expect(revokeInput?.signal).not.toBe(userAbort.signal);
    expect(revokeInput?.signal?.aborted).toBe(false);
    expect(JSON.stringify(revokeInput)).not.toContain('svc-secret-token');
  });

  it('fails file operations closed when project storage namespace is not ready', async () => {
    const docStore = new InMemoryJsonDocStore();
    const client = createProductClient();
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    await mappingRepo.saveReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      namespaceId: 'ns_project_1',
      repoId: 'repo_flib_123',
      projectStorageGeneration: 1,
      operationId: 'op_repo_create',
    });
    const adapter = new AfscpFileLibraryStorageAdapter({
      client,
      mappingRepo,
      projectAfscpNamespaceStore: new ProjectAfscpNamespaceStore(docStore),
      resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: '',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    })).rejects.toThrow('file_library_project_storage_not_ready');
    expect(client.createExport).not.toHaveBeenCalled();
  });

  it('fails file operations closed when mapping generation does not match the ready project namespace', async () => {
    const fetchMock = vi.fn(async () => new Response('<d:multistatus xmlns:d="DAV:" />', {
      status: 207,
      headers: { 'Content-Type': 'application/xml' },
    })) as unknown as typeof fetch;
    const { docStore, client, namespaceStore, adapter } = await createMappedAdapter({ fetchFn: fetchMock });
    const namespace = await namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(namespace).not.toBeNull();
    if (namespace) {
      await docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, namespace.id, {
        ...namespace,
        generation: 2,
      });
    }

    await expect(adapter.listEntries({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      path: '',
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    })).rejects.toThrow('file_library_project_storage_generation_mismatch');
    expect(client.createExport).not.toHaveBeenCalled();
  });

  it('redacts per-path delete errors from WebDAV failures', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('webdav delete failed password=one-time-webdav-secret metadata_url=postgres://db');
    }) as unknown as typeof fetch;
    const { adapter } = await createMappedAdapter({ fetchFn: fetchMock });

    await expect(adapter.deletePaths({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      paths: ['docs/secret.txt'],
      actorUserId: 'user_1',
    })).resolves.toEqual([
      {
        path: 'docs/secret.txt',
        status: 'error',
        error_code: 'file_library_delete_failed',
        message: 'file_library_delete_failed',
      },
    ]);
  });
});
