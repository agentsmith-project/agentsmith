import { createHash } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type { AfscpResourceKind } from './afscp-error-mapper.js';
import { sanitizeAfscpNamespaceId } from './afscp-validation.js';

export type ProjectAfscpNamespaceStatus = 'pending' | 'ready' | 'blocked' | 'deleting' | 'tombstoned';
export type ProjectAfscpNamespaceStage =
  | 'namespace_upsert'
  | 'volume_binding'
  | 'ready'
  | 'terminal_lifecycle'
  | 'tombstoned';
export type ProjectAfscpNamespaceNextAction = 'wait' | 'retry_now' | 'admin_repair' | 'none';
export type ProjectAfscpOwnedResourceKind = Exclude<AfscpResourceKind, 'volume'>;

export interface ProjectAfscpNamespaceMapping {
  id: string;
  workspace_id: string;
  project_id: string;
  namespace_id: string;
  status: ProjectAfscpNamespaceStatus;
  stage: ProjectAfscpNamespaceStage;
  generation: number;
  next_action: ProjectAfscpNamespaceNextAction;
  retryable: boolean;
  namespace_upsert_operation_id: string | null;
  volume_binding_operation_id: string | null;
  volume_binding_signature?: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAfscpNamespaceKey {
  workspaceId: string;
  projectId: string;
}

export interface ProjectAfscpResourceOwnershipMapping {
  id: string;
  workspace_id: string;
  project_id: string;
  resource_kind: ProjectAfscpOwnedResourceKind;
  resource_id: string;
  namespace_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectAfscpResourceOwnershipKey {
  resourceKind: ProjectAfscpOwnedResourceKind;
  resourceId: string;
}

export interface EnsureProjectAfscpResourceOwnershipInput extends ProjectAfscpNamespaceKey, ProjectAfscpResourceOwnershipKey {
  namespaceId: string;
}

export class ProjectAfscpResourceOwnershipConflictError extends Error {
  readonly code = 'PROJECT_AFSCP_RESOURCE_OWNERSHIP_CONFLICT';
  readonly resource_kind: ProjectAfscpOwnedResourceKind;

  constructor(input: { resourceKind: ProjectAfscpOwnedResourceKind }) {
    super('project_afscp_resource_ownership_conflict');
    this.name = 'ProjectAfscpResourceOwnershipConflictError';
    this.resource_kind = input.resourceKind;
  }
}

export const PROJECT_AFSCP_NAMESPACE_COLLECTION = 'project_afscp_namespace_mappings';
export const PROJECT_AFSCP_RESOURCE_OWNERSHIP_COLLECTION = 'project_afscp_resource_ownership_mappings';

const PROJECT_AFSCP_OWNED_RESOURCE_KINDS = new Set<ProjectAfscpOwnedResourceKind>([
  'namespace',
  'repo',
  'repo_template',
  'save_point',
  'restore_plan',
  'export',
  'workload_mount_binding',
  'operation',
]);

const PROJECT_AFSCP_NAMESPACE_STAGES = new Set<ProjectAfscpNamespaceStage>([
  'namespace_upsert',
  'volume_binding',
  'ready',
  'terminal_lifecycle',
  'tombstoned',
]);

const PROJECT_AFSCP_BOOTSTRAP_STAGES = new Set<ProjectAfscpNamespaceStage>([
  'namespace_upsert',
  'volume_binding',
]);

function mappingId(input: ProjectAfscpNamespaceKey): string {
  return `${input.workspaceId}:${input.projectId}`;
}

function resourceOwnershipId(input: ProjectAfscpResourceOwnershipKey): string {
  const digest = createHash('sha256')
    .update(input.resourceKind)
    .update('\0')
    .update(input.resourceId)
    .digest('base64url')
    .slice(0, 40);
  return `afscp_resource:${digest}`;
}

function hasSameResourceOwner(
  existing: ProjectAfscpResourceOwnershipMapping,
  input: EnsureProjectAfscpResourceOwnershipInput,
): boolean {
  return existing.workspace_id === input.workspaceId
    && existing.project_id === input.projectId
    && existing.namespace_id === input.namespaceId;
}

function assertSameResourceOwner(
  existing: ProjectAfscpResourceOwnershipMapping,
  input: EnsureProjectAfscpResourceOwnershipInput,
): ProjectAfscpResourceOwnershipMapping {
  if (!hasSameResourceOwner(existing, input)) {
    throw new ProjectAfscpResourceOwnershipConflictError({ resourceKind: input.resourceKind });
  }
  return existing;
}

function hasOwnProperty<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolvePendingStage(input: {
  requestedStage?: ProjectAfscpNamespaceStage;
  existingStage: ProjectAfscpNamespaceStage;
}): ProjectAfscpNamespaceStage {
  if (input.requestedStage && PROJECT_AFSCP_BOOTSTRAP_STAGES.has(input.requestedStage)) {
    return input.requestedStage;
  }
  return input.existingStage === 'ready' ? 'namespace_upsert' : input.existingStage;
}

function resolveBlockedStage(input: {
  requestedStage?: ProjectAfscpNamespaceStage;
  existingStage: ProjectAfscpNamespaceStage;
  volumeBindingOperationId: string | null;
}): ProjectAfscpNamespaceStage {
  if (input.requestedStage && input.requestedStage !== 'ready') {
    return input.requestedStage;
  }
  if (input.volumeBindingOperationId) {
    return 'volume_binding';
  }
  return input.existingStage === 'ready' ? 'namespace_upsert' : input.existingStage;
}

export function deriveProjectAfscpNamespaceId(input: ProjectAfscpNamespaceKey): string {
  const digest = createHash('sha256')
    .update(input.workspaceId)
    .update('\0')
    .update(input.projectId)
    .digest('hex')
    .slice(0, 40);
  return `ns_${digest}`;
}

function canRegenerateProjectNamespaceMapping(existing: ProjectAfscpNamespaceMapping): boolean {
  return !sanitizeAfscpNamespaceId(existing.namespace_id)
    && (existing.status === 'pending' || existing.status === 'blocked')
    && !existing.namespace_upsert_operation_id
    && !existing.volume_binding_operation_id;
}

export function isProjectAfscpOwnedResourceKind(kind: AfscpResourceKind): kind is ProjectAfscpOwnedResourceKind {
  return PROJECT_AFSCP_OWNED_RESOURCE_KINDS.has(kind as ProjectAfscpOwnedResourceKind);
}

export class ProjectAfscpNamespaceStore {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async getProjectNamespace(input: ProjectAfscpNamespaceKey): Promise<ProjectAfscpNamespaceMapping | null> {
    const record = await this.docStore.get<ProjectAfscpNamespaceMapping>(PROJECT_AFSCP_NAMESPACE_COLLECTION, mappingId(input));
    return record ?? null;
  }

