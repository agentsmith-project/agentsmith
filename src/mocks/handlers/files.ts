import { http, HttpResponse } from 'msw';
import type {
  FileLibrary,
  FileLibraryRestoreOperation,
  FileLibrarySavePoint,
  FileLibraryVersionOperation,
  TaskFileTemplate,
} from '@/lib/api/types';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docFileLibraries } from '../doc-fixtures/workspace-projects';
import { docObjectDbByLibraryId } from '../doc-fixtures/files';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';

const API_V1_PATTERN = '*/api/v1';
const MOCK_SAVE_POINTS_PENDING_HEADER = 'x-mock-file-library-save-points-pending';

type ObjectRow =
  | { kind: 'prefix'; prefix: string; name: string }
  | { kind: 'object'; key: string; name: string; size_bytes: number; content_type: string; last_modified: string; content?: string };

type MockUploadFile = {
  name: string;
  size: number;
  type?: string;
  content?: string;
  text?: () => Promise<string>;
};
type UploadFormFile = FormDataEntryValue & MockUploadFile;

type MockTaskHomeBinding = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: 'active' | 'archived';
  visible: boolean;
};

type MockFileLibrarySavePoint = FileLibrarySavePoint & {
  workspace_id: string;
  project_id: string;
  purpose: 'user' | 'task_template_source';
  snapshot: ObjectRow[];
};

type MockFileLibraryRestoreOperation = FileLibraryRestoreOperation & {
  workspace_id: string;
  project_id: string;
  idempotency_key: string;
  terminal_projection_expires_at_ms?: number;
};

type MockFileLibraryVersionOperation = FileLibraryVersionOperation & {
  workspace_id: string;
  project_id: string;
  library_id: string;
  idempotency_key?: string;
  active_projection_count: number;
};

type MockTaskFileTemplate = TaskFileTemplate & {
  snapshot: ObjectRow[];
  idempotency_key?: string;
};

const taskHomeBindingsByLibrary = new Map<string, MockTaskHomeBinding>();
const runtimeAccessByLibrary = new Set<string>();
const savePointsById = new Map<string, MockFileLibrarySavePoint>();
const versionOperationsById = new Map<string, MockFileLibraryVersionOperation>();
const versionOperationIdsByIdempotencyKey = new Map<string, string>();
const restoreOperationsById = new Map<string, MockFileLibraryRestoreOperation>();
const restoreOperationIdsByIdempotencyKey = new Map<string, string>();
const taskFileTemplatesById = new Map<string, MockTaskFileTemplate>();
const taskFileTemplateIdsByIdempotencyKey = new Map<string, string>();
const RECENT_TERMINAL_RESTORE_OPERATION_PROJECTION_WINDOW_MS = 30_000;

function bindingKey(input: { workspaceId: string; projectId: string; libraryId: string }) {
  return `${input.workspaceId}:${input.projectId}:${input.libraryId}`;
}

export function bindMockFileLibraryTaskHome(input: MockTaskHomeBinding) {
  const key = bindingKey(input);
  taskHomeBindingsByLibrary.set(key, input);
  if (input.taskStatus === 'active') {
    runtimeAccessByLibrary.add(key);
  } else {
    runtimeAccessByLibrary.delete(key);
  }
}

export function releaseMockFileLibraryTaskHome(input: { workspaceId: string; projectId: string; libraryId: string; taskId?: string }) {
  const key = bindingKey(input);
  const existing = taskHomeBindingsByLibrary.get(key);
  if (!existing) return;
  if (input.taskId && existing.taskId !== input.taskId) return;
  taskHomeBindingsByLibrary.delete(key);
  runtimeAccessByLibrary.delete(key);
}

export function getMockFileLibraryTaskHomeBinding(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return taskHomeBindingsByLibrary.get(bindingKey(input)) ?? null;
}

function releaseMockFileLibraryRuntimeAccess(input: { workspaceId: string; projectId: string; libraryId: string }) {
  return runtimeAccessByLibrary.delete(bindingKey(input));
}

function getMockFileLibraryActiveWriterBinding(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  const binding = getMockFileLibraryTaskHomeBinding(input);
  if (!binding || !runtimeAccessByLibrary.has(bindingKey(input))) return null;
  return binding;
}

export function getMockFileLibrary(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return sourceLibraries.find((library) =>
    library.workspace_id === input.workspaceId
    && library.project_id === input.projectId
    && library.id === input.libraryId,
  ) ?? null;
}

function withTaskHomeBinding(library: FileLibrary): FileLibrary {
  const binding = getMockFileLibraryTaskHomeBinding({
    workspaceId: library.workspace_id,
    projectId: library.project_id,
    libraryId: library.id,
  });
  if (!binding) {
    const base = { ...library };
    delete base.bound_task_id;
    delete base.bound_task_title;
    delete base.bound_task_status;
    return {
      ...base,
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    };
  }
  return {
    ...library,
    task_home_binding_status: 'bound',
    bound_task_visible: binding.visible,
    ...(binding.visible
      ? {
          bound_task_id: binding.taskId,
          bound_task_title: binding.taskTitle,
          bound_task_status: binding.taskStatus,
        }
      : {}),
  };
}

export function ensureMockFileLibraryForTask(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  name: string;
  createdByUserId: string;
  now: string;
}) {
  const existing = sourceLibraries.find((library) => library.id === input.libraryId);
  if (existing) return withTaskHomeBinding(existing);
  const created: FileLibrary = {
    id: input.libraryId,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    name: input.name,
    description: '',
    visibility: 'shared',
    source: 'agent_task_files',
    status: 'ready',
    storage_status: 'available',
    storage_next_action: null,
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    created_by_user_id: input.createdByUserId,
    created_at: input.now,
    updated_at: input.now,
  };
  sourceLibraries.push(created);
  objectDbByLibraryId[input.libraryId] = objectDbByLibraryId[input.libraryId] ?? [];
  return withTaskHomeBinding(created);
}

