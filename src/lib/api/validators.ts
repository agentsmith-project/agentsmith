/**
 * API Response Validators
 *
 * Type-safe validators to ensure API responses match expected types.
 * These validators help catch data inconsistencies early and provide
 * better error messages.
 */

import { formatNumber } from '@/lib/utils/formatters';

/** Safe number formatter that handles undefined, null, and NaN. */
export function formatNumberSafe(
  num: number | undefined | null,
  defaultValue: string = '0',
): string {
  return formatNumber(num, { defaultValue });
}
