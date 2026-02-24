import type { FilesAPI } from '@/lib/api/endpoints/files';

export const DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME = 'My Uploads';

interface EnsureDefaultLibraryArgs {
  sourcesAPI: FilesAPI;
  workspaceId: string;
  projectId: string;
}

export async function ensureDefaultUploadLibrary({
  sourcesAPI,
  workspaceId,
  projectId,
}: EnsureDefaultLibraryArgs) {
  return sourcesAPI.ensureDefaultPersonalLibrary(workspaceId, projectId);
}

