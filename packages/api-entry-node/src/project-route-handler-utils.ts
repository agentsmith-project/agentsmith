import type http from 'node:http';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import type { NodeApiDeps } from './node-api-deps.js';

export function readRequestId(req: http.IncomingMessage): string | undefined {
  const value = req.headers['x-request-id'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim());
    if (first) return first.trim();
  }
  return undefined;
}

export function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

export async function readProjectPermissionContext(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}): Promise<{
  ownerId: string;
  governance: unknown;
  permissions: readonly string[];
} | null> {
  try {
    const project = await args.deps.getProjectUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    return {
      ownerId: project.owner_id,
      governance: project.governance_json,
      permissions: resolveVisibleProjectPermissionsForActor({
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        projectOwnerId: project.owner_id,
        projectGovernance: project.governance_json,
        actorUserId: args.actorUserId,
      }),
    };
  } catch {
    return null;
  }
}

export function validatePolicyRuleKeys(args: {
  resourceType: 'endpoint' | 'file_library' | 'agent';
  kind: 'rate_limits' | 'spending_limits';
  payload: unknown;
  allowedRateKeys: Record<'endpoint' | 'file_library' | 'agent', readonly string[]>;
  allowedLimitKeys: Record<'endpoint' | 'file_library' | 'agent', readonly string[]>;
}): { ok: true } | { ok: false; message: string } {
  if (args.payload === undefined) return { ok: true };
  if (!args.payload || typeof args.payload !== 'object' || Array.isArray(args.payload)) {
    return { ok: false, message: `${args.kind}_invalid` };
  }
  const rules = (args.payload as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) {
    return { ok: false, message: `${args.kind}_rules_invalid` };
  }
  const allowed = args.kind === 'rate_limits'
    ? args.allowedRateKeys[args.resourceType]
    : args.allowedLimitKeys[args.resourceType];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      return { ok: false, message: `${args.kind}_rule_invalid` };
    }
    const key = (rule as { key?: unknown }).key;
    const value = (rule as { value?: unknown }).value;
    if (typeof key !== 'string' || !allowed.includes(key)) {
      return { ok: false, message: `${args.kind}_rule_key_invalid` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, message: `${args.kind}_rule_value_invalid` };
    }
  }
  return { ok: true };
}
