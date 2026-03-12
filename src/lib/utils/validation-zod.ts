/**
 * Zod-based Validation Utilities
 *
 * Runtime validation using Zod schemas.
 * This file is separate from validation.ts because zod is not compatible
 * with Next.js Edge Runtime (used by middleware).
 */

import { z } from 'zod';

// ============================================================
// Zod Runtime Validation for ProjectWithMembership
// ============================================================

/**
 * Zod schema for ProjectWithMembership validation
 *
 * Validates that:
 * - All Project fields are present and valid
 * - role is one of: owner, admin, developer, user (optional)
 * - permissions is an array of strings (optional)
 */
export const ProjectWithMembershipSchema = z.object({
  // Base Project fields
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  visibility: z.enum(['public', 'private']),
  join_policy: z.enum(['approval_required', 'open']).optional(),
  owner_id: z.string(),
  status: z.enum(['active', 'archived', 'deleted']),
  governance_json: z.record(z.string(), z.unknown()).optional(),
  execution_preferences_json: z.record(z.string(), z.unknown()).optional(),
  limits_json: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
  updated_at: z.string(),

  // Optional membership fields
  role: z.enum(['owner', 'admin', 'developer', 'user']).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * Type for validated ProjectWithMembership
 */
export type ProjectWithMembership = z.infer<typeof ProjectWithMembershipSchema>;

/**
 * Validate and cast unknown data to ProjectWithMembership
 *
 * This function performs runtime validation using Zod schema.
 * Returns null if validation fails, preventing type assertions.
 *
 * @param data - Unknown data to validate
 * @returns Validated ProjectWithMembership or null if invalid
 */
export function validateProjectWithMembership(data: unknown): ProjectWithMembership | null {
  const result = ProjectWithMembershipSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Check if data is a valid ProjectWithMembership
 *
 * @param data - Data to check
 * @returns true if valid, false otherwise
 */
export function isValidProjectWithMembership(data: unknown): data is ProjectWithMembership {
  return ProjectWithMembershipSchema.safeParse(data).success;
}
