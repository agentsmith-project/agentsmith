import { resolveProjectPermissionsForActor } from './project-authz-engine.js';
import type { JsonDocStorePort } from '@mbos/ports';

export async function resolveProjectPermissionsForRequest(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): Promise<readonly string[]> {
  return resolveProjectPermissionsForActor(args);
}
