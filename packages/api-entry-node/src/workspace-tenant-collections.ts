import { getRegisteredWorkspaceConfig } from './workspace-registry.js';

export function resolveWorkspaceScopedCollection(baseCollection: string, workspaceId: string): string {
  const workspace = getRegisteredWorkspaceConfig(workspaceId);
  const prefix = workspace?.tenant?.collection_prefix?.trim();
  if (!prefix) {
    return baseCollection;
  }
  return `${prefix}${baseCollection}`;
}
