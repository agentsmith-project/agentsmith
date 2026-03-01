import { resolveProjectPermissionsForActor } from './project-authz-engine.js';

export function resolveProjectPermissionsForRequest(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): readonly string[] {
  return resolveProjectPermissionsForActor(args);
}
