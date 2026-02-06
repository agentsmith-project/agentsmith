/**
 * Fetch-based API Client Adapter
 *
 * This adapter uses the native fetch API to make real HTTP requests.
 * Used in production when NEXT_PUBLIC_USE_MSW is false or unset.
 */

import type { ApiClient, ApiRequestOptions } from '../client';
import { API_BASE, ApiError } from '../client';
import { createAuthenticatedSSE } from '../sse-client';

export class FetchApiClient implements ApiClient {
  private token: string | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  clearToken(): void {
    this.token = null;
  }

  private async request<T>(
    path: string,
    options: RequestInit & { params?: Record<string, string | number> } = {},
  ): Promise<T> {
    const { params, ...fetchOptions } = options;

    // Build URL with query params
    let url = `${API_BASE}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        searchParams.append(key, String(value));
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Build headers - only set Content-Type when a body is present
    const headers: Record<string, string> = {
      ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(fetchOptions.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
      });

      // Handle empty responses (e.g. 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        if (!response.ok) {
          throw new ApiError('UNKNOWN_ERROR', `HTTP ${response.status}`, '', response.status);
        }
        return undefined as T;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error_code || 'UNKNOWN_ERROR',
          data.message || `HTTP ${response.status}`,
          data.request_id,
          response.status,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('NETWORK_ERROR', 'Network request failed');
    }
  }

  async get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  connectSSE(path: string, options?: ApiRequestOptions): EventSource {
    let url = `${API_BASE}${path}`;

    if (options?.params) {
      const searchParams = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        searchParams.append(key, String(value));
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return createAuthenticatedSSE(url, this.token, {
      onError: (error) => {
        console.error('[SSE] Connection error:', error);
      },
    });
  }
}