const sourceLibraries: FileLibrary[] = DOC_FIXTURES_ENABLED ? [...docFileLibraries] : [
  {
    id: 'lib_shared_default',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Shared Docs',
    description: 'Default shared library',
    visibility: 'shared' as const,
    source: 'agent_task_files' as const,
    status: 'ready' as const,
    storage_status: 'available' as const,
    storage_next_action: null,
    task_home_binding_status: 'unbound' as const,
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_policy_rules',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Policy Rules',
    description: 'Shared policy and governance references',
    visibility: 'shared' as const,
    source: 'agent_task_files' as const,
    status: 'ready' as const,
    storage_status: 'available' as const,
    storage_next_action: null,
    task_home_binding_status: 'unbound' as const,
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-02T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_product_specs',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Product Specs',
    description: 'Shared product and API specifications',
    visibility: 'shared' as const,
    source: 'agent_task_files' as const,
    status: 'ready' as const,
    storage_status: 'available' as const,
    storage_next_action: null,
    task_home_binding_status: 'unbound' as const,
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-03T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_large_bench',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Large Bench',
    description: 'Large directory benchmark fixture',
    visibility: 'shared' as const,
    source: 'agent_task_files' as const,
    status: 'ready' as const,
    storage_status: 'available' as const,
    storage_next_action: null,
    task_home_binding_status: 'unbound' as const,
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-04T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-04T00:00:00Z').toISOString(),
  },
];

export const mockFileNowIso = () => VISUAL_TEST_REFERENCE_NOW_ISO;
const nowIso = mockFileNowIso;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const failOnceCounters: Record<string, number> = {};

function shouldFailOnce(kind: 'delete' | 'download', key: string) {
  const marker = kind === 'delete' ? '__fail_once_delete__' : '__fail_once_download__';
  if (!key.includes(marker)) return false;
  const counterKey = `${kind}:${key}`;
  const count = failOnceCounters[counterKey] ?? 0;
  if (count > 0) return false;
  failOnceCounters[counterKey] = count + 1;
  return true;
}

const objectDbByLibraryId: Record<string, ObjectRow[]> = DOC_FIXTURES_ENABLED
  ? (docObjectDbByLibraryId as Record<string, ObjectRow[]>)
  : {
  lib_shared_default: [
    { kind: 'prefix', prefix: 'docs/', name: 'docs' },
    { kind: 'prefix', prefix: 'images/', name: 'images' },
    { kind: 'object', key: 'README.txt', name: 'README.txt', size_bytes: 42, content_type: 'text/plain', last_modified: nowIso(), content: 'Hello from Shared Docs\n' },
    { kind: 'object', key: 'docs/mbos-contracts.md', name: 'mbos-contracts.md', size_bytes: 1200, content_type: 'text/markdown', last_modified: nowIso(), content: '# Contracts\n' },
    { kind: 'object', key: 'images/logo.png', name: 'logo.png', size_bytes: 2048, content_type: 'image/png', last_modified: nowIso() },
  ],
  lib_policy_rules: [
    { kind: 'object', key: 'policies/README.md', name: 'README.md', size_bytes: 900, content_type: 'text/markdown', last_modified: nowIso(), content: '# Policies\n' },
  ],
  lib_product_specs: [
    { kind: 'object', key: 'specs/api/openapi.json', name: 'openapi.json', size_bytes: 1500, content_type: 'application/json', last_modified: nowIso(), content: '{\"openapi\":\"3.0.0\"}' },
  ],
  lib_large_bench: Array.from({ length: 260 }).map((_, index) => {
    const name = `bulk-${String(index + 1).padStart(4, '0')}.txt`;
    return {
      kind: 'object' as const,
      key: name,
      name,
      size_bytes: 100 + index,
      content_type: 'text/plain',
      last_modified: nowIso(),
      content: `bulk file ${index + 1}`,
    };
  }),
};

function cloneObjectRows(rows: ObjectRow[]): ObjectRow[] {
  return rows.map((row) => ({ ...row }));
}

function toPublicSavePoint(savePoint: MockFileLibrarySavePoint): FileLibrarySavePoint {
  return {
    id: savePoint.id,
    file_library_id: savePoint.file_library_id,
    ...(savePoint.message ? { message: savePoint.message } : {}),
    created_at: savePoint.created_at,
  };
}

