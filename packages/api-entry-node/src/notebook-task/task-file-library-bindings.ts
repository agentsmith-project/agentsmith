import { randomInt } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type { TaskRecord } from './task-models.js';

const BINDINGS_COLLECTION = 'agent_task_file_library_bindings';
const WORKSPACE_HOLDERS_COLLECTION = 'agent_task_workspace_holders';
export const RUNTIME_ACCESS_RELEASE_FENCE_LEASE_TTL_MS = 10 * 60 * 1000;

export type RuntimeWritableAffordance = 'task_internal_home' | 'files_update';
export type TaskFileLibraryBindingState = 'bound' | 'releasing';
export type TaskWorkspaceHolderKind = 'runner_workspace';
export type TaskWorkspaceHolderState = 'active' | 'released' | 'expired';

export interface TaskFileLibraryBinding {
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: 'active' | 'archived';
  ownerUserId: string;
  bindingGeneration: number;
  runtimeWritableAffordance: RuntimeWritableAffordance;
  bindingState: TaskFileLibraryBindingState;
  correlationId: string;
}

export interface TaskFileLibraryBindingRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  file_library_id: string;
  task_id: string;
  task_title: string;
  task_status: 'active' | 'archived';
  owner_user_id: string;
  binding_generation: number;
  runtime_writable_affordance: RuntimeWritableAffordance;
  binding_state: TaskFileLibraryBindingState;
  acquired_at: string;
  updated_at: string;
  correlation_id: string;
}

export interface FileLibraryTaskHomeBindingFields {
  task_home_binding_status: 'unbound' | 'bound';
  bound_task_visible: boolean;
  bound_task_id?: string;
  bound_task_title?: string;
  bound_task_status?: 'active' | 'archived';
}

export interface BoundTaskSafeFields {
  bound_task_visible: boolean;
  bound_task_id?: string;
  bound_task_title?: string;
  bound_task_status?: 'active' | 'archived';
}

export interface TaskWorkspaceHolder {
  workspaceId: string;
  projectId: string;
  taskId: string;
  fileLibraryId: string;
  taskHomeSegment: string;
  bindingGeneration: number;
  holderId: string;
  holderKind: TaskWorkspaceHolderKind;
  leaseEpoch: string;
  holderState: TaskWorkspaceHolderState;
  issuedAt: string;
  expiresAt: string;
  releasedAt?: string;
  updatedAt: string;
}

interface TaskWorkspaceHolderRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string;
  file_library_id: string;
  task_home_segment: string;
  binding_generation: number;
  holder_id: string;
  holder_kind: TaskWorkspaceHolderKind;
  lease_epoch: string;
  holder_state: TaskWorkspaceHolderState;
  issued_at: string;
  expires_at: string;
  released_at?: string;
  updated_at: string;
}

type HydratableTaskRecord = Pick<
  TaskRecord,
  | 'id'
  | 'workspace_id'
  | 'project_id'
  | 'owner_user_id'
  | 'title'
  | 'status'
  | 'deletion_state'
  | 'workspace_file_library_id'
  | 'file_library_binding_generation'
  | 'runtime_writable_affordance'
>;

const BINDING_CACHE_BY_LIBRARY = new Map<string, TaskFileLibraryBinding>();

function bindingKey(input: {
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
}): string {
  return `${input.workspaceId}::${input.projectId}::${input.fileLibraryId}`;
}

function holderKey(input: {
  workspaceId: string;
  projectId: string;
  holderId: string;
}): string {
  return `${input.workspaceId}::${input.projectId}::${input.holderId}`;
}

function nextBindingGeneration(): number {
  return Date.now() * 1000 + randomInt(0, 1000);
}

function normalizeRuntimeAccessReleaseFenceToken(input?: string | null): string {
  const trimmed = input?.trim();
  if (!trimmed) return 'unspecified';
  const normalized = trimmed.replace(/[^A-Za-z0-9._:-]+/g, '_').slice(0, 160);
  return normalized || 'unspecified';
}

export function buildRuntimeAccessReleaseBeginCorrelationId(input?: {
  requestId?: string | null;
}): string {
  return `release:begin:${normalizeRuntimeAccessReleaseFenceToken(input?.requestId)}`;
}

