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

export class ApiError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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
   * SSE connection for streaming events
   */
  connectSSE(path: string, options?: ApiRequestOptions): EventSource;
}

/**
 * API Base URL configuration
 *
 * When using MSW (development), use relative paths so MSW can intercept requests.
 * Otherwise, use the configured backend URL.
 */
export const API_BASE = process.env.NEXT_PUBLIC_USE_MSW === 'true'
  ? '/api/v1'  // Use relative path for MSW interception
  : (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:20000');

/**
 * Create API client instance
 * Automatically chooses between MSW and Fetch based on environment
 */
export function createApiClient(): ApiClient {
  const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';

  if (useMsw) {
    // Dynamic import to avoid bundling MSW in production
    return new (require('./adapters/msw-adapter').MSWApiClient)();
  }

  return new (require('./adapters/fetch-adapter').FetchApiClient)();
}

// Singleton instance
let apiClientInstance: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!apiClientInstance) {
    apiClientInstance = createApiClient();
  }
  return apiClientInstance;
}
