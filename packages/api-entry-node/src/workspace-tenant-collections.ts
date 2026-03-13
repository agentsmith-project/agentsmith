import { getRegisteredWorkspaceTenantConfig } from './workspace-registry.js';

export function resolveWorkspaceScopedCollection(baseCollection: string, workspaceId: string): string {
  const tenant = getRegisteredWorkspaceTenantConfig(workspaceId);
  const prefix = tenant?.collection_prefix?.trim();
  if (!prefix) {
    return baseCollection;
  }
  return `${prefix}${baseCollection}`;
}
