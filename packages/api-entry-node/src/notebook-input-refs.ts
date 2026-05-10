import {
  buildResolvedArtifactInput,
  buildResolvedLibraryObjectInput,
  buildResolvedUrlInput,
  type FileLibraryObjectMetaDeps,
  resolveInputRef,
} from './input-ref-input-resolver.js';

type LibraryObjectInputRefRecord = {
  id: string;
  kind: 'library_object';
  library_id: string;
  key: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};
type ArtifactInputRefRecord = {
  id: string;
  kind: 'artifact';
  task_id: string;
  artifact_id: string;
  task_relative_path?: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};
type UrlInputRefRecord = {
  id: string;
  kind: 'url';
  url: string;
  name?: string;
  imported_library_id?: string;
  imported_key?: string;
  content_type?: string;
  size_bytes?: number;
};

export type NotebookTaskInputRefRecord =
  | LibraryObjectInputRefRecord
  | ArtifactInputRefRecord
  | UrlInputRefRecord;

export type NotebookTaskInput =
  | {
      kind: 'library_object';
      library_id: string;
      key: string;
      filename: string;
      file_type?: string;
      file_size?: number;
    }
  | {
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      filename: string;
      file_type?: string;
      file_size?: number;
      task_relative_path?: string;
    }
  | {
      kind: 'url';
      url: string;
      filename: string;
      file_type?: string;
      file_size?: number;
      imported_library_id?: string;
      imported_key?: string;
    };

export type NotebookTaskInputDetail =
  | {
      id: string;
      kind: 'library_object';
      library_id: string;
      key: string;
      filename: string;
      file_type?: string;
      file_size?: number;
    }
  | {
      id: string;
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      filename: string;
      file_type: string;
      file_size: number;
      task_relative_path?: string;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      filename: string;
      file_type: string;
      file_size: number;
      imported_library_id?: string;
      imported_key?: string;
    };

type SourceLookupDeps = FileLibraryObjectMetaDeps;

type ArtifactLookup = {
  id: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
  task_relative_path?: string;
};

export async function buildNotebookTaskInputs(args: {
  deps: SourceLookupDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachedInputs: NotebookTaskInputRefRecord[];
  debugLog?: (message: string, extra?: Record<string, unknown>) => void;
}): Promise<NotebookTaskInput[]> {
  const { deps, workspaceId, projectId, taskId, attachedInputs, debugLog } = args;
  if (attachedInputs.length === 0) return [];
  return Promise.all(attachedInputs.map(async (inputRef) => {
    if (inputRef.kind === 'library_object') {
      const resolved = await resolveInputRef({
        kind: 'library_object',
        deps,
        workspaceId,
        projectId,
        input: inputRef,
      });
      if (resolved.meta.found_meta) {
        return buildResolvedLibraryObjectInput({
          input: inputRef,
          meta: resolved.meta,
        }) satisfies NotebookTaskInput;
      }
      debugLog?.('task_input_library_object_lookup_failed', {
        task_id: taskId,
        library_id: inputRef.library_id,
        key: inputRef.key,
        error: 'object_lookup_failed',
      });
      return buildResolvedLibraryObjectInput({
        input: inputRef,
        meta: resolved.meta,
      }) satisfies NotebookTaskInput;
    }
    if (inputRef.kind === 'url') {
      const resolved = await resolveInputRef({
        kind: 'url',
        deps,
        workspaceId,
        projectId,
        input: inputRef,
      });
      return buildResolvedUrlInput({
        input: inputRef,
        meta: resolved.meta,
      }) satisfies NotebookTaskInput;
    }
    if (inputRef.kind === 'artifact') {
      const resolved = await resolveInputRef({
        kind: 'artifact',
        input: inputRef,
      });
      return buildResolvedArtifactInput({
        input: inputRef,
        meta: resolved.meta,
      }) satisfies NotebookTaskInput;
    }
    debugLog?.('task_input_unreachable_kind', {
      task_id: taskId,
      kind: 'unknown',
    });
    throw new Error('task_input_unreachable_kind');
  }));
}

export async function resolveNotebookTaskInputDetails(args: {
  deps: SourceLookupDeps;
  workspaceId: string;
  projectId: string;
  inputs: NotebookTaskInputRefRecord[];
  loadArtifactsForTask: (taskId: string) => Promise<ArtifactLookup[]>;
}): Promise<NotebookTaskInputDetail[]> {
  const { deps, workspaceId, projectId, inputs, loadArtifactsForTask } = args;
  const items = await Promise.all(inputs.map(async (inputRef): Promise<NotebookTaskInputDetail | null> => {
    if (inputRef.kind === 'library_object') {
      const resolved = await resolveInputRef({
        kind: 'library_object',
        deps,
        workspaceId,
        projectId,
        input: inputRef,
      });
      if (resolved.meta.found_meta) {
        const detail = buildResolvedLibraryObjectInput({
          input: inputRef,
          meta: resolved.meta,
        });
        return {
          id: inputRef.id,
          ...detail,
        };
      }
      return null;
    }
    if (inputRef.kind === 'artifact') {
      const sourceArtifacts = await loadArtifactsForTask(inputRef.task_id);
      const artifact = sourceArtifacts.find((item) => item.id === inputRef.artifact_id);
      const resolved = await resolveInputRef({
        kind: 'artifact',
        input: inputRef,
        artifact,
      });
      const detail = buildResolvedArtifactInput({
        input: inputRef,
        meta: resolved.meta,
      });
      return {
        id: inputRef.id,
        ...detail,
      };
    }
    const resolved = await resolveInputRef({
      kind: 'url',
      deps,
      workspaceId,
      projectId,
      input: inputRef,
    });
    const detail = buildResolvedUrlInput({
      input: inputRef,
      meta: resolved.meta,
    });
    return {
      id: inputRef.id,
      ...detail,
    };
  }));
  return items.filter((item): item is NotebookTaskInputDetail => item !== null);
}
