import {
  buildResolvedArtifactInput,
  buildResolvedLibraryObjectInput,
  buildResolvedUrlInput,
  resolveInputRef,
} from './input-ref-input-resolver.js';

type SourceInputRefRecord = { id: string; kind: 'source'; source_id: string };
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
  | SourceInputRefRecord
  | LibraryObjectInputRefRecord
  | ArtifactInputRefRecord
  | UrlInputRefRecord;

export type NotebookRuntimeTaskInput =
  | {
      kind: 'source';
      source_id: string;
      filename: string;
      file_type?: string;
      file_size?: number;
      ai_ready_status?: string;
    }
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
      kind: 'source';
      source_id: string;
      filename: string;
      file_type: string;
      file_size: number;
      ai_ready?: { status: string };
    }
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

type SourceLookupDeps = {
  getSourceUseCase: {
    execute(args: { workspaceId: string; projectId: string; sourceId: string }): Promise<unknown>;
  };
  getSourceObjectMetaUseCase: {
    execute(args: { workspaceId: string; projectId: string; libraryId: string; key: string }): Promise<{
      key: string;
      content_type?: string;
      size_bytes?: number;
    }>;
  };
};

type ArtifactLookup = {
  id: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
  task_relative_path?: string;
};

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function readString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input.trim() : undefined;
}

function readNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

export async function buildNotebookRuntimeTaskInputs(args: {
  deps: SourceLookupDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachedInputs: NotebookTaskInputRefRecord[];
  debugLog?: (message: string, extra?: Record<string, unknown>) => void;
}): Promise<NotebookRuntimeTaskInput[]> {
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
        }) satisfies NotebookRuntimeTaskInput;
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
      }) satisfies NotebookRuntimeTaskInput;
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
      }) satisfies NotebookRuntimeTaskInput;
    }
    if (inputRef.kind === 'artifact') {
      const resolved = await resolveInputRef({
        kind: 'artifact',
        input: inputRef,
      });
      return buildResolvedArtifactInput({
        input: inputRef,
        meta: resolved.meta,
      }) satisfies NotebookRuntimeTaskInput;
    }
    try {
      const source = await deps.getSourceUseCase.execute({
        workspaceId,
        projectId,
        sourceId: inputRef.source_id,
      });
      const src = asObject(source);
      const aiReady = asObject(src.ai_ready);
      return {
        kind: 'source',
        source_id: inputRef.source_id,
        filename: readString(src.filename) ?? readString(src.name) ?? inputRef.source_id,
        ...(readString(src.file_type) ?? readString(src.content_type)
          ? { file_type: readString(src.file_type) ?? readString(src.content_type) }
          : {}),
        ...(readNumber(src.file_size) !== undefined ? { file_size: readNumber(src.file_size) } : {}),
        ...(readString(aiReady.status) ? { ai_ready_status: readString(aiReady.status) } : {}),
      } satisfies NotebookRuntimeTaskInput;
    } catch (error) {
      debugLog?.('task_input_source_lookup_failed', {
        task_id: taskId,
        source_id: inputRef.source_id,
        error: error instanceof Error ? error.message : 'source_lookup_failed',
      });
      return { kind: 'source', source_id: inputRef.source_id, filename: inputRef.source_id } satisfies NotebookRuntimeTaskInput;
    }
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
    if (inputRef.kind === 'source') {
      try {
        const source = asObject(await deps.getSourceUseCase.execute({
          workspaceId,
          projectId,
          sourceId: inputRef.source_id,
        }));
        const aiReady = asObject(source.ai_ready);
        return {
          id: inputRef.id,
          kind: 'source',
          source_id: inputRef.source_id,
          filename: typeof source.filename === 'string' ? source.filename : (typeof source.name === 'string' ? source.name : inputRef.source_id),
          file_type: typeof source.file_type === 'string' ? source.file_type : (typeof source.content_type === 'string' ? source.content_type : 'application/octet-stream'),
          file_size: typeof source.file_size === 'number' ? source.file_size : (typeof source.size_bytes === 'number' ? source.size_bytes : 0),
          ...(typeof aiReady.status === 'string' ? { ai_ready: { status: aiReady.status } } : {}),
        };
      } catch {
        return null;
      }
    }
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
