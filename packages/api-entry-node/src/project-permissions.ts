import type { NodeApiDeps } from './node-api-deps.js';
import { evaluateProjectPermissions } from './project-authz-engine.js';

export async function actorHasProjectPermissions(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requiredPermissions: string[];
}): Promise<boolean> {
  if (args.requiredPermissions.length === 0) return true;
  try {
    const project = await args.deps.getProjectUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    const evaluation = await evaluateProjectPermissions({
      docStore: args.deps.docStore,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId: args.actorUserId,
      requiredPermissions: args.requiredPermissions,
    });
    return evaluation.decisions.every((decision) => decision.granted);
  } catch {
    return false;
  }
}
