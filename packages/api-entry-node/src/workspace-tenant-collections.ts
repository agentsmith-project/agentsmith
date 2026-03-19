export function resolveWorkspaceScopedCollection(baseCollection: string, workspaceId: string): string {
  const trimmedWorkspaceId = workspaceId.trim();
  if (!trimmedWorkspaceId) {
    return baseCollection;
  }
  const configuredPrefix = (process.env.SYSTEM_TENANT_COLLECTION_PREFIX || 'ws_').trim();
  const prefix = trimmedWorkspaceId.startsWith(configuredPrefix)
    ? `${trimmedWorkspaceId}_`
    : `${configuredPrefix}${trimmedWorkspaceId}_`;
  if (!prefix) {
    return baseCollection;
  }
  return `${prefix}${baseCollection}`;
}
