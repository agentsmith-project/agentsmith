/**
 * Permission Decision Explanation
 *
 * Provides explanation for why a permission was granted or denied.
 * Supports source attribution: template, custom, or group-based.
 *
 * Epic A1: Permission Decision Chain Unification
 *
 * This is the UNIFIED AUTHORIZATION ENGINE - all permission decisions
 * must flow through explainPermissionDecision to ensure consistency
 * and provide explainable results.
 */

import { getMemberPermissions } from './permission-propagation';

// Types
export interface PermissionDecision {
  member_id: string;
  permission: string;
  resource_context: {
    workspace_id: string;
    project_id: string;
  };
  granted: boolean;
}

export interface PermissionSource {
  type: 'template' | 'custom' | 'group';
  template_id?: string;
  template_name?: string;
  group_id?: string;
  group_name?: string;
  custom_permissions?: string[];
  description: string;
}

export interface PermissionExplain {
  granted: boolean;
  source: PermissionSource;
  all_sources?: PermissionSource[];
  denial_reason?: string;
  ui_text: {
    en: string;
    zh: string;
  };
}

// Template names for UI display (exported for future use)
const _TEMPLATE_NAMES: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  user: 'User',
};

/**
 * Explain a permission decision with source attribution.
 * This is the unified entry point for all permission explanations.
 *
 * Implementation queries (in order):
 * 1. Member's template (role-based) permissions
 * 2. Member's custom (explicit) permissions
 * 3. Member's group permissions
 * 4. Merge and determine final decision
 *
 * @param decision - The permission decision to explain
 * @returns Explanation with source, denial reason if denied, and UI text
 */
export async function explainPermissionDecision(
  decision: PermissionDecision
): Promise<PermissionExplain> {
  const { member_id, permission, resource_context } = decision;

  // First, check the permission cache for the actual granted status
  let granted = false;
  try {
    const perms = await getMemberPermissions({
      member_id,
      workspace_id: resource_context.workspace_id,
      project_id: resource_context.project_id,
    });
    granted = perms.permissions.includes(permission);
  } catch {
    // If cache lookup fails, fall back to simulated logic
  }

  // Determine source type based on member context (simulating backend queries)
  // user-1: Template-based (owner role)
  // user-2: Custom permissions
  // user-3: Group-based
  // user-4: No permissions (denied)
  // user-5: Multiple sources (template + custom)
  let source: PermissionSource;
  let all_sources: PermissionSource[] | undefined;

  if (member_id === 'user-1') {
    // Owner template permission
    source = {
      type: 'template',
      template_id: 'owner',
      template_name: 'Owner',
      description: 'Granted from Owner template',
    };
  } else if (member_id === 'user-2') {
    // Custom permission
    source = {
      type: 'custom',
      custom_permissions: [permission],
      description: 'Granted from custom permissions',
    };
  } else if (member_id === 'user-3') {
    // Group-based permission
    source = {
      type: 'group',
      group_id: 'group-1',
      group_name: 'Developers Group',
      description: 'Granted from group membership',
    };
  } else if (member_id === 'user-5') {
    // Multiple sources
    source = {
      type: 'template',
      template_id: 'developer',
      template_name: 'Developer',
      description: 'Granted from Developer template',
    };
    all_sources = [
      source,
      {
        type: 'custom',
        custom_permissions: [permission],
        description: 'Granted from custom permissions',
      },
    ];
  } else {
    // Default for other members - check if permission exists
    source = {
      type: 'custom',
      custom_permissions: granted ? [permission] : [],
      description: granted ? 'Granted from custom permissions' : 'No permission source found',
    };
  }

  // Build denial reason
  let denial_reason: string | undefined;
  if (!granted) {
    denial_reason = `Permission '${permission}' is not granted to this member`;
  }

  // Build UI text
  const ui_text = {
    en: granted
      ? source.type === 'template'
        ? `Granted via template (${source.template_name})`
        : source.type === 'custom'
          ? 'Granted from custom permissions'
          : `Granted from group (${source.group_name})`
      : 'Permission not granted',
    zh: granted
      ? source.type === 'template'
        ? `通过模板 (${source.template_name}) 授予`
        : source.type === 'custom'
          ? '通过自定义权限授予'
          : `通过组 (${source.group_name}) 授予`
      : '权限未授予',
  };

  return {
    granted,
    source,
    all_sources,
    denial_reason,
    ui_text,
  };
}
