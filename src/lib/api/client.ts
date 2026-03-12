/**
 * API Client Interface
 *
 * This interface defines the contract for API clients.
 * Two implementations are provided:
 * - MSWApiClient: For development with MSW mocks
 * - FetchApiClient: For production with real backend APIs
 *
 * Switch via NEXT_PUBLIC_USE_MSW environment variable.
 */

import { FetchApiClient } from './adapters/fetch-adapter';
import { MSWApiClient } from './adapters/msw-adapter';

// MSWApiClient is dynamically imported to exclude it from production bundle.
// It will only be loaded when NEXT_PUBLIC_USE_MSW=true at build time.
// Dynamic import ensures MSW dependencies are not bundled in production.

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  data: T;
  error_code?: string;
  message?: string;
  request_id?: string;
}

// Re-export unified error class from errors.ts.
export { APIError, APIError as ApiError } from './errors';

/**
 * Core API Client Interface
 * All API operations must go through this interface
 */
export interface ApiClient {
  /**
   * Set authentication token
   */
  setToken(token: string): void;

  /**
   * Get current token
   */
  getToken(): string | null;

  /**
   * Clear token (logout)
   */
  clearToken(): void;

  /**
   * GET request
   */
  get<T>(path: string, options?: ApiRequestOptions): Promise<T>;

  /**
   * POST request
   */
  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;

  /**
   * PUT request
   */
  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;

  /**
   * PATCH request
   */
  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>;

  /**
   * DELETE request
   */
  delete<T>(path: string, options?: ApiRequestOptions): Promise<T>;

  /**
   * SSE connection for streaming events.
   * Returns a Promise so the client can exchange JWT for a short-lived ticket when backend supports it.
   */
  connectSSE(path: string, options?: ApiRequestOptions): Promise<EventSource>;
}

const rawApiBase = (process.env.NEXT_PUBLIC_API_BASE ?? '').trim();
const hasExplicitRemoteApiBase = /^https?:\/\//i.test(rawApiBase);
export const USE_MSW = process.env.NEXT_PUBLIC_USE_MSW === 'true' && !hasExplicitRemoteApiBase;

function normalizeApiBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:20000/api/v1';
  return /\/api\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}

/**
 * API Base URL configuration
 *
 * When using MSW (development), use relative paths so MSW can intercept requests.
 * Otherwise, use the configured backend URL.
 */
export const API_BASE = USE_MSW
  ? '/api/v1'  // Use relative path for MSW interception
  : normalizeApiBase(rawApiBase || 'http://localhost:20000');

/**
 * Create API client instance.
 * Automatically chooses between MSW and Fetch based on environment.
 *
 * The MSW adapter is dynamically imported to exclude it from production bundle.
 * When NEXT_PUBLIC_USE_MSW is false (production), the MSW import is eliminated
 * by webpack/Next.js dead code elimination since the condition is evaluated at
 * build time.
 */
export function createApiClient(): ApiClient {
  if (USE_MSW) {
    return new MSWApiClient();
  }

  // Default: fetch adapter for production
  return new FetchApiClient();
}

// Singleton instance
let apiClientInstance: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!apiClientInstance) {
    apiClientInstance = createApiClient();
  }
  return apiClientInstance;
}

/**
 * Reset the singleton client instance.
 * Useful for testing or when switching between workspaces/projects.
 */
export function resetApiClient(): void {
  apiClientInstance = null;
}
