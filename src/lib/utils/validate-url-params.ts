import type { ParamValue } from 'next/dist/server/request/params';

/**
 * Zod schema for validating workspace ID parameter
 * Accepts UUIDs or alphanumeric strings with hyphens/underscores
 */
const WORKSPACE_ID_SCHEMA = /^[a-zA-Z0-9_-]+$/;

/**
 * Zod schema for validating project ID parameter
 * Accepts UUIDs or alphanumeric strings with hyphens/underscores
 */
const PROJECT_ID_SCHEMA = /^[a-zA-Z0-9_-]+$/;

/**
 * Extract string value from Next.js ParamValue
 * ParamValue can be: string | string[] | undefined
 * We only want the first string if it's an array
 */
function paramToString(param: ParamValue | null | undefined): string | null {
  if (param === null || param === undefined) {
    return null;
  }
  if (Array.isArray(param)) {
    return param.length > 0 ? param[0] : null;
  }
  return param;
}

/**
 * Validate workspace parameter from URL
 * Returns undefined if invalid, preventing XSS/injection attacks
 *
 * @param param - The workspace parameter from URL (ParamValue from Next.js)
 * @returns Valid workspace ID string or undefined
 */
export function validateWorkspaceParam(param: ParamValue | null | undefined): string | undefined {
  const strValue = paramToString(param);
  if (!strValue) {
    return undefined;
  }

  // Trim whitespace
  const trimmed = strValue.trim();

  // Must be at least 1 character and match schema
  if (trimmed.length === 0 || !WORKSPACE_ID_SCHEMA.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

/**
 * Validate project parameter from URL
 * Returns undefined if invalid, preventing XSS/injection attacks
 *
 * @param param - The project parameter from URL (ParamValue from Next.js)
 * @returns Valid project ID string or undefined
 */
export function validateProjectParam(param: ParamValue | null | undefined): string | undefined {
  const strValue = paramToString(param);
  if (!strValue) {
    return undefined;
  }

  // Trim whitespace
  const trimmed = strValue.trim();

  // Must be at least 1 character and match schema
  if (trimmed.length === 0 || !PROJECT_ID_SCHEMA.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
