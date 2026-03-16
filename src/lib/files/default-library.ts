import type { FilesAPI } from '@/lib/api/endpoints/files';

export const DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME = 'Project Uploads';

type DefaultUploadLibraryClient = Pick<FilesAPI, 'listLibraries' | 'createLibrary'>;

interface EnsureDefaultLibraryArgs {
  sourcesAPI: DefaultUploadLibraryClient;
  workspaceId: string;
  projectId: string;
}

export async function ensureDefaultUploadLibrary({
  sourcesAPI,
  workspaceId,
  projectId,
}: EnsureDefaultLibraryArgs) {
  const listed = await sourcesAPI.listLibraries(workspaceId, projectId);
  const existing = listed.items.find((library) => library.name === DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME);
  if (existing) return existing;
  return sourcesAPI.createLibrary(workspaceId, projectId, {
    name: DEFAULT_PROJECT_UPLOAD_LIBRARY_NAME,
    description: 'System-managed default file library for project uploads.',
    visibility: 'shared',
  });
}
