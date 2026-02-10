/**
 * MSW-based API Client Adapter
 *
 * This adapter is designed for development with MSW (Mock Service Worker).
 * It uses the same interface as FetchApiClient but routes requests through MSW handlers.
 *
 * IMPORTANT: This is a mock adapter for development only.
 * The real backend API should have the same contract.
 */

import type { ApiClient, ApiRequestOptions } from '../client';
import { API_BASE, ApiError } from '../client';
import { createAuthenticatedSSE } from '../sse-client';
import { notifyUnauthorized } from '@/lib/auth/session-recovery';

export class MSWApiClient implements ApiClient {
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

  /**
   * Build headers including auth token
   */
  private getHeaders(options?: ApiRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Add MSW flag to bypass mock when needed
    headers['X-MSW-Enable'] = 'true';

    return headers;
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, string | number>): string {
    let url = path;
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
    return url;
  }

  /**
   * Convert response to match backend API structure
   */
  private async fetchFromMsw<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    try {
      const url = `${API_BASE}${path}`;
      const response = await fetch(url, init);

      // Read as text first so we have it for error messages; body can only be consumed once
      const text = await response.text().catch(() => 'Unable to read response');
      let data: unknown;
      if (!text || text.trim() === '') {
        data = null;
      } else {
        try {
          data = JSON.parse(text) as unknown;
        } catch {
          throw new ApiError(
            'INVALID_RESPONSE',
            `Failed to parse response: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`,
            undefined,
          );
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          notifyUnauthorized(path);
        }
        const err = data as { error_code?: string; error?: string; message?: string; request_id?: string };
        throw new ApiError(
          err?.error_code || (err?.error as string) || 'UNKNOWN_ERROR',
          err?.message || (err?.error as string) || `HTTP ${response.status}`,
          err?.request_id,
          response.status,
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      // Preserve original error information
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ApiError('MSW_ERROR', `MSW request failed: ${errorMessage}`);
    }
  }

  async get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(this.buildUrl(path, options?.params), {
      method: 'GET',
      headers: this.getHeaders(options),
      signal: options?.signal,
    });
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(this.buildUrl(path, options?.params), {
      method: 'POST',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(this.buildUrl(path, options?.params), {
      method: 'PUT',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(this.buildUrl(path, options?.params), {
      method: 'PATCH',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  }

  async delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(this.buildUrl(path, options?.params), {
      method: 'DELETE',
      headers: this.getHeaders(options),
      signal: options?.signal,
    });
  }

  /**
   * SSE connection using MockEventSource (for development)
   * Falls back to native EventSource if mock not available
   */
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
        console.error('[SSE MSW] Connection error:', error);
      },
    });
  }
}
