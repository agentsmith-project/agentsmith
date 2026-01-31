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
   * Simulate API delay for realistic development experience
   */
  private async delay(ms: number = 100): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert response to match backend API structure
   */
  private async fetchFromMsw<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    // Add small delay to simulate network
    await this.delay();

    try {
      const url = `${API_BASE}${path}`;
      const response = await fetch(url, init);

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error_code || data.error || 'UNKNOWN_ERROR',
          data.message || data.error || `HTTP ${response.status}`,
          data.request_id,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('MSW_ERROR', 'MSW request failed - ensure MSW is running');
    }
  }

  async get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(path, {
      method: 'GET',
      headers: this.getHeaders(options),
    });
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(path, {
      method: 'POST',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
    });
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(path, {
      method: 'PUT',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
    });
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(path, {
      method: 'PATCH',
      headers: this.getHeaders(options),
      body: JSON.stringify(body),
    });
  }

  async delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.fetchFromMsw<T>(path, {
      method: 'DELETE',
      headers: this.getHeaders(options),
    });
  }

  /**
   * SSE connection using MockEventSource (for development)
   * Falls back to native EventSource if mock not available
   */
  connectSSE(path: string, options?: ApiRequestOptions): EventSource {
    let url = `${API_BASE}${path}`;

    // Add token to URL query params for SSE
    if (this.token) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}token=${encodeURIComponent(this.token)}`;
    }

    if (options?.params) {
      const separator = url.includes('?') ? '&' : '?';
      const searchParams = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        searchParams.append(key, String(value));
      });
      url += `${separator}${searchParams.toString()}`;
    }

    // In development, MSW will intercept EventSource
    return new EventSource(url);
  }
}