export function buildRuntimeAccessReleaseCompleteCorrelationId(input: {
  beginCorrelationId: string;
}): string {
  return `release:complete:${normalizeRuntimeAccessReleaseFenceToken(input.beginCorrelationId)}`;
}

export function buildRuntimeAccessReleaseRollbackCorrelationId(input: {
  beginCorrelationId: string;
  reason: 'failed' | 'hard_blocker' | 'workspace_holder';
}): string {
  return `release:rollback:${input.reason}:${normalizeRuntimeAccessReleaseFenceToken(input.beginCorrelationId)}`;
}

export function buildRuntimeAccessRestoreStartedCorrelationId(input: {
  operationId: string;
}): string {
  return `restore:${normalizeRuntimeAccessReleaseFenceToken(input.operationId)}:started`;
}

export function buildRuntimeAccessRestoreTerminalCorrelationId(input: {
  operationId: string;
  requestId?: string | null;
}): string {
  const requestToken = normalizeRuntimeAccessReleaseFenceToken(input.requestId);
  return `restore:${normalizeRuntimeAccessReleaseFenceToken(input.operationId)}:terminal:${requestToken}`;
}

export function isRuntimeAccessRestoreStartedCorrelationForOperation(input: {
  correlationId: string;
  operationId: string;
}): boolean {
  return input.correlationId === buildRuntimeAccessRestoreStartedCorrelationId({ operationId: input.operationId })
    || input.correlationId === `${input.operationId}:restore_started`;
}

function recordToBinding(record: TaskFileLibraryBindingRecord): TaskFileLibraryBinding {
  return {
    workspaceId: record.workspace_id,
    projectId: record.project_id,
    fileLibraryId: record.file_library_id,
    taskId: record.task_id,
    taskTitle: record.task_title,
    taskStatus: record.task_status,
    ownerUserId: record.owner_user_id,
    bindingGeneration: record.binding_generation,
    runtimeWritableAffordance: record.runtime_writable_affordance,
    bindingState: record.binding_state,
    correlationId: record.correlation_id,
  };
}

function bindingToRecord(input: TaskFileLibraryBinding & {
  acquiredAt: string;
  updatedAt: string;
}): TaskFileLibraryBindingRecord {
  const id = bindingKey(input);
  return {
    id,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    file_library_id: input.fileLibraryId,
    task_id: input.taskId,
    task_title: input.taskTitle,
    task_status: input.taskStatus,
    owner_user_id: input.ownerUserId,
    binding_generation: input.bindingGeneration,
    runtime_writable_affordance: input.runtimeWritableAffordance,
    binding_state: input.bindingState,
    acquired_at: input.acquiredAt,
    updated_at: input.updatedAt,
    correlation_id: input.correlationId,
  };
}

function cacheBinding(binding: TaskFileLibraryBinding): void {
  BINDING_CACHE_BY_LIBRARY.set(bindingKey(binding), binding);
}

function uncacheBinding(input: {
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
}): void {
  BINDING_CACHE_BY_LIBRARY.delete(bindingKey(input));
}

function bindingFromTask(task: HydratableTaskRecord): TaskFileLibraryBinding | null {
  const fileLibraryId = task.workspace_file_library_id?.trim();
  if (!fileLibraryId) return null;
  if (task.status !== 'active' && task.status !== 'archived') return null;
  if (task.deletion_state === 'deleting' || task.deletion_state === 'deleted') return null;
  return {
    workspaceId: task.workspace_id,
    projectId: task.project_id,
    fileLibraryId,
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    ownerUserId: task.owner_user_id,
    bindingGeneration: typeof task.file_library_binding_generation === 'number'
      ? task.file_library_binding_generation
      : nextBindingGeneration(),
    runtimeWritableAffordance: task.runtime_writable_affordance ?? 'task_internal_home',
    bindingState: 'bound',
    correlationId: 'task_binding_hydration',
  };
}

