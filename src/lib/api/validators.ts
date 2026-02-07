/**
 * API Response Validators
 *
 * Type-safe validators to ensure API responses match expected types.
 * These validators help catch data inconsistencies early and provide
 * better error messages.
 */

import type { UsageKPI } from './types';
import { formatNumber } from '@/lib/utils/formatters';

/**
 * Validate UsageKPI response
 * Ensures all required fields are present and have correct types
 *
 * @param data - Response data to validate
 * @returns Validated UsageKPI or throws error
 */
export function validateUsageKPI(data: unknown): UsageKPI {
  if (!data || typeof data !== 'object') {
    throw new Error('UsageKPI response must be an object');
  }

  const kpi = data as Record<string, unknown>;

  // Ensure required fields exist and have correct types
  const validated: UsageKPI = {
    requests_today: typeof kpi.requests_today === 'number' ? kpi.requests_today : 0,
    errors_today: typeof kpi.errors_today === 'number' ? kpi.errors_today : 0,
  };

  // Optional fields
  if (kpi.tokens_today !== undefined) {
    if (typeof kpi.tokens_today !== 'number') {
      console.warn('[validateUsageKPI] tokens_today is not a number, defaulting to undefined');
    } else {
      validated.tokens_today = kpi.tokens_today;
    }
  }

  if (kpi.requests_yesterday !== undefined) {
    if (typeof kpi.requests_yesterday !== 'number') {
      console.warn('[validateUsageKPI] requests_yesterday is not a number, defaulting to undefined');
    } else {
      validated.requests_yesterday = kpi.requests_yesterday;
    }
  }

  if (kpi.errors_yesterday !== undefined) {
    if (typeof kpi.errors_yesterday !== 'number') {
      console.warn('[validateUsageKPI] errors_yesterday is not a number, defaulting to undefined');
    } else {
      validated.errors_yesterday = kpi.errors_yesterday;
    }
  }

  if (kpi.tokens_yesterday !== undefined) {
    if (typeof kpi.tokens_yesterday !== 'number') {
      console.warn('[validateUsageKPI] tokens_yesterday is not a number, defaulting to undefined');
    } else {
      validated.tokens_yesterday = kpi.tokens_yesterday;
    }
  }

  return validated;
}

/**
 * Safe number formatter that handles undefined, null, and NaN
 * 
 * @deprecated Use formatNumber from '@/lib/utils/formatters' instead
 * This function is kept for backward compatibility but will be removed in a future version.
 */
export function formatNumberSafe(
  num: number | undefined | null,
  defaultValue: string = '0',
): string {
  return formatNumber(num, { defaultValue });
}
