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
      try {
        const meta = await deps.getSourceObjectMetaUseCase.execute({
          workspaceId,
          projectId,
          libraryId: inputRef.library_id,
          key: inputRef.key,
        });
        return {
          kind: 'library_object',
          library_id: inputRef.library_id,
          key: inputRef.key,
          filename: inputRef.name || meta.key.split('/').pop() || inputRef.key,
          file_type: meta.content_type,
          file_size: meta.size_bytes,
        } satisfies NotebookRuntimeTaskInput;
      } catch (error) {
        debugLog?.('task_input_library_object_lookup_failed', {
          task_id: taskId,
          library_id: inputRef.library_id,
          key: inputRef.key,
          error: error instanceof Error ? error.message : 'object_lookup_failed',
        });
        return {
          kind: 'library_object',
          library_id: inputRef.library_id,
          key: inputRef.key,
          filename: inputRef.name || inputRef.key.split('/').pop() || inputRef.key,
          ...(inputRef.content_type ? { file_type: inputRef.content_type } : {}),
          ...(typeof inputRef.size_bytes === 'number' ? { file_size: inputRef.size_bytes } : {}),
        } satisfies NotebookRuntimeTaskInput;
      }
    }
    if (inputRef.kind === 'url') {
      return {
        kind: 'url',
        url: inputRef.url,
        filename: inputRef.name || inputRef.url,
        ...(inputRef.content_type ? { file_type: inputRef.content_type } : {}),
        ...(typeof inputRef.size_bytes === 'number' ? { file_size: inputRef.size_bytes } : {}),
        ...(inputRef.imported_library_id ? { imported_library_id: inputRef.imported_library_id } : {}),
        ...(inputRef.imported_key ? { imported_key: inputRef.imported_key } : {}),
      } satisfies NotebookRuntimeTaskInput;
    }
    if (inputRef.kind === 'artifact') {
      return {
        kind: 'artifact',
        task_id: inputRef.task_id,
        artifact_id: inputRef.artifact_id,
        filename: inputRef.name || inputRef.task_relative_path || inputRef.artifact_id,
        ...(inputRef.content_type ? { file_type: inputRef.content_type } : {}),
        ...(typeof inputRef.size_bytes === 'number' ? { file_size: inputRef.size_bytes } : {}),
        ...(inputRef.task_relative_path ? { task_relative_path: inputRef.task_relative_path } : {}),
      } satisfies NotebookRuntimeTaskInput;
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
      try {
        const meta = await deps.getSourceObjectMetaUseCase.execute({
          workspaceId,
          projectId,
          libraryId: inputRef.library_id,
          key: inputRef.key,
        });
        return {
          id: inputRef.id,
          kind: 'library_object',
          library_id: inputRef.library_id,
          key: inputRef.key,
          filename: inputRef.name || meta.key.split('/').pop() || inputRef.key,
          file_type: meta.content_type,
          file_size: meta.size_bytes,
        };
      } catch {
        return null;
      }
    }
    if (inputRef.kind === 'artifact') {
      const sourceArtifacts = await loadArtifactsForTask(inputRef.task_id);
      const artifact = sourceArtifacts.find((item) => item.id === inputRef.artifact_id);
      if (!artifact) {
        return {
          id: inputRef.id,
          kind: 'artifact',
          task_id: inputRef.task_id,
          artifact_id: inputRef.artifact_id,
          filename: inputRef.name || inputRef.task_relative_path || 'artifact',
          file_type: inputRef.content_type || 'application/octet-stream',
          file_size: typeof inputRef.size_bytes === 'number' ? inputRef.size_bytes : 0,
          ...(inputRef.task_relative_path ? { task_relative_path: inputRef.task_relative_path } : {}),
        };
      }
      return {
        id: inputRef.id,
        kind: 'artifact',
        task_id: inputRef.task_id,
        artifact_id: inputRef.artifact_id,
        filename: inputRef.name || artifact.title || inputRef.task_relative_path || 'artifact',
        file_type: inputRef.content_type || artifact.mime_type || 'application/octet-stream',
        file_size: typeof inputRef.size_bytes === 'number' ? inputRef.size_bytes : (artifact.file_size ?? 0),
        ...((inputRef.task_relative_path || artifact.task_relative_path)
          ? { task_relative_path: inputRef.task_relative_path || artifact.task_relative_path }
          : {}),
      };
    }
    if (inputRef.imported_library_id && inputRef.imported_key) {
      try {
        const meta = await deps.getSourceObjectMetaUseCase.execute({
          workspaceId,
          projectId,
          libraryId: inputRef.imported_library_id,
          key: inputRef.imported_key,
        });
        return {
          id: inputRef.id,
          kind: 'url',
          url: inputRef.url,
          filename: inputRef.name || meta.key.split('/').pop() || 'url_input.url.txt',
          file_type: inputRef.content_type || meta.content_type || 'text/plain',
          file_size: typeof inputRef.size_bytes === 'number' ? inputRef.size_bytes : (meta.size_bytes ?? 0),
          imported_library_id: inputRef.imported_library_id,
          imported_key: inputRef.imported_key,
        };
      } catch {
        // fall through
      }
    }
    return {
      id: inputRef.id,
      kind: 'url',
      url: inputRef.url,
      filename: inputRef.name || 'url_input.url.txt',
      file_type: inputRef.content_type || 'text/plain',
      file_size: typeof inputRef.size_bytes === 'number' ? inputRef.size_bytes : 0,
      ...(inputRef.imported_library_id ? { imported_library_id: inputRef.imported_library_id } : {}),
      ...(inputRef.imported_key ? { imported_key: inputRef.imported_key } : {}),
    };
  }));
  return items.filter((item): item is NotebookTaskInputDetail => item !== null);
}