  async ensureProjectNamespace(input: ProjectAfscpNamespaceKey): Promise<ProjectAfscpNamespaceMapping> {
    const id = mappingId(input);
    const existing = await this.docStore.get<ProjectAfscpNamespaceMapping>(
      PROJECT_AFSCP_NAMESPACE_COLLECTION,
      id,
    );
    if (existing) {
      if (canRegenerateProjectNamespaceMapping(existing)) {
        const namespaceId = deriveProjectAfscpNamespaceId(input);
        if (namespaceId !== existing.namespace_id && sanitizeAfscpNamespaceId(namespaceId)) {
          const next: ProjectAfscpNamespaceMapping = {
            ...existing,
            namespace_id: namespaceId,
            status: 'pending',
            stage: 'namespace_upsert',
            generation: existing.generation + 1,
            next_action: 'retry_now',
            retryable: false,
            namespace_upsert_operation_id: null,
            volume_binding_operation_id: null,
            volume_binding_signature: null,
            last_error_code: null,
            updated_at: this.nowIso(),
          };
          await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, id, next);
          return next;
        }
      }
      return existing;
    }

    const now = this.nowIso();
    const record: ProjectAfscpNamespaceMapping = {
      id,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      namespace_id: deriveProjectAfscpNamespaceId(input),
      status: 'pending',
      stage: 'namespace_upsert',
      generation: 1,
      next_action: 'retry_now',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      volume_binding_signature: null,
      last_error_code: null,
      created_at: now,
      updated_at: now,
    };
    const created = await this.docStore.createIfAbsent(
      PROJECT_AFSCP_NAMESPACE_COLLECTION,
      id,
      record,
    );
    return created.ok ? record : created.current;
  }

  async markProjectNamespacePending(input: ProjectAfscpNamespaceKey & {
    stage?: ProjectAfscpNamespaceStage;
    retryable?: boolean;
    nextAction?: Extract<ProjectAfscpNamespaceNextAction, 'wait' | 'retry_now'>;
    lastErrorCode?: string | null;
    namespaceUpsertOperationId?: string | null;
    volumeBindingOperationId?: string | null;
    volumeBindingSignature?: string | null;
  }): Promise<ProjectAfscpNamespaceMapping> {
    const existing = await this.ensureProjectNamespace(input);
    const next: ProjectAfscpNamespaceMapping = {
      ...existing,
      status: 'pending',
      stage: resolvePendingStage({
        requestedStage: input.stage,
        existingStage: existing.stage,
      }),
      generation: existing.generation,
      next_action: input.nextAction ?? (input.retryable ? 'retry_now' : 'wait'),
      retryable: input.retryable ?? false,
      namespace_upsert_operation_id: hasOwnProperty(input, 'namespaceUpsertOperationId')
        ? input.namespaceUpsertOperationId ?? null
        : existing.namespace_upsert_operation_id,
      volume_binding_operation_id: hasOwnProperty(input, 'volumeBindingOperationId')
        ? input.volumeBindingOperationId ?? null
        : existing.volume_binding_operation_id,
      volume_binding_signature: hasOwnProperty(input, 'volumeBindingSignature')
        ? input.volumeBindingSignature ?? null
        : existing.volume_binding_signature ?? null,
      last_error_code: hasOwnProperty(input, 'lastErrorCode')
        ? input.lastErrorCode ?? null
        : null,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, next.id, next);
    return next;
  }

