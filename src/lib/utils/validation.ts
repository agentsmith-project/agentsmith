/**
 * Validation Utilities
 *
 * Type-safe validation functions for IDs, formats, and data structures.
 */

import { z } from 'zod';
import type { Project } from '@/lib/api/types';

/**
 * UUIDv7 validation pattern
 * Format: 8-4-4-4-12 hex digits, version 7, variant 8/9/a/b
 */
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUIDv7 format
 *
 * @param id - String to validate
 * @returns True if valid UUIDv7 format
 */
export function isValidUUIDv7(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return UUIDV7_PATTERN.test(id);
}

/**
 * Check if a string looks like a reserved route name
 * (e.g., 'chat', 'overview', 'sources', etc.)
 *
 * @param id - String to check
 * @returns True if it looks like a reserved route
 */
export function isReservedRouteName(id: string): boolean {
  const reservedRoutes = [
    'chat',
    'overview',
    'sources',
    'agents',
    'endpoints',
    'members',
    'settings',
    'audit',
    'usage',
    'workbench',
    'recipes',
    'api',
    'auth',
    'login',
    'logout',
  ];
  return reservedRoutes.includes(id.toLowerCase());
}

/**
 * Validate recipe ID format
 * Recipe IDs must be UUIDv7 format and not reserved route names
 *
 * @param recipeId - Recipe ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateRecipeId(recipeId: string): { valid: boolean; error?: string } {
  if (!recipeId || typeof recipeId !== 'string') {
    return { valid: false, error: 'Recipe ID is required' };
  }

  if (isReservedRouteName(recipeId)) {
    return {
      valid: false,
      error: `'${recipeId}' is a reserved route name and cannot be used as a recipe ID`,
    };
  }

  // For now, we accept any non-reserved string as recipe ID
  // In production, you might want to enforce UUIDv7 format:
  // if (!isValidUUIDv7(recipeId)) {
  //   return { valid: false, error: 'Recipe ID must be a valid UUIDv7 format' };
  // }

  return { valid: true };
}

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
  runtime_preferences_json: z.record(z.string(), z.unknown()).optional(),
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