function holderRecordToHolder(record: TaskWorkspaceHolderRecord): TaskWorkspaceHolder {
  return {
    workspaceId: record.workspace_id,
    projectId: record.project_id,
    taskId: record.task_id,
    fileLibraryId: record.file_library_id,
    taskHomeSegment: record.task_home_segment,
    bindingGeneration: record.binding_generation,
    holderId: record.holder_id,
    holderKind: record.holder_kind,
    leaseEpoch: record.lease_epoch,
    holderState: record.holder_state,
    issuedAt: record.issued_at,
    expiresAt: record.expires_at,
    ...(record.released_at ? { releasedAt: record.released_at } : {}),
    updatedAt: record.updated_at,
  };
}

function holderToRecord(holder: TaskWorkspaceHolder): TaskWorkspaceHolderRecord {
  return {
    id: holderKey(holder),
    workspace_id: holder.workspaceId,
    project_id: holder.projectId,
    task_id: holder.taskId,
    file_library_id: holder.fileLibraryId,
    task_home_segment: holder.taskHomeSegment,
    binding_generation: holder.bindingGeneration,
    holder_id: holder.holderId,
    holder_kind: holder.holderKind,
    lease_epoch: holder.leaseEpoch,
    holder_state: holder.holderState,
    issued_at: holder.issuedAt,
    expires_at: holder.expiresAt,
    ...(holder.releasedAt ? { released_at: holder.releasedAt } : {}),
    updated_at: holder.updatedAt,
  };
}

function isCompletedRuntimeAccessReleaseFence(record: TaskFileLibraryBindingRecord): boolean {
  if (record.binding_state !== 'releasing') return false;
  return record.correlation_id.startsWith('release:complete:');
}

function isExpiredRuntimeAccessReleaseFence(input: {
  record: TaskFileLibraryBindingRecord;
  now: string;
}): boolean {
  const updatedAtMs = Date.parse(input.record.updated_at);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs - updatedAtMs > RUNTIME_ACCESS_RELEASE_FENCE_LEASE_TTL_MS;
}

export class JsonDocTaskFileLibraryBindingRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  private async expireCompletedRuntimeAccessReleaseFenceIfNeeded(
    record: TaskFileLibraryBindingRecord,
    now: string,
  ): Promise<TaskFileLibraryBindingRecord | null> {
    if (
      !isCompletedRuntimeAccessReleaseFence(record)
      || !isExpiredRuntimeAccessReleaseFence({ record, now })
    ) {
      return record;
    }
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      record.id,
      {
        expected: {
          task_id: record.task_id,
          binding_generation: record.binding_generation,
          binding_state: 'releasing',
          correlation_id: record.correlation_id,
        },
        patch: {
          binding_state: 'bound',
          updated_at: now,
          correlation_id: `${record.correlation_id}:lease_expired`,
        },
      },
    );
    if (result.ok) {
      return result.doc;
    }
    return result.current ?? null;
  }

  async find(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    now?: string;
  }): Promise<TaskFileLibraryBinding | null> {
    const record = await this.docStore.get<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
    );
    if (!record) {
      uncacheBinding(input);
      return null;
    }
    if (
      record.workspace_id !== input.workspaceId
      || record.project_id !== input.projectId
      || record.file_library_id !== input.fileLibraryId
    ) {
      uncacheBinding(input);
      return null;
    }
    const current = await this.expireCompletedRuntimeAccessReleaseFenceIfNeeded(
      record,
      input.now ?? this.nowIso(),
    );
    if (!current) {
      uncacheBinding(input);
      return null;
    }
    const binding = recordToBinding(current);
    cacheBinding(binding);
    return binding;
  }

  async listByProject(input: {
    workspaceId: string;
    projectId: string;
  }): Promise<TaskFileLibraryBinding[]> {
    const records = await this.docStore.list<TaskFileLibraryBindingRecord>(BINDINGS_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
    });
    const now = this.nowIso();
    const currentRecords = await Promise.all(
      records.map((record) => this.expireCompletedRuntimeAccessReleaseFenceIfNeeded(record, now)),
    );
    const bindings = currentRecords
      .filter((record): record is TaskFileLibraryBindingRecord => record !== null)
      .map(recordToBinding);
    for (const binding of bindings) {
      cacheBinding(binding);
    }
    return bindings;
  }

  async acquire(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    taskTitle: string;
    taskStatus: 'active' | 'archived';
    ownerUserId: string;
    runtimeWritableAffordance: RuntimeWritableAffordance;
    correlationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    binding: TaskFileLibraryBinding;
  } | {
    ok: false;
    code: 'AGENT_TASK_FILE_LIBRARY_IN_USE';
    binding: TaskFileLibraryBinding;
  }> {
    const now = input.now ?? this.nowIso();
    const binding: TaskFileLibraryBinding = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: input.fileLibraryId,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      taskStatus: input.taskStatus,
      ownerUserId: input.ownerUserId,
      bindingGeneration: nextBindingGeneration(),
      runtimeWritableAffordance: input.runtimeWritableAffordance,
      bindingState: 'bound',
      correlationId: input.correlationId,
    };
    const result = await this.docStore.createIfAbsent<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
      bindingToRecord({
        ...binding,
        acquiredAt: now,
        updatedAt: now,
      }),
    );
    if (result.ok) {
      cacheBinding(binding);
      return { ok: true, binding };
    }
    const existing = recordToBinding(result.current);
    cacheBinding(existing);
    return {
      ok: false,
      code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      binding: existing,
    };
  }

  async updateFromTask(task: HydratableTaskRecord): Promise<void> {
    const binding = bindingFromTask(task);
    if (!binding) return;
    const existing = await this.find(binding);
    if (!existing || existing.taskId !== binding.taskId) return;
    const now = new Date().toISOString();
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(binding),
      {
        expected: {
          task_id: existing.taskId,
          binding_generation: existing.bindingGeneration,
        },
        patch: {
          task_title: binding.taskTitle,
          task_status: binding.taskStatus,
          updated_at: now,
        },
      },
    );
    if (result.ok) {
      cacheBinding(recordToBinding(result.doc));
    }
  }

  async release(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId?: string | null;
    taskId: string;
    bindingGeneration?: number | null;
    correlationId: string;
  }): Promise<{
    ok: true;
    released: boolean;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    binding: TaskFileLibraryBinding;
  }> {
    const fileLibraryId = input.fileLibraryId?.trim();
    if (!fileLibraryId) return { ok: true, released: false };
    const existing = await this.find({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId,
    });
    if (!existing) {
      return { ok: true, released: false };
    }
    const bindingGeneration = input.bindingGeneration ?? existing.bindingGeneration;
    const result = await this.docStore.deleteIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        fileLibraryId,
      }),
      {
        expected: {
          task_id: input.taskId,
          binding_generation: bindingGeneration,
          binding_state: 'bound',
        },
      },
    );
    if (result.ok) {
      uncacheBinding({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        fileLibraryId,
      });
      return { ok: true, released: result.deleted };
    }
    if (!result.current) {
      return { ok: true, released: false };
    }
    const current = recordToBinding(result.current);
    cacheBinding(current);
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: current,
    };
  }

  async beginRuntimeAccessRelease(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    bindingGeneration: number;
    correlationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    binding: TaskFileLibraryBinding;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    binding: TaskFileLibraryBinding | null;
  }> {
    const now = input.now ?? this.nowIso();
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
      {
        expected: {
          task_id: input.taskId,
          binding_generation: input.bindingGeneration,
          binding_state: 'bound',
        },
        patch: {
          binding_state: 'releasing',
          updated_at: now,
          correlation_id: input.correlationId,
        },
      },
    );
    if (result.ok) {
      const binding = recordToBinding(result.doc);
      cacheBinding(binding);
      return { ok: true, binding };
    }
    if (!result.current) {
      uncacheBinding(input);
      return {
        ok: false,
        code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
        binding: null,
      };
    }
    const current = recordToBinding(result.current);
    cacheBinding(current);
    if (
      current.taskId === input.taskId
      && current.bindingGeneration === input.bindingGeneration
      && current.bindingState === 'releasing'
      && current.correlationId === input.correlationId
    ) {
      return { ok: true, binding: current };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: current,
    };
  }

  async rollbackRuntimeAccessRelease(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    bindingGeneration: number;
    correlationId: string;
    expectedCorrelationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    rolledBack: boolean;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    binding: TaskFileLibraryBinding;
  }> {
    const now = input.now ?? this.nowIso();
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
      {
        expected: {
          task_id: input.taskId,
          binding_generation: input.bindingGeneration,
          binding_state: 'releasing',
          correlation_id: input.expectedCorrelationId,
        },
        patch: {
          binding_state: 'bound',
          updated_at: now,
          correlation_id: input.correlationId,
        },
      },
    );
    if (result.ok) {
      cacheBinding(recordToBinding(result.doc));
      return { ok: true, rolledBack: true };
    }
    if (!result.current) {
      uncacheBinding(input);
      return { ok: true, rolledBack: false };
    }
    const current = recordToBinding(result.current);
    cacheBinding(current);
    if (
      current.taskId === input.taskId
      && current.bindingGeneration === input.bindingGeneration
      && current.bindingState === 'bound'
    ) {
      return { ok: true, rolledBack: false };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: current,
    };
  }

  async claimRuntimeAccessReleaseForRestore(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    bindingGeneration: number;
    releaseCorrelationId: string;
    restoreCorrelationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    claimed: boolean;
    binding: TaskFileLibraryBinding | null;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    binding: TaskFileLibraryBinding;
  }> {
    const now = input.now ?? this.nowIso();
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
      {
        expected: {
          task_id: input.taskId,
          binding_generation: input.bindingGeneration,
          binding_state: 'releasing',
          correlation_id: input.releaseCorrelationId,
        },
        patch: {
          updated_at: now,
          correlation_id: input.restoreCorrelationId,
        },
      },
    );
    if (result.ok) {
      const binding = recordToBinding(result.doc);
      cacheBinding(binding);
      return { ok: true, claimed: true, binding };
    }
    if (!result.current) {
      uncacheBinding(input);
      return { ok: true, claimed: false, binding: null };
    }
    const current = recordToBinding(result.current);
    cacheBinding(current);
    if (
      current.taskId === input.taskId
      && current.bindingGeneration === input.bindingGeneration
      && current.bindingState === 'releasing'
      && current.correlationId === input.restoreCorrelationId
    ) {
      return { ok: true, claimed: false, binding: current };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: current,
    };
  }

  async completeRuntimeAccessRelease(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    bindingGeneration: number;
    expectedCorrelationId: string;
    correlationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    released: boolean;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    binding: TaskFileLibraryBinding;
  }> {
    const now = input.now ?? this.nowIso();
    const result = await this.docStore.updateIfMatch<TaskFileLibraryBindingRecord>(
      BINDINGS_COLLECTION,
      bindingKey(input),
      {
        expected: {
          task_id: input.taskId,
          binding_generation: input.bindingGeneration,
          binding_state: 'releasing',
          correlation_id: input.expectedCorrelationId,
        },
        patch: {
          updated_at: now,
          correlation_id: input.correlationId,
        },
      },
    );
    if (result.ok) {
      cacheBinding(recordToBinding(result.doc));
      return { ok: true, released: true };
    }
    if (!result.current) {
      uncacheBinding(input);
      return { ok: true, released: false };
    }
    const current = recordToBinding(result.current);
    cacheBinding(current);
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: current,
    };
  }
}

export class JsonDocTaskWorkspaceHolderRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async acquire(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    fileLibraryId: string;
    taskHomeSegment: string;
    bindingGeneration: number;
    holderId: string;
    holderKind: TaskWorkspaceHolderKind;
    leaseEpoch: string;
    issuedAt: string;
    expiresAt: string;
  }): Promise<{
    ok: true;
    holder: TaskWorkspaceHolder;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    holder: TaskWorkspaceHolder;
  }> {
    const holder: TaskWorkspaceHolder = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      fileLibraryId: input.fileLibraryId,
      taskHomeSegment: input.taskHomeSegment,
      bindingGeneration: input.bindingGeneration,
      holderId: input.holderId,
      holderKind: input.holderKind,
      leaseEpoch: input.leaseEpoch,
      holderState: 'active',
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      updatedAt: input.issuedAt,
    };
    const result = await this.docStore.createIfAbsent<TaskWorkspaceHolderRecord>(
      WORKSPACE_HOLDERS_COLLECTION,
      holderKey(holder),
      holderToRecord(holder),
    );
    if (result.ok) {
      return { ok: true, holder };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      holder: holderRecordToHolder(result.current),
    };
  }

  async adopt(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    holderId: string;
    bindingGeneration: number;
    leaseEpoch: string;
    adoptedAt: string;
    expiresAt: string;
  }): Promise<{
    ok: true;
    holder: TaskWorkspaceHolder;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    holder: TaskWorkspaceHolder | null;
  }> {
    const result = await this.docStore.updateIfMatch<TaskWorkspaceHolderRecord>(
      WORKSPACE_HOLDERS_COLLECTION,
      holderKey(input),
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          task_id: input.taskId,
          holder_id: input.holderId,
          binding_generation: input.bindingGeneration,
          lease_epoch: input.leaseEpoch,
          holder_state: 'active',
        },
        patch: {
          expires_at: input.expiresAt,
          updated_at: input.adoptedAt,
        },
      },
    );
    if (result.ok) {
      return { ok: true, holder: holderRecordToHolder(result.doc) };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      holder: result.current ? holderRecordToHolder(result.current) : null,
    };
  }

  async release(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    fileLibraryId: string;
    holderId: string;
    bindingGeneration: number;
    leaseEpoch: string;
    releasedAt: string;
  }): Promise<{
    ok: true;
    released: boolean;
  } | {
    ok: false;
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
    holder: TaskWorkspaceHolder | null;
  }> {
    const result = await this.docStore.updateIfMatch<TaskWorkspaceHolderRecord>(
      WORKSPACE_HOLDERS_COLLECTION,
      holderKey(input),
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          task_id: input.taskId,
          file_library_id: input.fileLibraryId,
          holder_id: input.holderId,
          binding_generation: input.bindingGeneration,
          lease_epoch: input.leaseEpoch,
          holder_state: 'active',
        },
        patch: {
          holder_state: 'released',
          released_at: input.releasedAt,
          updated_at: input.releasedAt,
        },
      },
    );
    if (result.ok) {
      return { ok: true, released: true };
    }
    if (!result.current) {
      return { ok: true, released: false };
    }
    return {
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      holder: holderRecordToHolder(result.current),
    };
  }

  async repairExpiredHolders(input: {
    workspaceId: string;
    projectId: string;
    taskId?: string;
    now: string;
  }): Promise<void> {
    const records = await this.docStore.list<TaskWorkspaceHolderRecord>(WORKSPACE_HOLDERS_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      holder_state: 'active',
      ...(input.taskId ? { task_id: input.taskId } : {}),
    });
    for (const record of records) {
      if (Date.parse(record.expires_at) > Date.parse(input.now)) continue;
      await this.docStore.updateIfMatch<TaskWorkspaceHolderRecord>(
        WORKSPACE_HOLDERS_COLLECTION,
        record.id,
        {
          expected: {
            workspace_id: record.workspace_id,
            project_id: record.project_id,
            task_id: record.task_id,
            holder_id: record.holder_id,
            binding_generation: record.binding_generation,
            lease_epoch: record.lease_epoch,
            holder_state: 'active',
          },
          patch: {
            holder_state: 'expired',
            released_at: input.now,
            updated_at: input.now,
          },
        },
      );
    }
  }

  async listLiveByTask(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    bindingGeneration?: number | null;
    now?: string;
  }): Promise<TaskWorkspaceHolder[]> {
    const now = input.now ?? new Date().toISOString();
    await this.repairExpiredHolders({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      now,
    });
    const records = await this.docStore.list<TaskWorkspaceHolderRecord>(WORKSPACE_HOLDERS_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      task_id: input.taskId,
      holder_state: 'active',
    });
    const nowMs = Date.parse(now);
    return records
      .filter((record) => (
        Date.parse(record.expires_at) > nowMs
        && (
          typeof input.bindingGeneration !== 'number'
          || record.binding_generation === input.bindingGeneration
        )
      ))
      .map(holderRecordToHolder);
  }

  async releaseByProject(input: {
    workspaceId: string;
    projectId: string;
    releasedAt: string;
  }): Promise<number> {
    const records = await this.docStore.list<TaskWorkspaceHolderRecord>(WORKSPACE_HOLDERS_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      holder_state: 'active',
    });
    let released = 0;
    for (const record of records) {
      const result = await this.docStore.updateIfMatch<TaskWorkspaceHolderRecord>(
        WORKSPACE_HOLDERS_COLLECTION,
        record.id,
        {
          expected: {
            workspace_id: record.workspace_id,
            project_id: record.project_id,
            task_id: record.task_id,
            holder_id: record.holder_id,
            binding_generation: record.binding_generation,
            lease_epoch: record.lease_epoch,
            holder_state: 'active',
          },
          patch: {
            holder_state: 'released',
            released_at: input.releasedAt,
            updated_at: input.releasedAt,
          },
        },
      );
      if (result.ok) {
        released += 1;
      }
    }
    return released;
  }
}