function toPublicRestoreOperation(operation: MockFileLibraryRestoreOperation): FileLibraryRestoreOperation {
  return {
    id: operation.id,
    file_library_id: operation.file_library_id,
    source_save_point_id: operation.source_save_point_id,
    status: operation.status,
    ...(operation.failure_reason ? { failure_reason: operation.failure_reason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  };
}

function toPublicVersionOperation(operation: MockFileLibraryRestoreOperation): FileLibraryVersionOperation {
  return {
    id: operation.id,
    kind: 'restore',
    file_library_id: operation.file_library_id,
    source_save_point_id: operation.source_save_point_id,
    status: operation.status === 'pending'
      ? 'accepted'
      : operation.status === 'restoring'
        ? 'running'
        : operation.status,
    ...(operation.failure_reason ? { failure_reason: operation.failure_reason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  };
}

function toPublicMockVersionOperation(operation: MockFileLibraryVersionOperation): FileLibraryVersionOperation {
  return {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    ...(operation.file_library_id ? { file_library_id: operation.file_library_id } : {}),
    ...(operation.source_save_point_id ? { source_save_point_id: operation.source_save_point_id } : {}),
    ...(operation.message ? { message: operation.message } : {}),
    ...(operation.failure_reason ? { failure_reason: operation.failure_reason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  };
}

function toPublicTaskFileTemplate(template: MockTaskFileTemplate): TaskFileTemplate {
  return {
    id: template.id,
    workspace_id: template.workspace_id,
    project_id: template.project_id,
    source_library_id: template.source_library_id,
    ...(template.source_save_point_id ? { source_save_point_id: template.source_save_point_id } : {}),
    name: template.name,
    ...(template.description ? { description: template.description } : {}),
    status: template.status,
    created_by_user_id: template.created_by_user_id,
    created_at: template.created_at,
    updated_at: template.updated_at,
  };
}

function createMockFileLibrarySavePoint(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  message?: string;
  purpose?: 'user' | 'task_template_source';
}) {
  const now = nowIso();
  const savePoint: MockFileLibrarySavePoint = {
    id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    file_library_id: input.libraryId,
    purpose: input.purpose ?? 'user',
    ...(input.message ? { message: input.message } : {}),
    created_at: now,
    snapshot: cloneObjectRows(objectDbByLibraryId[input.libraryId] ?? []),
  };
  savePointsById.set(savePoint.id, savePoint);
  return savePoint;
}

function createMockVersionOperation(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  kind: FileLibraryVersionOperation['kind'];
  status: FileLibraryVersionOperation['status'];
  message?: string;
  idempotencyKey?: string;
}): MockFileLibraryVersionOperation {
  const now = nowIso();
  const operation: MockFileLibraryVersionOperation = {
    id: `flop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    library_id: input.libraryId,
    file_library_id: input.libraryId,
    kind: input.kind,
    status: input.status,
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    ...(input.message ? { message: input.message } : {}),
    created_at: now,
    updated_at: now,
    active_projection_count: 0,
  };
  versionOperationsById.set(operation.id, operation);
  return operation;
}

function isMockVersionOperationActive(operation: MockFileLibraryVersionOperation) {
  return operation.status === 'accepted' || operation.status === 'running';
}

function advanceMockVersionOperationForActiveProjection(
  operation: MockFileLibraryVersionOperation,
): MockFileLibraryVersionOperation | null {
  if (!isMockVersionOperationActive(operation)) {
    return null;
  }
  operation.active_projection_count += 1;
  if (operation.status === 'accepted') {
    operation.status = 'running';
    operation.updated_at = nowIso();
    versionOperationsById.set(operation.id, operation);
    return operation;
  }
  operation.status = 'succeeded';
  operation.updated_at = nowIso();
  versionOperationsById.set(operation.id, operation);
  return null;
}

function getMockTaskFileTemplate(input: {
  workspaceId: string;
  projectId: string;
  templateId: string;
}) {
  const template = taskFileTemplatesById.get(input.templateId);
  if (
    !template
    || template.workspace_id !== input.workspaceId
    || template.project_id !== input.projectId
  ) {
    return null;
  }
  return template;
}

export function cloneMockTaskFileTemplateIntoLibrary(input: {
  workspaceId: string;
  projectId: string;
  templateId: string;
  libraryId: string;
  name: string;
  createdByUserId: string;
  now: string;
}) {
  const template = getMockTaskFileTemplate({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    templateId: input.templateId,
  });
  if (!template || template.status !== 'published') return null;
  const library = ensureMockFileLibraryForTask({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    name: input.name,
    createdByUserId: input.createdByUserId,
    now: input.now,
  });
  objectDbByLibraryId[input.libraryId] = cloneObjectRows(template.snapshot);
  return library;
}

if (!DOC_FIXTURES_ENABLED) {
  taskFileTemplatesById.set('tmpl_starter_files', {
    id: 'tmpl_starter_files',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    source_library_id: 'lib_shared_default',
    source_save_point_id: 'sp_starter_files_seed',
    name: 'Starter task files',
    description: 'Published starter files for new tasks',
    status: 'published',
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-06T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-06T00:00:00Z').toISOString(),
    snapshot: cloneObjectRows(objectDbByLibraryId.lib_shared_default ?? []),
  });
}

function buildFixtureLibrary(input: {
  id: string;
  name: string;
  status?: FileLibrary['status'];
}): FileLibrary {
  return {
    id: input.id,
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: input.name,
    description: '',
    visibility: 'shared',
    source: 'agent_task_files',
    status: input.status ?? 'ready',
    storage_status: input.status === 'ready' ? 'available' : 'unavailable',
    storage_next_action: input.status === 'ready' ? null : 'retry',
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-05T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-05T00:00:00Z').toISOString(),
  };
}

function ensureSourceLibraryFixture(library: FileLibrary, objects: ObjectRow[] = []) {
  if (!sourceLibraries.some((item) => item.id === library.id)) {
    sourceLibraries.push(library);
  }
  objectDbByLibraryId[library.id] = objectDbByLibraryId[library.id] ?? objects;
}

ensureSourceLibraryFixture(buildFixtureLibrary({
  id: 'lib_msw_deleting',
  name: 'Deleting Workspace',
  status: 'deleting',
}));
ensureSourceLibraryFixture(buildFixtureLibrary({
  id: 'lib_msw_active_bound',
  name: 'Active Bound Workspace',
}));
ensureSourceLibraryFixture(buildFixtureLibrary({
  id: 'lib_msw_archived_bound',
  name: 'Archived Bound Workspace',
}));
ensureSourceLibraryFixture(buildFixtureLibrary({
  id: 'lib_msw_redacted_bound',
  name: 'Redacted Bound Workspace',
}));
ensureSourceLibraryFixture(buildFixtureLibrary({
  id: 'lib_msw_nonempty',
  name: 'Non-empty Workspace',
}), [
  {
    kind: 'object',
    key: 'README.txt',
    name: 'README.txt',
    size_bytes: 42,
    content_type: 'text/plain',
    last_modified: nowIso(),
    content: 'non-empty',
  },
]);

bindMockFileLibraryTaskHome({
  workspaceId: 'ws_default',
  projectId: 'proj_001',
  libraryId: 'lib_msw_active_bound',
  taskId: 'task_msw_active_bound',
  taskTitle: 'Visible active task',
  taskStatus: 'active',
  visible: true,
});
bindMockFileLibraryTaskHome({
  workspaceId: 'ws_default',
  projectId: 'proj_001',
  libraryId: 'lib_msw_archived_bound',
  taskId: 'task_msw_archived_bound',
  taskTitle: 'Visible archived task',
  taskStatus: 'archived',
  visible: true,
});
bindMockFileLibraryTaskHome({
  workspaceId: 'ws_default',
  projectId: 'proj_001',
  libraryId: 'lib_msw_redacted_bound',
  taskId: 'task_msw_hidden_bound',
  taskTitle: 'Hidden task title',
  taskStatus: 'active',
  visible: false,
});

function fileLibraryNotFoundResponse(libraryId: string) {
  return HttpResponse.json({
    error_code: 'FILE_LIBRARY_NOT_FOUND',
    message: 'file_library_not_found',
    file_library_id: libraryId,
  }, { status: 404 });
}

function fileLibraryStatusConflictResponse(library: FileLibrary) {
  if (library.status === 'deleting') {
    return HttpResponse.json({
      error_code: 'FILE_LIBRARY_DELETING',
      message: 'file_library_deleting',
      file_library_id: library.id,
      file_library_status: library.status,
    }, { status: 409 });
  }
  return HttpResponse.json({
    error_code: 'FILE_LIBRARY_NOT_READY',
    message: 'file_library_not_ready',
    file_library_id: library.id,
    file_library_status: library.status,
  }, { status: 409 });
}

function fileLibraryActiveWriterBlockedResponse(input: {
  binding: MockTaskHomeBinding | null;
  libraryId: string;
}) {
  return HttpResponse.json({
    error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
    message: 'file_library_active_writer_blocked',
    file_library_id: input.libraryId,
    blockers: [{ code: 'active_writer_sessions' }],
    bound_task_visible: input.binding?.visible ?? false,
    ...(input.binding?.visible
      ? {
          bound_task_id: input.binding.taskId,
          bound_task_title: input.binding.taskTitle,
          bound_task_status: input.binding.taskStatus,
        }
      : {}),
  }, { status: 409 });
}

function findActiveRestoreOperation(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return Array.from(restoreOperationsById.values())
    .filter((operation) =>
      operation.workspace_id === input.workspaceId
      && operation.project_id === input.projectId
      && operation.file_library_id === input.libraryId
      && (operation.status === 'pending' || operation.status === 'restoring'),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function findRecentTerminalRestoreOperation(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return Array.from(restoreOperationsById.values())
    .filter((operation) =>
      operation.workspace_id === input.workspaceId
      && operation.project_id === input.projectId
      && operation.file_library_id === input.libraryId
      && (operation.status === 'succeeded' || operation.status === 'failed')
      && typeof operation.terminal_projection_expires_at_ms === 'number'
      && Date.now() <= operation.terminal_projection_expires_at_ms,
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function getRouteFileLibrary(params: { ws?: unknown; prj?: unknown; id?: unknown }) {
  return getMockFileLibrary({
    workspaceId: String(params.ws ?? ''),
    projectId: String(params.prj ?? ''),
    libraryId: String(params.id ?? ''),
  });
}

function rejectUnavailableFileLibraryWrite(params: { ws?: unknown; prj?: unknown; id?: unknown }) {
  const library = getRouteFileLibrary(params);
  if (!library) {
    return {
      library: null,
      response: fileLibraryNotFoundResponse(String(params.id ?? '')),
    };
  }
  if (library.status !== 'ready') {
    return {
      library,
      response: fileLibraryStatusConflictResponse(library),
    };
  }
  return { library, response: null };
}

function normalizePrefix(prefix: string | null): string {
  if (!prefix) return '';
  if (prefix === '/') return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function getFormString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function isUploadFileValue(value: FormDataEntryValue | null): value is UploadFormFile {
  if (!value || typeof value === 'string') return false;
  const candidate = value as Partial<MockUploadFile>;
  return typeof candidate.name === 'string' && typeof candidate.size === 'number';
}

function parseContentDispositionValue(value: string) {
  const result: { name?: string; filename?: string } = {};
  for (const part of value.split(';')) {
    const [rawKey, ...rawValueParts] = part.trim().split('=');
    const key = rawKey?.trim().toLowerCase();
    const rawValue = rawValueParts.join('=').trim();
    if (!key || !rawValue) continue;
    const unquoted = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
    if (key === 'name') result.name = unquoted;
    if (key === 'filename') result.filename = unquoted;
  }
  return result;
}

function readMultipartHeader(headers: string, headerName: string) {
  const prefix = `${headerName.toLowerCase()}:`;
  const line = headers
    .split(/\r?\n/)
    .find((item) => item.trim().toLowerCase().startsWith(prefix));
  if (!line) return '';
  return line.slice(line.indexOf(':') + 1).trim();
}

function getMultipartBoundary(contentType: string) {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? '';
}

function splitMultipartPart(part: string) {
  const trimmedStart = part.startsWith('\r\n')
    ? part.slice(2)
    : part.startsWith('\n')
      ? part.slice(1)
      : part;
  const separator = trimmedStart.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
  const separatorIndex = trimmedStart.indexOf(separator);
  if (separatorIndex < 0) return null;
  const headers = trimmedStart.slice(0, separatorIndex);
  let body = trimmedStart.slice(separatorIndex + separator.length);
  if (body.endsWith('\r\n')) body = body.slice(0, -2);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  return { headers, body };
}

async function parseMultipartUploadForm(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    return { file: null, prefix: '', overwrite: false };
  }

  const rawBody = await request.text().catch(() => '');
  const delimiter = `--${boundary}`;
  let file: MockUploadFile | null = null;
  let prefix = '';
  let overwrite = false;

  for (const part of rawBody.split(delimiter).slice(1)) {
    if (part.startsWith('--')) continue;
    const parsed = splitMultipartPart(part);
    if (!parsed) continue;
    const disposition = parseContentDispositionValue(
      readMultipartHeader(parsed.headers, 'content-disposition'),
    );
    if (!disposition.name) continue;
    if (disposition.filename !== undefined) {
      const partContentType = readMultipartHeader(parsed.headers, 'content-type') || 'application/octet-stream';
      file = {
        name: disposition.filename,
        type: partContentType,
        size: new TextEncoder().encode(parsed.body).byteLength,
        content: partContentType.startsWith('text/') ? parsed.body : undefined,
      };
      continue;
    }
    if (disposition.name === 'prefix') {
      prefix = parsed.body;
    }
    if (disposition.name === 'overwrite') {
      overwrite = parsed.body.toLowerCase() === 'true';
    }
  }

  return {
    file,
    prefix: normalizePrefix(prefix),
    overwrite,
  };
}

async function readUploadForm(request: Request) {
  const fallbackRequest = request.clone();
  try {
    const form = await request.formData();
    const file = form.get('file');
    return {
      file: isUploadFileValue(file) ? file : null,
      prefix: normalizePrefix(getFormString(form, 'prefix')),
      overwrite: getFormString(form, 'overwrite').toLowerCase() === 'true',
    };
  } catch {
    return parseMultipartUploadForm(fallbackRequest);
  }
}

function toFileLibraryEntries(items: ReturnType<typeof listObjects>) {
  return items.map((item) =>
    item.kind === 'prefix'
      ? {
          kind: 'directory' as const,
          path: item.prefix,
          name: item.name,
        }
      : {
          kind: 'file' as const,
          path: item.key,
          name: item.name,
          size_bytes: item.size_bytes,
          content_type: item.content_type,
          modified_at: item.last_modified,
        });
}

function listObjects(
  libraryId: string,
  prefix: string,
  options?: {
    search?: string;
    sortBy?: 'name' | 'size_bytes' | 'last_modified';
    sortOrder?: 'asc' | 'desc';
  },
) {
  const db = objectDbByLibraryId[libraryId] ?? [];
  const normalized = normalizePrefix(prefix);
  const search = options?.search?.trim().toLowerCase() ?? '';
  const hasSearch = search.length > 0;
  const sortBy = options?.sortBy ?? 'name';
  const sortOrder = options?.sortOrder ?? 'asc';
  const sortFactor = sortOrder === 'desc' ? -1 : 1;

  const prefixes = new Set<string>();
  const objects: ObjectRow[] = [];

  for (const row of db) {
    if (row.kind !== 'object') continue;
    // Hide folder markers from file rows; represent them as prefixes.
    if (row.key.endsWith('/')) {
      if (normalized && !row.key.startsWith(normalized)) continue;
      if (row.key !== normalized) prefixes.add(row.key);
      continue;
    }
    if (normalized && !row.key.startsWith(normalized)) continue;
    const rest = row.key.slice(normalized.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const folder = `${normalized}${rest.slice(0, slash + 1)}`;
      prefixes.add(folder);
      continue;
    }
    objects.push(row);
  }

  let prefixItems: ObjectRow[] = Array.from(prefixes)
    .map((p) => ({ kind: 'prefix' as const, prefix: p, name: basename(p) }))
    .sort((a, b) => {
      if (a.kind !== 'prefix' || b.kind !== 'prefix') return 0;
      return a.name.localeCompare(b.name) * sortFactor;
    });

  let objectItems = objects
    .slice()
    .sort((a, b) => {
      if (a.kind !== 'object' || b.kind !== 'object') return 0;
      if (sortBy === 'size_bytes') return (a.size_bytes - b.size_bytes) * sortFactor;
      if (sortBy === 'last_modified') return a.last_modified.localeCompare(b.last_modified) * sortFactor;
      return a.name.localeCompare(b.name) * sortFactor;
    })
    .map((o) => ({
      kind: 'object' as const,
      key: (o as Extract<ObjectRow, { kind: 'object' }>).key,
      name: (o as Extract<ObjectRow, { kind: 'object' }>).name,
      size_bytes: (o as Extract<ObjectRow, { kind: 'object' }>).size_bytes,
      content_type: (o as Extract<ObjectRow, { kind: 'object' }>).content_type,
      last_modified: (o as Extract<ObjectRow, { kind: 'object' }>).last_modified,
    }));

  if (hasSearch) {
    prefixItems = prefixItems.filter((item) => item.kind === 'prefix' && item.name.toLowerCase().includes(search));
    objectItems = objectItems.filter((item) => item.kind === 'object' && item.name.toLowerCase().includes(search));
  }

  return [...prefixItems, ...objectItems];
}

export const fileHandlers = [
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries`, ({ params }) => {
    const projectId = String(params.prj ?? '');
    const workspaceId = String(params.ws ?? '');
    return HttpResponse.json({
      items: sourceLibraries.filter(
        (item) => item.project_id === projectId && item.workspace_id === workspaceId,
      ).map(withTaskHomeBinding),
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    if (!body.name) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', message: 'invalid_request' },
        { status: 400 },
      );
    }
    const now = nowIso();
    const id = `flib_${Date.now()}`;
    const created = {
      id,
      workspace_id: String(params.ws ?? ''),
      project_id: String(params.prj ?? ''),
      name: body.name,
      description: body.description ?? '',
      visibility: 'shared' as const,
      source: 'agent_task_files' as const,
      status: 'ready' as const,
      storage_status: 'available' as const,
      storage_next_action: null,
      task_home_binding_status: 'unbound' as const,
      bound_task_visible: false,
      created_by_user_id: 'user_001',
      created_at: now,
      updated_at: now,
    };
    sourceLibraries.push(created);
    objectDbByLibraryId[id] = [];
    return HttpResponse.json(withTaskHomeBinding(created), { status: 201 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id`, ({ params }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    return HttpResponse.json(withTaskHomeBinding(library));
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/save-points`, ({ params, request }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const libraryId = String(params.id ?? '');
    const forcedPendingLibraryId = request.headers.get(MOCK_SAVE_POINTS_PENDING_HEADER)?.trim();
    if (forcedPendingLibraryId === '*' || forcedPendingLibraryId === libraryId) {
      return HttpResponse.json({
        error_code: 'FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING',
        message: 'file_library_save_point_list_pending',
        request_id: 'mock-save-points-pending',
        operation_status: 'pending',
        retry_after_ms: 2_000,
      }, { status: 409 });
    }
    const items = Array.from(savePointsById.values())
      .filter((savePoint) =>
        savePoint.workspace_id === workspaceId
        && savePoint.project_id === projectId
        && savePoint.file_library_id === libraryId
        && savePoint.purpose === 'user',
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(toPublicSavePoint);
    return HttpResponse.json({ items });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/operations/active`, ({ params }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const libraryId = String(params.id ?? '');
    const operation = findActiveRestoreOperation({
      workspaceId,
      projectId,
      libraryId,
    });
    const recentTerminalRestore = operation
      ? null
      : findRecentTerminalRestoreOperation({
          workspaceId,
          projectId,
          libraryId,
        });
    const versionOperation = Array.from(versionOperationsById.values())
      .filter((item) =>
        item.workspace_id === workspaceId
        && item.project_id === projectId
        && item.library_id === libraryId
        && isMockVersionOperationActive(item),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
    const restoreProjection = operation ?? recentTerminalRestore;
    const publicRestore = restoreProjection ? toPublicVersionOperation(restoreProjection) : null;
    const reconciledVersionOperation = versionOperation
      ? advanceMockVersionOperationForActiveProjection(versionOperation)
      : null;
    const publicVersion = reconciledVersionOperation
      ? toPublicMockVersionOperation(reconciledVersionOperation)
      : null;
    const latest = [publicRestore, publicVersion]
      .filter((item): item is FileLibraryVersionOperation => item !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
    return HttpResponse.json({
      operation: latest,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/save-points`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
    if (!idempotencyKey) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'idempotency_key_required',
      }, { status: 422 });
    }
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const libraryId = String(params.id ?? '');
    const idempotencyScope = `${workspaceId}:${projectId}:${libraryId}:save_point_create:${idempotencyKey}`;
    const existingOperationId = versionOperationIdsByIdempotencyKey.get(idempotencyScope);
    const existingOperation = existingOperationId ? versionOperationsById.get(existingOperationId) : null;
    if (existingOperation) {
      return HttpResponse.json(toPublicMockVersionOperation(existingOperation), { status: 202 });
    }
    const savePoint = createMockFileLibrarySavePoint({
      workspaceId,
      projectId,
      libraryId,
      message: typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message.trim()
        : undefined,
    });
    const operation = createMockVersionOperation({
      workspaceId,
      projectId,
      libraryId,
      kind: 'save_point_create',
      status: 'accepted',
      message: savePoint.message,
      idempotencyKey,
    });
    versionOperationIdsByIdempotencyKey.set(idempotencyScope, operation.id);
    return HttpResponse.json(toPublicMockVersionOperation(operation), { status: 202 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/restore`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const body = (await request.json().catch(() => ({}))) as {
      save_point_id?: string;
    };
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const libraryId = String(params.id ?? '');
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
    if (!idempotencyKey) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'idempotency_key_required',
      }, { status: 422 });
    }
    const existingOperationId = restoreOperationIdsByIdempotencyKey.get(`${workspaceId}:${projectId}:${libraryId}:${idempotencyKey}`);
    const existingOperation = existingOperationId ? restoreOperationsById.get(existingOperationId) : null;
    if (existingOperation) {
      return HttpResponse.json(toPublicRestoreOperation(existingOperation));
    }
    if (!body.save_point_id) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'invalid_restore_request',
      }, { status: 400 });
    }
    const savePoint = savePointsById.get(body.save_point_id);
    if (
      !savePoint
      || savePoint.workspace_id !== workspaceId
      || savePoint.project_id !== projectId
      || savePoint.file_library_id !== libraryId
    ) {
      return HttpResponse.json({
        error_code: 'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
        message: 'file_library_save_point_not_found',
        save_point_id: body.save_point_id,
      }, { status: 404 });
    }
    const activeOperation = findActiveRestoreOperation({ workspaceId, projectId, libraryId });
    if (activeOperation) {
      return HttpResponse.json({
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_operation_pending',
        operation_status: activeOperation.status,
        retry_after_ms: 2_000,
      }, { status: 409 });
    }
    const activeWriterBinding = getMockFileLibraryActiveWriterBinding({
      workspaceId,
      projectId,
      libraryId,
    });
    if (activeWriterBinding) {
      return fileLibraryActiveWriterBlockedResponse({
        binding: activeWriterBinding,
        libraryId,
      });
    }
    const now = nowIso();
    const operation: MockFileLibraryRestoreOperation = {
      id: `flro_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspace_id: workspaceId,
      project_id: projectId,
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      idempotency_key: idempotencyKey,
      status: 'succeeded',
      created_at: now,
      updated_at: now,
      terminal_projection_expires_at_ms: Date.now() + RECENT_TERMINAL_RESTORE_OPERATION_PROJECTION_WINDOW_MS,
    };
    objectDbByLibraryId[libraryId] = cloneObjectRows(savePoint.snapshot);
    restoreOperationsById.set(operation.id, operation);
    restoreOperationIdsByIdempotencyKey.set(`${workspaceId}:${projectId}:${libraryId}:${idempotencyKey}`, operation.id);
    return HttpResponse.json(toPublicRestoreOperation(operation));
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/runtime-access/release`, ({ params }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const libraryId = String(params.id ?? '');
    const binding = getMockFileLibraryTaskHomeBinding({
      workspaceId,
      projectId,
      libraryId,
    });
    const released = releaseMockFileLibraryRuntimeAccess({ workspaceId, projectId, libraryId });
    return HttpResponse.json({
      file_library_id: libraryId,
      released,
      runtime_access_status: 'released',
      task_home_binding_status: binding ? 'bound' : 'unbound',
    });
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
    const index = sourceLibraries.findIndex((item) =>
      item.workspace_id === String(params.ws ?? '')
      && item.project_id === String(params.prj ?? '')
      && item.id === params.id,
    );
    if (index === -1) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    if (sourceLibraries[index].status === 'deleting') {
      return fileLibraryStatusConflictResponse(sourceLibraries[index]);
    }
    sourceLibraries[index] = {
      ...sourceLibraries[index],
      ...body,
      updated_at: nowIso(),
    };
    return HttpResponse.json(withTaskHomeBinding(sourceLibraries[index]));
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id`, ({ params }) => {
    const index = sourceLibraries.findIndex((item) =>
      item.workspace_id === String(params.ws ?? '')
      && item.project_id === String(params.prj ?? '')
      && item.id === params.id,
    );
    if (index === -1) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const library = sourceLibraries[index];
    if (library.status !== 'ready') {
      return fileLibraryStatusConflictResponse(library);
    }
    const binding = getMockFileLibraryTaskHomeBinding({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      libraryId: String(params.id ?? ''),
    });
    if (binding) {
      return HttpResponse.json({
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: binding.libraryId,
        bound_task_visible: binding.visible,
        ...(binding.visible
          ? {
              bound_task_id: binding.taskId,
              bound_task_title: binding.taskTitle,
              bound_task_status: binding.taskStatus,
            }
          : {}),
      }, { status: 409 });
    }
    const hasObjects = (objectDbByLibraryId[String(params.id ?? '')] ?? []).some((row) => row.kind === 'object' && !row.key.endsWith('/'));
    if (hasObjects) {
      return HttpResponse.json({
        error_code: 'FILE_LIBRARY_NOT_EMPTY',
        message: 'file_library_not_empty',
        file_library_id: String(params.id ?? ''),
      }, { status: 409 });
    }
    sourceLibraries.splice(index, 1);
    delete objectDbByLibraryId[String(params.id ?? '')];
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/task-file-templates`, ({ params }) => {
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const items = Array.from(taskFileTemplatesById.values())
      .filter((template) => template.workspace_id === workspaceId && template.project_id === projectId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(toPublicTaskFileTemplate);
    return HttpResponse.json({ items });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/task-file-templates`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      source_library_id?: string;
      name?: string;
      description?: string;
    };
    const workspaceId = String(params.ws ?? '');
    const projectId = String(params.prj ?? '');
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
    if (!idempotencyKey) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'idempotency_key_required',
      }, { status: 422 });
    }
    const sourceLibrary = body.source_library_id
      ? getMockFileLibrary({
          workspaceId,
          projectId,
          libraryId: body.source_library_id,
        })
      : null;
    if (!sourceLibrary) {
      return fileLibraryNotFoundResponse(body.source_library_id ?? '');
    }
    if (sourceLibrary.status !== 'ready') {
      return fileLibraryStatusConflictResponse(sourceLibrary);
    }
    if (!body.name?.trim()) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'invalid_request',
      }, { status: 400 });
    }
    const idempotencyScope = `${workspaceId}:${projectId}:${sourceLibrary.id}:${idempotencyKey}`;
    const existingTemplateId = taskFileTemplateIdsByIdempotencyKey.get(idempotencyScope);
    const existingTemplate = existingTemplateId ? taskFileTemplatesById.get(existingTemplateId) : null;
    if (existingTemplate) {
      return HttpResponse.json(toPublicTaskFileTemplate(existingTemplate), { status: 200 });
    }
    const savePoint = createMockFileLibrarySavePoint({
      workspaceId,
      projectId,
      libraryId: sourceLibrary.id,
      message: `Template source: ${body.name.trim()}`,
      purpose: 'task_template_source',
    });
    const now = nowIso();
    const template: MockTaskFileTemplate = {
      id: `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspace_id: workspaceId,
      project_id: projectId,
      source_library_id: sourceLibrary.id,
      source_save_point_id: savePoint.id,
      name: body.name.trim(),
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      status: 'unpublished',
      created_by_user_id: 'user_001',
      created_at: now,
      updated_at: now,
      idempotency_key: idempotencyKey,
      snapshot: cloneObjectRows(savePoint.snapshot),
    };
    taskFileTemplatesById.set(template.id, template);
    taskFileTemplateIdsByIdempotencyKey.set(idempotencyScope, template.id);
    return HttpResponse.json(toPublicTaskFileTemplate(template), { status: 201 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/task-file-templates/:templateId/publish`, ({ params }) => {
    const template = getMockTaskFileTemplate({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      templateId: String(params.templateId ?? ''),
    });
    if (!template) {
      return HttpResponse.json({
        error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND',
        message: 'task_file_template_not_found',
      }, { status: 404 });
    }
    template.status = 'published';
    template.updated_at = nowIso();
    return HttpResponse.json(toPublicTaskFileTemplate(template));
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/task-file-templates/:templateId/unpublish`, ({ params }) => {
    const template = getMockTaskFileTemplate({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      templateId: String(params.templateId ?? ''),
    });
    if (!template) {
      return HttpResponse.json({
        error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND',
        message: 'task_file_template_not_found',
      }, { status: 404 });
    }
    template.status = 'unpublished';
    template.updated_at = nowIso();
    return HttpResponse.json(toPublicTaskFileTemplate(template));
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/task-file-templates/:templateId`, ({ params }) => {
    const template = getMockTaskFileTemplate({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      templateId: String(params.templateId ?? ''),
    });
    if (!template) {
      return HttpResponse.json({
        error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND',
        message: 'task_file_template_not_found',
      }, { status: 404 });
    }
    taskFileTemplatesById.delete(template.id);
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/entries`, ({ params, request }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = normalizePrefix(url.searchParams.get('path'));
    const pageSize = Number(url.searchParams.get('page_size') ?? '200');
    const safePageSize = Number.isFinite(pageSize) ? Math.min(Math.max(Math.floor(pageSize), 1), 1000) : 200;
    const continuationToken = url.searchParams.get('continuation_token');
    const offset = continuationToken ? Number(continuationToken) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
    const items = toFileLibraryEntries(listObjects(libraryId, path, {
      search: url.searchParams.get('search') ?? undefined,
      sortBy: (url.searchParams.get('sort_by') as 'name' | 'size_bytes' | 'last_modified' | 'modified_at' | null)?.replace('modified_at', 'last_modified') as 'name' | 'size_bytes' | 'last_modified' | undefined,
      sortOrder: (url.searchParams.get('sort_order') as 'asc' | 'desc' | null) ?? undefined,
    }));
    const pagedItems = items.slice(safeOffset, safeOffset + safePageSize);
    const nextToken = safeOffset + safePageSize < items.length ? String(safeOffset + safePageSize) : null;
    return HttpResponse.json({
      path,
      items: pagedItems,
      next_continuation_token: nextToken,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/folders`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { path?: string };
    const prefix = normalizePrefix(body.path ?? '');
    if (!prefix) return HttpResponse.json({ error_code: 'invalid_file_library_directory_path', message: 'invalid_file_library_directory_path' }, { status: 400 });
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const exists = db.some((r) => r.kind === 'object' && r.key === prefix);
    if (!exists) {
      db.push({
        kind: 'object',
        key: prefix,
        name: basename(prefix),
        size_bytes: 0,
        content_type: 'application/x-directory',
        last_modified: nowIso(),
      });
    }
    return HttpResponse.json(null, { status: 204 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/delete`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { paths?: string[] };
    const paths = (body.paths ?? []).filter(Boolean);
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const results = paths.map((path) => {
      if (shouldFailOnce('delete', path)) {
        return { path, status: 'error', error_code: 'simulated_failure', message: 'simulated_failure' };
      }
      if (path.endsWith('/')) {
        objectDbByLibraryId[libraryId] = db.filter((r) => r.kind !== 'object' || !r.key.startsWith(path));
        return { path, status: 'deleted' };
      }
      const idx = db.findIndex((r) => r.kind === 'object' && r.key === path);
      if (idx >= 0) db.splice(idx, 1);
      return { path, status: 'deleted' };
    });
    return HttpResponse.json({ results });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/move`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { from_path?: string; to_path?: string; overwrite?: boolean };
    const fromPath = String(body.from_path ?? '');
    const toPath = String(body.to_path ?? '');
    if (!fromPath || !toPath) {
      return HttpResponse.json({ error_code: 'invalid_file_library_move_request', message: 'invalid_file_library_move_request' }, { status: 400 });
    }
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const exists = db.some((r) => r.kind === 'object' && r.key === toPath);
    if (exists && !body.overwrite) {
      return HttpResponse.json({ error_code: 'destination_exists', message: 'destination_exists' }, { status: 409 });
    }
    const srcIdx = db.findIndex((r) => r.kind === 'object' && r.key === fromPath);
    if (srcIdx === -1) {
      return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    }
    const src = db[srcIdx] as Extract<ObjectRow, { kind: 'object' }>;
    db.splice(srcIdx, 1);
    db.push({ ...src, key: toPath, name: basename(toPath), last_modified: nowIso() });
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/meta`, ({ params, request }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? '';
    const db = objectDbByLibraryId[libraryId] ?? [];
    const obj = db.find((r) => r.kind === 'object' && r.key === path) as Extract<ObjectRow, { kind: 'object' }> | undefined;
    if (!obj) return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    return HttpResponse.json({
      key: obj.key,
      size_bytes: obj.size_bytes,
      content_type: obj.content_type,
      last_modified: obj.last_modified,
      user_metadata: {},
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/upload`, async ({ params, request }) => {
    const availability = rejectUnavailableFileLibraryWrite(params);
    if (availability.response) return availability.response;
    const libraryId = String(params.id ?? '');
    const { file, prefix, overwrite } = await readUploadForm(request);
    if (!file) {
      return HttpResponse.json({ error_code: 'invalid_request', message: 'file_is_required' }, { status: 400 });
    }
    if (file.name.includes('slow-upload')) {
      await sleep(1200);
    }
    const path = `${prefix}${file.name}`;
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const existingIndex = db.findIndex((r) => r.kind === 'object' && r.key === path);
    if (existingIndex >= 0 && !overwrite) {
      return HttpResponse.json({ error_code: 'destination_exists', message: 'destination_exists' }, { status: 409 });
    }
    const contentType = file.type || 'application/octet-stream';
    const content = typeof file.content === 'string'
      ? file.content
      : contentType.startsWith('text/') && typeof file.text === 'function'
        ? await file.text().catch(() => '')
        : undefined;
    const row: Extract<ObjectRow, { kind: 'object' }> = {
      kind: 'object',
      key: path,
      name: basename(path),
      size_bytes: file.size,
      content_type: contentType,
      last_modified: nowIso(),
      content,
    };
    if (existingIndex >= 0 && overwrite) db.splice(existingIndex, 1);
    db.push(row);
    return HttpResponse.json({
      kind: 'file',
      path: row.key,
      name: row.name,
      size_bytes: row.size_bytes,
      content_type: row.content_type,
      modified_at: row.last_modified,
    }, { status: 201 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/file-libraries/:id/download`, ({ params, request }) => {
    const library = getRouteFileLibrary(params);
    if (!library) {
      return fileLibraryNotFoundResponse(String(params.id ?? ''));
    }
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? '';
    const db = objectDbByLibraryId[libraryId] ?? [];
    const obj = db.find((r) => r.kind === 'object' && r.key === path) as Extract<ObjectRow, { kind: 'object' }> | undefined;
    if (!obj) return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    if (shouldFailOnce('download', path)) {
      return HttpResponse.json({ error_code: 'simulated_failure', message: 'simulated_failure' }, { status: 500 });
    }
    const bytes = obj.content ? new TextEncoder().encode(obj.content) : new Uint8Array([1, 2, 3, 4]);
    return new HttpResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': obj.content_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename=\"${basename(path) || 'download'}\"`,
      },
    });
  }),
];
