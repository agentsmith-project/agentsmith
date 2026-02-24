import { getImportedLibraryObjectRef } from './input-ref-resolver.js';

export type SourceObjectMetaDeps = {
  getSourceObjectMetaUseCase: {
    execute(args: { workspaceId: string; projectId: string; libraryId: string; key: string }): Promise<{
      key: string;
      content_type?: string;
      size_bytes?: number;
    }>;
  };
};

export type ArtifactLookupRecord = {
  id: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
  task_relative_path?: string;
};

export async function resolveLibraryObjectInputMeta(args: {
  deps: SourceObjectMetaDeps;
  workspaceId: string;
  projectId: string;
  input: {
    library_id: string;
    key: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
}): Promise<{
  found_meta: boolean;
  filename: string;
  file_type?: string;
  file_size?: number;
}> {
  const { deps, workspaceId, projectId, input } = args;
  try {
    const meta = await deps.getSourceObjectMetaUseCase.execute({
      workspaceId,
      projectId,
      libraryId: input.library_id,
      key: input.key,
    });
    return {
      found_meta: true,
      filename: input.name || meta.key.split('/').pop() || input.key,
      file_type: meta.content_type,
      file_size: meta.size_bytes,
    };
  } catch {
    return {
      found_meta: false,
      filename: input.name || input.key.split('/').pop() || input.key,
      file_type: input.content_type,
      file_size: typeof input.size_bytes === 'number' ? input.size_bytes : undefined,
    };
  }
}

export async function resolveUrlInputMeta(args: {
  deps: SourceObjectMetaDeps;
  workspaceId: string;
  projectId: string;
  input: {
    url: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
    imported_library_id?: string;
    imported_key?: string;
  };
}): Promise<{
  filename: string;
  file_type: string;
  file_size: number;
  imported_library_id?: string;
  imported_key?: string;
}> {
  const { deps, workspaceId, projectId, input } = args;
  const importedObjectRef = getImportedLibraryObjectRef(input);
  if (importedObjectRef) {
    try {
      const meta = await deps.getSourceObjectMetaUseCase.execute({
        workspaceId,
        projectId,
        libraryId: importedObjectRef.library_id,
        key: importedObjectRef.key,
      });
      return {
        filename: input.name || meta.key.split('/').pop() || 'url_input.url.txt',
        file_type: input.content_type || meta.content_type || 'text/plain',
        file_size: typeof input.size_bytes === 'number' ? input.size_bytes : (meta.size_bytes ?? 0),
        imported_library_id: importedObjectRef.library_id,
        imported_key: importedObjectRef.key,
      };
    } catch {
      // fall through
    }
  }
  return {
    filename: input.name || 'url_input.url.txt',
    file_type: input.content_type || 'text/plain',
    file_size: typeof input.size_bytes === 'number' ? input.size_bytes : 0,
    ...(importedObjectRef ? { imported_library_id: importedObjectRef.library_id } : {}),
    ...(importedObjectRef ? { imported_key: importedObjectRef.key } : {}),
  };
}

export function resolveArtifactInputMeta(args: {
  input: {
    artifact_id: string;
    task_relative_path?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
  artifact?: ArtifactLookupRecord;
}): {
  filename: string;
  file_type: string;
  file_size: number;
  task_relative_path?: string;
} {
  const { input, artifact } = args;
  const filename = input.name || artifact?.title || input.task_relative_path || input.artifact_id || 'artifact';
  const file_type = input.content_type || artifact?.mime_type || 'application/octet-stream';
  const file_size = typeof input.size_bytes === 'number' ? input.size_bytes : (artifact?.file_size ?? 0);
  const taskRelativePath = input.task_relative_path || artifact?.task_relative_path;
  return {
    filename,
    file_type,
    file_size,
    ...(taskRelativePath ? { task_relative_path: taskRelativePath } : {}),
  };
}