export async function hydrateTaskFileLibraryBindingsForProject(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  tasks?: HydratableTaskRecord[];
}): Promise<void> {
  const repo = new JsonDocTaskFileLibraryBindingRepo(args.docStore);
  const currentBindings = await repo.listByProject({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
  });
  const currentKeys = new Set(currentBindings.map(bindingKey));
  if (args.tasks) {
    for (const task of args.tasks) {
      if (task.workspace_id !== args.workspaceId || task.project_id !== args.projectId) continue;
      const binding = bindingFromTask(task);
      if (!binding || currentKeys.has(bindingKey(binding))) continue;
      const acquired = await repo.acquire({
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        fileLibraryId: binding.fileLibraryId,
        taskId: binding.taskId,
        taskTitle: binding.taskTitle,
        taskStatus: binding.taskStatus,
        ownerUserId: binding.ownerUserId,
        runtimeWritableAffordance: binding.runtimeWritableAffordance,
        correlationId: binding.correlationId,
      });
      if (acquired.ok) {
        currentKeys.add(bindingKey(acquired.binding));
      }
    }
  }
}

export async function findTaskFileLibraryBinding(input: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
}): Promise<TaskFileLibraryBinding | null> {
  return new JsonDocTaskFileLibraryBindingRepo(input.docStore).find(input);
}

