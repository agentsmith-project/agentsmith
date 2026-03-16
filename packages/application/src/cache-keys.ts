function buildWorkspaceProjectScope(workspaceId: string, projectId: string): string {
  return `workspace:${workspaceId}:project:${projectId}`;
}

export function buildWorkspaceProjectCacheKey(
  kind: string,
  workspaceId: string,
  projectId: string,
  ...parts: Array<string>
): string {
  const suffix = parts.filter((part) => part.length > 0).join(':');
  return suffix
    ? `${buildWorkspaceProjectScope(workspaceId, projectId)}:${kind}:${suffix}`
    : `${buildWorkspaceProjectScope(workspaceId, projectId)}:${kind}`;
}

export function buildSourcesCacheKey(workspaceId: string, projectId: string, libraryId?: string): string {
  return buildWorkspaceProjectCacheKey('sources', workspaceId, projectId, libraryId ?? 'all');
}

export function buildFileLibrariesCacheKey(workspaceId: string, projectId: string): string {
  return buildWorkspaceProjectCacheKey('file-libraries', workspaceId, projectId);
}
