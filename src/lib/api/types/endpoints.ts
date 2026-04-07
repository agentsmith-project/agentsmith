/**
 * Endpoint Extended Types
 *
 * Extended type definitions for custom endpoints, health checks, and pricing.
 * These types support the endpoints improvement plan (P0+P1 features).
 *
 * @module lib/api/types/endpoints
 */

import type { EndpointCapabilityType, EndpointUpstreamProtocol } from './index';

// ============================================================
// Custom Endpoint Types
// ============================================================

/**
 * Custom endpoint protocol types.
 * OpenAI Chat Completions: follows chat/completions upstreams
 * OpenAI Responses: follows responses upstreams
 * Anthropic Messages: follows Anthropic Messages upstreams
 */
export type CustomEndpointUpstreamProtocol = EndpointUpstreamProtocol;

/**
 * Custom endpoint configuration for creating custom provider endpoints.
 * Used when provider_family is 'custom'.
 */
export interface CustomEndpointConfig {
  /** Protocol type for the custom endpoint */
  upstreamProtocol: CustomEndpointUpstreamProtocol;
  /** Base URL for the API endpoint (e.g., "https://api.openai.com/v1") */
  baseUrl: string;
  /** Model identifier (e.g., "gpt-4o", "claude-3-5-sonnet") */
  modelName: string;
  /** Capability type supported by this model */
  capability: EndpointCapabilityType;
  /** Reference to the credential stored in the project */
  credentialRef: string;
}

// ============================================================
// Health Check Types
// ============================================================

/**
 * Error category for endpoint health check failures.
 * Helps users understand what went wrong and how to fix it.
 */
export type EndpointHealthErrorCategory =
  | 'auth'           // Authentication failed (invalid credential)
  | 'network'        // Network error (DNS, connection refused)
  | 'upstream'       // Upstream service error (5xx from provider)
  | 'timeout'        // Request timed out
  | 'rate_limit'     // Rate limited by provider
  | 'unknown';       // Unknown error

/**
 * Endpoint health check result.
 * Represents the status of a single endpoint health check.
 */
export interface EndpointHealthCheck {
  /** Endpoint ID that was checked */
  endpointId: string;
  /** Health status */
  status: 'pass' | 'fail' | 'unknown';
  /** ISO timestamp when the check was performed */
  checkedAt: string;
  /** Latency in milliseconds (only present when status is 'pass') */
  latencyMs?: number;
  /** Error message (only present when status is 'fail') */
  error?: string;
  /** Categorized error type (only present when status is 'fail') */
  errorCategory?: EndpointHealthErrorCategory;
}

// ============================================================
// Batch Health Check Types
// ============================================================

/**
 * Request for batch endpoint health check.
 */
export interface BatchHealthCheckRequest {
  /** Specific endpoint IDs to check (optional, checks all if not provided) */
  endpointIds?: string[];
  /** Mode: 'all' checks all endpoints, 'selected' checks only endpointIds */
  mode?: 'all' | 'selected';
}

/**
 * Response for batch endpoint health check.
 */
export interface BatchHealthCheckResponse {
  /** Individual health check results for each endpoint */
  results: EndpointHealthCheck[];
  /** Summary statistics */
  summary: {
    /** Total number of endpoints checked */
    total: number;
    /** Number of endpoints that passed */
    passed: number;
    /** Number of endpoints that failed */
    failed: number;
    /** Number of endpoints skipped (e.g., disabled) */
    skipped: number;
  };
}

// ============================================================
// Pricing Types
// ============================================================

/**
 * Supported currencies for model pricing.
 */
export type PricingCurrency = 'USD' | 'CNY' | 'EUR';

/**
 * Pricing unit for token-based pricing.
 */
export type PricingUnit = 'million' | 'thousand';

/**
 * Model pricing configuration.
 * Stores pricing information for a specific model on an endpoint.
 */
export interface ModelPricing {
  /** Model identifier */
  modelId: string;
  /** Endpoint ID this pricing applies to */
  endpointId: string;
  /** Currency for pricing */
  currency: PricingCurrency;
  /** Input token price per unit */
  inputTokenPrice: number;
  /** Output token price per unit */
  outputTokenPrice: number;
  /** Pricing unit (million or thousand tokens) */
  unit: PricingUnit;
  /** ISO timestamp when pricing was last updated */
  updatedAt?: string;
}

/**
 * Request to update model pricing.
 */
export interface UpdatePricingRequest {
  /** Currency for pricing */
  currency?: PricingCurrency;
  /** Input token price per unit */
  inputTokenPrice?: number;
  /** Output token price per unit */
  outputTokenPrice?: number;
  /** Pricing unit */
  unit?: PricingUnit;
}

// ============================================================
// Validation Types
// ============================================================

/**
 * Request to validate endpoint connectivity.
 */
export interface ValidateEndpointRequest {
  /** Base URL to validate */
  baseUrl: string;
  /** Protocol type */
  upstreamProtocol: CustomEndpointUpstreamProtocol;
  /** Credential reference to use for validation */
  credentialRef: string;
  /** Optional model to test with */
  model?: string;
}

/**
 * Response from endpoint validation.
 */
export interface ValidateEndpointResponse {
  /** Validation result */
  valid: boolean;
  /** Health check result if validation was performed */
  healthCheck?: EndpointHealthCheck;
  /** Error message if validation failed */
  error?: string;
}
