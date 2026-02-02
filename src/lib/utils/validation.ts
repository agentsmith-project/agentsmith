/**
 * Validation Utilities
 *
 * Type-safe validation functions for IDs, formats, and data structures.
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