export async function acquireTaskFileLibraryBinding(input: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: 'active' | 'archived';
  ownerUserId: string;
  runtimeWritableAffordance: RuntimeWritableAffordance;
  correlationId: string;
  now?: string;
}): Promise<Awaited<ReturnType<JsonDocTaskFileLibraryBindingRepo['acquire']>>> {
  return new JsonDocTaskFileLibraryBindingRepo(input.docStore).acquire(input);
}

export async function updateTaskFileLibraryBinding(input: {
  docStore: JsonDocStorePort;
  task: HydratableTaskRecord;
}): Promise<void> {
  await new JsonDocTaskFileLibraryBindingRepo(input.docStore).updateFromTask(input.task);
}

export async function releaseTaskFileLibraryBinding(input: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  fileLibraryId?: string | null;
  taskId: string;
  bindingGeneration?: number | null;
  correlationId: string;
}): Promise<Awaited<ReturnType<JsonDocTaskFileLibraryBindingRepo['release']>>> {
  return new JsonDocTaskFileLibraryBindingRepo(input.docStore).release(input);
}

export function buildFileLibraryTaskHomeBindingFields(input: {
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): FileLibraryTaskHomeBindingFields {
  if (!input.binding) {
    return {
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    };
  }
  const safeFields = buildBoundTaskSafeFields({
    binding: input.binding,
    actorUserId: input.actorUserId,
  });
  return {
    task_home_binding_status: 'bound',
    ...safeFields,
  };
}

export function buildBoundTaskSafeFields(input: {
  binding: TaskFileLibraryBinding;
  actorUserId: string;
}): BoundTaskSafeFields {
  const visible = input.binding.ownerUserId === input.actorUserId;
  return {
    bound_task_visible: visible,
    ...(visible
      ? {
        bound_task_id: input.binding.taskId,
        bound_task_title: input.binding.taskTitle,
        bound_task_status: input.binding.taskStatus,
      }
      : {}),
  };
}

export function __resetTaskFileLibraryBindingsForTests(): void {
  BINDING_CACHE_BY_LIBRARY.clear();
}
