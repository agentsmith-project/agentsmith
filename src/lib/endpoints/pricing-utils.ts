/**
 * Pricing Utility Functions
 *
 * Helper functions for working with pricing data across different formats:
 * - ProjectPricingMap (API format)
 * - Models catalog pricing data
 * - Default pricing constants
 */

import type { ProjectPricingMap } from '@/lib/api';

// Re-export for convenience
export type { ProjectPricingMap } from '@/lib/api';

export type PricingField = 'input' | 'output' | 'cached' | 'reasoning' | 'cache_creation';

export const PRICING_FIELDS: PricingField[] = [
  'input',
  'output',
  'cached',
  'reasoning',
  'cache_creation',
];

/**
 * Default pricing values when no pricing is available
 */
export const DEFAULT_PRICING_VALUES: Record<PricingField, number> = {
  input: 0,
  output: 0,
  cached: 0,
  reasoning: 0,
  'cache_creation': 0,
};

/**
 * Format a pricing value for display
 * @param value - The pricing value per million tokens
 * @returns Formatted string with 2 decimal places
 */
export function formatPricingValue(value: number | undefined | null): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }
  return value.toFixed(2);
}

/**
 * Parse a pricing input string to a number
 * @param input - User input string
 * @returns Parsed number or null if invalid
 */
export function parsePricingInput(input: string): number | null {
  const parsed = parseFloat(input);
  if (isNaN(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Validate a pricing value
 * @param value - The value to validate
 * @returns True if valid, false otherwise
 */
export function isValidPricingValue(value: number): boolean {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

/**
 * Get all unique providers from a pricing map
 * @param pricingMap - The pricing map to extract providers from
 * @returns Sorted array of provider keys
 */
export function getProviders(pricingMap: ProjectPricingMap): string[] {
  return Object.keys(pricingMap).sort();
}

/**
 * Get all models for a specific provider
 * @param pricingMap - The pricing map to extract models from
 * @param provider - The provider key
 * @returns Sorted array of model IDs
 */
export function getModelsForProvider(
  pricingMap: ProjectPricingMap,
  provider: string
): string[] {
  return Object.keys(pricingMap[provider] || {}).sort();
}

/**
 * Get pricing for a specific model
 * @param pricingMap - The pricing map to read from
 * @param provider - The provider key
 * @param model - The model ID
 * @returns Pricing object with all fields defaulted to 0
 */
export function getModelPricing(
  pricingMap: ProjectPricingMap,
  provider: string,
  model: string
): Record<PricingField, number> {
  const modelPricing = pricingMap[provider]?.[model];
  return {
    input: modelPricing?.input ?? DEFAULT_PRICING_VALUES.input,
    output: modelPricing?.output ?? DEFAULT_PRICING_VALUES.output,
    cached: modelPricing?.cached ?? DEFAULT_PRICING_VALUES.cached,
    reasoning: modelPricing?.reasoning ?? DEFAULT_PRICING_VALUES.reasoning,
    'cache_creation': modelPricing?.['cache_creation'] ?? DEFAULT_PRICING_VALUES['cache_creation'],
  };
}

/**
 * Update pricing for a specific model
 * @param pricingMap - The current pricing map
 * @param provider - The provider key
 * @param model - The model ID
 * @param field - The pricing field to update
 * @param value - The new value
 * @returns Updated pricing map (immutable)
 */
export function updateModelPricing(
  pricingMap: ProjectPricingMap,
  provider: string,
  model: string,
  field: PricingField,
  value: number
): ProjectPricingMap {
  return {
    ...pricingMap,
    [provider]: {
      ...(pricingMap[provider] || {}),
      [model]: {
        ...(pricingMap[provider]?.[model] || {}),
        [field]: value,
      },
    },
  };
}

/**
 * Calculate total count of pricing entries
 * @param pricingMap - The pricing map to count
 * @returns Total number of provider-model combinations
 */
export function countPricingEntries(pricingMap: ProjectPricingMap): number {
  let count = 0;
  for (const provider of Object.keys(pricingMap)) {
    for (const _model of Object.keys(pricingMap[provider] || {})) {
      count++;
    }
  }
  return count;
}

/**
 * Check if pricing map is empty
 * @param pricingMap - The pricing map to check
 * @returns True if empty or undefined
 */
export function isEmptyPricingMap(pricingMap: ProjectPricingMap | undefined): boolean {
  if (!pricingMap) return true;
  return countPricingEntries(pricingMap) === 0;
}

/**
 * Get display name for pricing field
 * @param field - The pricing field
 * @param t - Translation function
 * @returns Display name
 */
export function getPricingFieldLabel(
  field: PricingField,
  t: (key: string) => string
): string {
  const key = `pricing.field_${field}`;
  return t(key);
}

/**
 * Create a deep copy of pricing map
 * @param pricingMap - The pricing map to copy
 * @returns New pricing map with same structure
 */
export function clonePricingMap(pricingMap: ProjectPricingMap): ProjectPricingMap {
  return JSON.parse(JSON.stringify(pricingMap)) as ProjectPricingMap;
}

/**
 * Merge pricing maps with later maps overriding earlier ones
 * @param maps - Array of pricing maps to merge
 * @returns Merged pricing map
 */
export function mergePricingMaps(...maps: (ProjectPricingMap | undefined)[]): ProjectPricingMap {
  const result: ProjectPricingMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const provider of Object.keys(map)) {
      result[provider] = result[provider] || {};
      for (const model of Object.keys(map[provider])) {
        result[provider][model] = {
          ...(result[provider][model] || {}),
          ...map[provider][model],
        };
      }
    }
  }
  return result;
}
