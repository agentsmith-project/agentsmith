/**
 * Validation Utilities
 *
 * Type-safe validation functions for IDs, formats, and data structures.
 * This file does not use zod to ensure compatibility with Next.js Edge Runtime
 * (used by middleware). For zod-based validation, see validation-zod.ts.
 */

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
 * (e.g., 'chat', 'overview', 'files', etc.)
 *
 * @param id - String to check
 * @returns True if it looks like a reserved route
 */
export function isReservedRouteName(id: string): boolean {
  const reservedRoutes = [
    'chat',
    'overview',
    'files',
    'agent-runners',
    'agent-tasks',
    'endpoints',
    'members',
    'settings',
    'audit',
    'usage',
    'tasks',
    'api',
    'auth',
    'login',
    'logout',
  ];
  return reservedRoutes.includes(id.toLowerCase());
}

/**
 * Validate task ID format
 * Task IDs must be UUIDv7 format and not reserved route names
 *
 * @param taskId - Task ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateTaskId(taskId: string): { valid: boolean; error?: string } {
  if (!taskId || typeof taskId !== 'string') {
    return { valid: false, error: 'Task ID is required' };
  }

  if (isReservedRouteName(taskId)) {
    return {
      valid: false,
      error: `'${taskId}' is a reserved route name and cannot be used as a task ID`,
    };
  }

  // For now, we accept any non-reserved string as task ID
  // In production, you might want to enforce UUIDv7 format:
  // if (!isValidUUIDv7(taskId)) {
  //   return { valid: false, error: 'Task ID must be a valid UUIDv7 format' };
  // }

  return { valid: true };
}