  async markProjectNamespaceReady(input: ProjectAfscpNamespaceKey & {
    namespaceUpsertOperationId: string | null;
    volumeBindingOperationId: string | null;
    volumeBindingSignature?: string | null;
  }): Promise<ProjectAfscpNamespaceMapping> {
    const existing = await this.ensureProjectNamespace(input);
    const next: ProjectAfscpNamespaceMapping = {
      ...existing,
      status: 'ready',
      stage: 'ready',
      generation: existing.generation,
      next_action: 'none',
      retryable: false,
      namespace_upsert_operation_id: input.namespaceUpsertOperationId,
      volume_binding_operation_id: input.volumeBindingOperationId,
      volume_binding_signature: input.volumeBindingSignature ?? existing.volume_binding_signature ?? null,
      last_error_code: null,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, next.id, next);
    return next;
  }

  async markProjectNamespaceBlocked(input: ProjectAfscpNamespaceKey & {
    stage?: ProjectAfscpNamespaceStage;
    namespaceUpsertOperationId: string | null;
    volumeBindingOperationId: string | null;
    lastErrorCode: string;
  }): Promise<ProjectAfscpNamespaceMapping> {
    const existing = await this.ensureProjectNamespace(input);
    const volumeBindingOperationId = input.volumeBindingOperationId;
    const next: ProjectAfscpNamespaceMapping = {
      ...existing,
      status: 'blocked',
      stage: resolveBlockedStage({
        requestedStage: input.stage,
        existingStage: existing.stage,
        volumeBindingOperationId,
      }),
      generation: existing.generation,
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: input.namespaceUpsertOperationId,
      volume_binding_operation_id: volumeBindingOperationId,
      last_error_code: input.lastErrorCode,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, next.id, next);
    return next;
  }

  async markProjectNamespaceDeleting(input: ProjectAfscpNamespaceKey & {
    lastErrorCode?: string | null;
    retryable?: boolean;
    nextAction?: Extract<ProjectAfscpNamespaceNextAction, 'retry_now' | 'wait'>;
  }): Promise<ProjectAfscpNamespaceMapping> {
    const existing = await this.ensureProjectNamespace(input);
    if (existing.status === 'tombstoned') {
      return existing;
    }
    const retryable = input.retryable ?? true;
    const next: ProjectAfscpNamespaceMapping = {
      ...existing,
      status: 'deleting',
      stage: 'terminal_lifecycle',
      generation: existing.generation,
      next_action: input.nextAction ?? (retryable ? 'retry_now' : 'wait'),
      retryable,
      last_error_code: input.lastErrorCode ?? 'project_storage_teardown_in_progress',
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, next.id, next);
    return next;
  }

  async markProjectNamespaceTombstoned(input: ProjectAfscpNamespaceKey): Promise<ProjectAfscpNamespaceMapping> {
    const existing = await this.ensureProjectNamespace(input);
    const next: ProjectAfscpNamespaceMapping = {
      ...existing,
      status: 'tombstoned',
      stage: 'tombstoned',
      generation: existing.status === 'tombstoned' ? existing.generation : existing.generation + 1,
      next_action: 'none',
      retryable: false,
      last_error_code: 'project_storage_tombstoned',
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, next.id, next);
    return next;
  }
}

export class ProjectAfscpResourceOwnershipStore {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async getResourceOwnership(input: ProjectAfscpResourceOwnershipKey): Promise<ProjectAfscpResourceOwnershipMapping | null> {
    return this.docStore.get<ProjectAfscpResourceOwnershipMapping>(
      PROJECT_AFSCP_RESOURCE_OWNERSHIP_COLLECTION,
      resourceOwnershipId(input),
    );
  }

  async ensureResourceOwnership(
    input: EnsureProjectAfscpResourceOwnershipInput,
  ): Promise<ProjectAfscpResourceOwnershipMapping> {
    const id = resourceOwnershipId(input);
    const existing = await this.docStore.get<ProjectAfscpResourceOwnershipMapping>(
      PROJECT_AFSCP_RESOURCE_OWNERSHIP_COLLECTION,
      id,
    );
    if (existing) {
      return assertSameResourceOwner(existing, input);
    }

    const now = this.nowIso();
    const record: ProjectAfscpResourceOwnershipMapping = {
      id,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      resource_kind: input.resourceKind,
      resource_id: input.resourceId,
      namespace_id: input.namespaceId,
      created_at: now,
      updated_at: now,
    };
    const created = await this.docStore.createIfAbsent(
      PROJECT_AFSCP_RESOURCE_OWNERSHIP_COLLECTION,
      id,
      record,
    );
    return created.ok ? record : assertSameResourceOwner(created.current, input);
  }
}
