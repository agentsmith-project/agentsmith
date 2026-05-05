/**
 * Zod-based Validation Utilities
 *
 * Schema validation using Zod schemas.
 * This file is separate from validation.ts because zod is not compatible
 * with Next.js Edge Runtime (used by middleware).
 */

import { z } from 'zod';

// ============================================================
// Zod Schema Validation for ProjectWithMembership
// ============================================================

const MemberGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  permission_template_id: z.string(),
  built_in: z.boolean().optional(),
  system_key: z.string().optional(),
});

/**
 * Zod schema for ProjectWithMembership validation
 *
 * Validates that:
 * - All Project fields are present and valid
 * - membership_status is explicit
 * - permissions and groups are shaped for project access rendering
 */
export const ProjectWithMembershipSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  visibility: z.enum(['public', 'private']),
  join_policy: z.enum(['approval_required', 'open']).optional(),
  owner_id: z.string(),
  status: z.enum(['active', 'archived', 'deleted']),
  governance_json: z.record(z.string(), z.unknown()).optional(),
  limits_json: z.record(z.string(), z.unknown()).optional(),
  admin_member_ids: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  permissions: z.array(z.string()),
  groups: z.array(MemberGroupSummarySchema).optional(),
  membership_status: z.enum(['active', 'pending', 'suspended', 'none']),
});

export type ProjectWithMembership = z.infer<typeof ProjectWithMembershipSchema>;

export function validateProjectWithMembership(data: unknown): ProjectWithMembership | null {
  const result = ProjectWithMembershipSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function isValidProjectWithMembership(data: unknown): data is ProjectWithMembership {
  return ProjectWithMembershipSchema.safeParse(data).success;
}
