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

export type ResolvedSourceInputRef = {
  kind: 'source';
  source_id: string;
  filename: string;
  file_type?: string;
  file_size?: number;
};

export type ResolvedLibraryObjectInputRef = {
  kind: 'library_object';
  library_id: string;
  key: string;
  filename: string;
  file_type?: string;
  file_size?: number;
};

export type ResolvedUrlInputRef = {
  kind: 'url';
  url: string;
  filename: string;
  file_type: string;
  file_size: number;
  imported_library_id?: string;
  imported_key?: string;
};

export type ResolvedArtifactInputRef = {
  kind: 'artifact';
  task_id: string;
  artifact_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  task_relative_path?: string;
};

export type ResolvedInputRef =
  | ResolvedSourceInputRef
  | ResolvedLibraryObjectInputRef
  | ResolvedUrlInputRef
  | ResolvedArtifactInputRef;

type ResolveInputLibraryObjectArgs = {
  kind: 'library_object';
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
};
type ResolveInputUrlArgs = {
  kind: 'url';
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
};
type ResolveInputArtifactArgs = {
  kind: 'artifact';
  input: {
    artifact_id: string;
    task_relative_path?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
  artifact?: ArtifactLookupRecord;
};
type ResolveInputArgs =
  | ResolveInputLibraryObjectArgs
  | ResolveInputUrlArgs
  | ResolveInputArtifactArgs;
type ResolveInputResult =
  | { kind: 'library_object'; meta: Awaited<ReturnType<typeof resolveLibraryObjectInputMeta>> }
  | { kind: 'url'; meta: Awaited<ReturnType<typeof resolveUrlInputMeta>> }
  | { kind: 'artifact'; meta: ReturnType<typeof resolveArtifactInputMeta> };

export async function resolveInputRef(args: ResolveInputLibraryObjectArgs): Promise<{ kind: 'library_object'; meta: Awaited<ReturnType<typeof resolveLibraryObjectInputMeta>> }>;
export async function resolveInputRef(args: ResolveInputUrlArgs): Promise<{ kind: 'url'; meta: Awaited<ReturnType<typeof resolveUrlInputMeta>> }>;
export async function resolveInputRef(args: ResolveInputArtifactArgs): Promise<{ kind: 'artifact'; meta: ReturnType<typeof resolveArtifactInputMeta> }>;
export async function resolveInputRef(args: ResolveInputArgs): Promise<ResolveInputResult> {
  if (args.kind === 'library_object') {
    return {
      kind: 'library_object',
      meta: await resolveLibraryObjectInputMeta(args),
    };
  }
  if (args.kind === 'url') {
    return {
      kind: 'url',
      meta: await resolveUrlInputMeta(args),
    };
  }
  return {
    kind: 'artifact',
    meta: resolveArtifactInputMeta(args),
  };
}

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

export function buildResolvedLibraryObjectInput(args: {
  input: { library_id: string; key: string };
  meta: { filename: string; file_type?: string; file_size?: number };
}): ResolvedLibraryObjectInputRef {
  return {
    kind: 'library_object',
    library_id: args.input.library_id,
    key: args.input.key,
    filename: args.meta.filename,
    ...(args.meta.file_type ? { file_type: args.meta.file_type } : {}),
    ...(typeof args.meta.file_size === 'number' ? { file_size: args.meta.file_size } : {}),
  };
}

export function buildResolvedUrlInput(args: {
  input: { url: string };
  meta: {
    filename: string;
    file_type: string;
    file_size: number;
    imported_library_id?: string;
    imported_key?: string;
  };
}): ResolvedUrlInputRef {
  return {
    kind: 'url',
    url: args.input.url,
    filename: args.meta.filename,
    file_type: args.meta.file_type,
    file_size: args.meta.file_size,
    ...(args.meta.imported_library_id ? { imported_library_id: args.meta.imported_library_id } : {}),
    ...(args.meta.imported_key ? { imported_key: args.meta.imported_key } : {}),
  };
}

export function buildResolvedArtifactInput(args: {
  input: { task_id: string; artifact_id: string };
  meta: { filename: string; file_type: string; file_size: number; task_relative_path?: string };
}): ResolvedArtifactInputRef {
  return {
    kind: 'artifact',
    task_id: args.input.task_id,
    artifact_id: args.input.artifact_id,
    filename: args.meta.filename,
    file_type: args.meta.file_type,
    file_size: args.meta.file_size,
    ...(args.meta.task_relative_path ? { task_relative_path: args.meta.task_relative_path } : {}),
  };
}
