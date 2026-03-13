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
  resourceType: 'endpoint' | 'source_library' | 'agent';
  kind: 'rate_limits' | 'spending_limits';
  payload: unknown;
  allowedRateKeys: Record<'endpoint' | 'source_library' | 'agent', readonly string[]>;
  allowedLimitKeys: Record<'endpoint' | 'source_library' | 'agent', readonly string[]>;
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

type DefaultCandidateLibrary = {
  id: string;
  created_by_user_id: string;
  system_managed_kind?: string;
  name: string;
  created_at?: string;
};

export function isDefaultPersonalLibraryForUser(
  library: { name: string; created_by_user_id: string; system_managed_kind?: string },
  userId: string,
) {
  return (
    library.created_by_user_id === userId
    && (
      library.system_managed_kind === 'default_personal_uploads'
      || library.name === 'My Uploads'
    )
  );
}

export function defaultPersonalLibraryScopeKey(workspaceId: string, projectId: string, userId: string): string {
  return `${workspaceId}:${projectId}:${userId}`;
}

export function pickCanonicalDefaultPersonalLibrary<T extends DefaultCandidateLibrary>(items: T[], userId: string): T | null {
  const defaults = items.filter((item) => isDefaultPersonalLibraryForUser(item, userId));
  if (defaults.length === 0) return null;
  const sorted = [...defaults].sort((a, b) => {
    const aSystem = a.system_managed_kind === 'default_personal_uploads' ? 0 : 1;
    const bSystem = b.system_managed_kind === 'default_personal_uploads' ? 0 : 1;
    if (aSystem !== bSystem) return aSystem - bSystem;
    const aCreated = typeof a.created_at === 'string' ? Date.parse(a.created_at) : NaN;
    const bCreated = typeof b.created_at === 'string' ? Date.parse(b.created_at) : NaN;
    const aScore = Number.isFinite(aCreated) ? aCreated : Number.MAX_SAFE_INTEGER;
    const bScore = Number.isFinite(bCreated) ? bCreated : Number.MAX_SAFE_INTEGER;
    if (aScore !== bScore) return aScore - bScore;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

export function dedupeDefaultPersonalLibraries<T extends DefaultCandidateLibrary>(items: T[], userId: string): T[] {
  const canonical = pickCanonicalDefaultPersonalLibrary(items, userId);
  if (!canonical) return items;
  return items.filter((item) => !isDefaultPersonalLibraryForUser(item, userId) || item.id === canonical.id);
}
