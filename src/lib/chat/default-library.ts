import type { FilesAPI } from '@/lib/api/endpoints/files';

export const DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME = 'My Uploads';

interface EnsureDefaultLibraryArgs {
  sourcesAPI: FilesAPI;
  workspaceId: string;
  projectId: string;
}

/**
 * Transitional helper toward a unified object-first input architecture.
 *
 * For now this creates/uses a deterministic project-level default library.
 * Backend-level "system-managed non-deletable personal library" enforcement
 * should replace this helper in a later phase.
 */
export async function ensureDefaultUploadLibrary({
  sourcesAPI,
  workspaceId,
  projectId,
}: EnsureDefaultLibraryArgs) {
  try {
    return await sourcesAPI.ensureDefaultPersonalLibrary(workspaceId, projectId);
  } catch {
    // Fallback keeps local/dev compatibility when backend route is unavailable.
    const listed = await sourcesAPI.listLibraries(workspaceId, projectId);
    const existing = listed.items.find((item) => item.name === DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME);
    if (existing) return existing;
    return sourcesAPI.createLibrary(workspaceId, projectId, {
      name: DEFAULT_PERSONAL_UPLOAD_LIBRARY_NAME,
    });
  }
}
