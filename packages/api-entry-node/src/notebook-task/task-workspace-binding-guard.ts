import type { NodeApiDeps } from '../node-api-deps.js';
import type { FileLibraryMountAccess, FileLibraryRecord } from '../file-library-model.js';
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from '../file-library-persistence.js';
import type { TaskRecord } from './task-models.js';
import {
  findTaskFileLibraryBinding,
  hydrateTaskFileLibraryBindingsForProject,
  type TaskFileLibraryBinding,
} from './task-file-library-bindings.js';

export type TaskWorkspaceBindingGuardErrorCode =
  | 'TASK_WORKSPACE_NOT_BOUND'
  | 'FILE_LIBRARY_NOT_FOUND'
  | 'FILE_LIBRARY_DELETING'
  | 'FILE_LIBRARY_NOT_READY'
  | 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT'
  | 'FILE_LIBRARY_FORBIDDEN'
  | 'FILE_LIBRARY_WORKSPACE_ACCESS_UNAVAILABLE';

export class TaskWorkspaceBindingGuardError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: TaskWorkspaceBindingGuardErrorCode,
    message: string,
    readonly metadata: {
      taskId?: string;
      fileLibraryId?: string;
      fileLibraryStatus?: string;
      bindingGeneration?: number;
    } = {},
  ) {
    super(message);
    this.name = 'TaskWorkspaceBindingGuardError';
  }
}

export type TaskWorkspaceBindingGuardResult = {
  task: TaskRecord;
  library: FileLibraryRecord;
  binding: TaskFileLibraryBinding;
  mountAccess?: FileLibraryMountAccess;
};

export function isTaskWorkspaceBindingGuardError(error: unknown): error is TaskWorkspaceBindingGuardError {
  return error instanceof TaskWorkspaceBindingGuardError;
}

export function serializeTaskWorkspaceBindingGuardError(
  error: TaskWorkspaceBindingGuardError,
): Record<string, unknown> {
  return {
    error_code: error.errorCode,
    message: error.message,
    ...(error.metadata.taskId ? { task_id: error.metadata.taskId } : {}),
    ...(error.metadata.fileLibraryId ? { file_library_id: error.metadata.fileLibraryId } : {}),
    ...(error.metadata.fileLibraryStatus ? { file_library_status: error.metadata.fileLibraryStatus } : {}),
    ...(typeof error.metadata.bindingGeneration === 'number'
      ? { binding_generation: String(error.metadata.bindingGeneration) }
      : {}),
  };
}

export function toTaskWorkspaceBindingGuardException(error: TaskWorkspaceBindingGuardError): Error & {
  code: TaskWorkspaceBindingGuardErrorCode;
  statusCode: number;
} {
  return Object.assign(new Error(error.message), {
    code: error.errorCode,
    statusCode: error.statusCode,
  });
}

export async function resolveTaskWorkspaceBindingGuard(args: {
  deps: NodeApiDeps;
  task: TaskRecord;
  actorUserId: string;
  requireMountAccess?: boolean;
  canUpdateProjectFiles?: () => Promise<boolean>;
}): Promise<TaskWorkspaceBindingGuardResult> {
  const fileLibraryId = args.task.workspace_file_library_id?.trim();
  if (!fileLibraryId) {
    throw new TaskWorkspaceBindingGuardError(
      409,
      'TASK_WORKSPACE_NOT_BOUND',
      'task_workspace_file_library_not_configured',
      { taskId: args.task.id },
    );
  }
  if (args.task.deletion_state === 'deleting' || args.task.deletion_state === 'deleted') {
    throw new TaskWorkspaceBindingGuardError(
      409,
      'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      'agent_task_workspace_binding_conflict',
      { taskId: args.task.id, fileLibraryId },
    );
  }

  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore);
  const library = await catalogRepo.getById(
    args.task.workspace_id,
    args.task.project_id,
    fileLibraryId,
  );
  if (!library || library.created_by_user_id !== args.actorUserId) {
    throw new TaskWorkspaceBindingGuardError(
      404,
      'FILE_LIBRARY_NOT_FOUND',
      'file_library_not_found',
      { taskId: args.task.id, fileLibraryId },
    );
  }
  if (library.status !== 'ready') {
    const deleting = library.status === 'deleting' || library.status === 'deleted';
    throw new TaskWorkspaceBindingGuardError(
      409,
      deleting ? 'FILE_LIBRARY_DELETING' : 'FILE_LIBRARY_NOT_READY',
      deleting ? 'file_library_deleting' : 'file_library_not_ready',
      {
        taskId: args.task.id,
        fileLibraryId,
        fileLibraryStatus: library.status,
      },
    );
  }

  await hydrateTaskFileLibraryBindingsForProject({
    docStore: args.deps.docStore,
    workspaceId: args.task.workspace_id,
    projectId: args.task.project_id,
    tasks: [args.task],
  });

  const currentBinding = await findTaskFileLibraryBinding({
    docStore: args.deps.docStore,
    workspaceId: args.task.workspace_id,
    projectId: args.task.project_id,
    fileLibraryId,
  });
  if (
    !currentBinding
    || currentBinding.bindingState !== 'bound'
    || currentBinding.taskId !== args.task.id
    || (
      typeof args.task.file_library_binding_generation === 'number'
      && currentBinding.bindingGeneration !== args.task.file_library_binding_generation
    )
    || (
      args.task.runtime_writable_affordance
      && currentBinding.runtimeWritableAffordance !== args.task.runtime_writable_affordance
    )
  ) {
    throw new TaskWorkspaceBindingGuardError(
      409,
      'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      'agent_task_workspace_binding_conflict',
      {
        taskId: args.task.id,
        fileLibraryId,
        bindingGeneration: currentBinding?.bindingGeneration,
      },
    );
  }

  if (
    currentBinding.runtimeWritableAffordance === 'files_update'
    && !(args.canUpdateProjectFiles ? await args.canUpdateProjectFiles() : false)
  ) {
    throw new TaskWorkspaceBindingGuardError(
      403,
      'FILE_LIBRARY_FORBIDDEN',
      'file_library_forbidden',
      { taskId: args.task.id, fileLibraryId },
    );
  }

  if (!args.requireMountAccess) {
    return {
      task: args.task,
      library,
      binding: currentBinding,
    };
  }
  const mountAccess = await new JsonDocProjectFileLibraryMountAccessRepo(args.deps.docStore).getById(
    args.task.workspace_id,
    args.task.project_id,
    fileLibraryId,
  );
  if (!mountAccess) {
    throw new TaskWorkspaceBindingGuardError(
      404,
      'FILE_LIBRARY_WORKSPACE_ACCESS_UNAVAILABLE',
      'file_library_mount_access_not_found',
      { taskId: args.task.id, fileLibraryId },
    );
  }
  return {
    task: args.task,
    library,
    binding: currentBinding,
    mountAccess,
  };
}
