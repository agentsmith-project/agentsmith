/**
 * Fetch-based API Client Adapter
 *
 * This adapter uses the native fetch API to make real HTTP requests.
 * Used in production when NEXT_PUBLIC_USE_MSW is false or unset.
 */

import type { ApiClient, ApiRequestOptions, ApiUploadOptions } from '../client';
import { API_BASE, ApiError } from '../client';
import { createAuthenticatedSSE, fetchSSETicket } from '../sse-client';
import { notifyUnauthorized, tryRefreshSession } from '@/lib/auth/session-recovery';

export class FetchApiClient implements ApiClient {
  private token: string | null = null;

  private async parseJsonBody(response: Response): Promise<unknown> {
    if (typeof response.text !== 'function') {
      const fallbackResponse = response as Response & { json?: () => Promise<unknown> };
      if (typeof fallbackResponse.json === 'function') {
        return fallbackResponse.json();
      }
      return undefined;
    }

    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (response.ok) {
        throw new ApiError('INVALID_RESPONSE', 'Invalid server response', '', response.status);
      }
      throw new ApiError('UNKNOWN_ERROR', `HTTP ${response.status}`, '', response.status);
    }
  }

  private buildUrl(path: string, params?: Record<string, string | number>): string {
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
    return url;
  }

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
    requestContext: { retryAfterRefresh?: boolean; skipAuthRefresh?: boolean } = {},
  ): Promise<T> {
    const { params, ...fetchOptions } = options;

    // Build URL with query params
    const url = this.buildUrl(path, params);

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

      if (response.status === 401) {
        if (!requestContext.skipAuthRefresh && !requestContext.retryAfterRefresh) {
          let refreshed = false;
          try {
            refreshed = await tryRefreshSession();
          } catch {
            refreshed = false;
          }
          if (refreshed) {
            return this.request<T>(path, options, {
              retryAfterRefresh: true,
              skipAuthRefresh: true,
            });
          }
        }
        notifyUnauthorized(path);
      }

      // Handle empty responses (e.g. 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        if (!response.ok) {
          throw new ApiError('UNKNOWN_ERROR', `HTTP ${response.status}`, '', response.status);
        }
        return undefined as T;
      }

      const data = await this.parseJsonBody(response);

      if (!response.ok) {
        throw new ApiError(
          typeof data === 'object' && data !== null && 'error_code' in data
            ? String((data as { error_code?: string }).error_code ?? 'UNKNOWN_ERROR')
            : 'UNKNOWN_ERROR',
          typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: string }).message ?? `HTTP ${response.status}`)
            : `HTTP ${response.status}`,
          typeof data === 'object' && data !== null && 'request_id' in data
            ? String((data as { request_id?: string }).request_id ?? '')
            : '',
          response.status,
          typeof data === 'object' && data !== null
            ? ((data as Record<string, unknown>).details as Record<string, unknown> | undefined) ?? (data as Record<string, unknown>)
            : undefined,
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('NETWORK_ERROR', 'Network request failed');
    }
  }

  private async requestBlob(
    path: string,
    options: RequestInit & { params?: Record<string, string | number> } = {},
    requestContext: { retryAfterRefresh?: boolean; skipAuthRefresh?: boolean } = {},
  ): Promise<Blob> {
    const { params, ...fetchOptions } = options;

    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
      });

      if (response.status === 401) {
        if (!requestContext.skipAuthRefresh && !requestContext.retryAfterRefresh) {
          let refreshed = false;
          try {
            refreshed = await tryRefreshSession();
          } catch {
            refreshed = false;
          }
          if (refreshed) {
            return this.requestBlob(path, options, {
              retryAfterRefresh: true,
              skipAuthRefresh: true,
            });
          }
        }
        notifyUnauthorized(path);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          typeof errorData === 'object' && errorData && 'error_code' in errorData
            ? String((errorData as { error_code?: string }).error_code ?? 'UNKNOWN_ERROR')
            : 'UNKNOWN_ERROR',
          typeof errorData === 'object' && errorData && 'message' in errorData
            ? String((errorData as { message?: string }).message ?? `HTTP ${response.status}`)
            : `HTTP ${response.status}`,
          typeof errorData === 'object' && errorData && 'request_id' in errorData
            ? String((errorData as { request_id?: string }).request_id ?? '')
            : undefined,
          response.status,
          typeof errorData === 'object' && errorData !== null
            ? ((errorData as Record<string, unknown>).details as Record<string, unknown> | undefined)
              ?? (errorData as Record<string, unknown>)
            : undefined,
        );
      }

      return response.blob();
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

  async getBlob(path: string, options?: ApiRequestOptions): Promise<Blob> {
    return this.requestBlob(path, { ...options, method: 'GET' });
  }

  async postMultipart<T>(path: string, formData: FormData, options?: ApiUploadOptions): Promise<T> {
    return this.requestMultipart<T>(path, formData, options);
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

  async connectSSE(path: string, options?: ApiRequestOptions): Promise<EventSource> {
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

    const ticket = await fetchSSETicket(this.token, API_BASE);
    return createAuthenticatedSSE(url, ticket, {
      onError: (error) => {
        console.error('[SSE] Connection error:', error);
      },
    });
  }

  private async requestMultipart<T>(
    path: string,
    formData: FormData,
    options?: ApiUploadOptions,
    requestContext: { retryAfterRefresh?: boolean; skipAuthRefresh?: boolean } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options?.params);

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const headers: Record<string, string> = {
        ...(options?.headers ?? {}),
      };
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const cleanupAbort = () => {
        if (options?.signal) {
          options.signal.removeEventListener('abort', handleAbort);
        }
      };

      const rejectWithApiError = async () => {
        const responseText = xhr.responseText ?? '';
        let errorData: {
          error_code?: string;
          message?: string;
          request_id?: string;
          details?: Record<string, unknown>;
        } = {};

        if (responseText.trim()) {
          try {
            errorData = JSON.parse(responseText) as typeof errorData;
          } catch {
            errorData = { message: responseText };
          }
        }

        if (xhr.status === 401 && !requestContext.skipAuthRefresh && !requestContext.retryAfterRefresh) {
          let refreshed = false;
          try {
            refreshed = await tryRefreshSession();
          } catch {
            refreshed = false;
          }
          if (refreshed) {
            cleanupAbort();
            try {
              resolve(await this.requestMultipart<T>(path, formData, options, {
                retryAfterRefresh: true,
                skipAuthRefresh: true,
              }));
            } catch (error) {
              reject(error);
            }
            return;
          }
          notifyUnauthorized(path);
        }

        reject(new ApiError(
          errorData.error_code ?? 'UNKNOWN_ERROR',
          errorData.message ?? `Upload failed with status ${xhr.status}`,
          errorData.request_id,
          xhr.status || undefined,
          errorData.details,
        ));
      };

      const handleAbort = () => xhr.abort();

      if (options?.onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            options.onProgress?.(Math.min((event.loaded / event.total) * 100, 99));
          }
        });
      }

      xhr.addEventListener('load', () => {
        cleanupAbort();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as T;
            options?.onProgress?.(100);
            resolve(parsed);
          } catch {
            reject(new ApiError('INVALID_RESPONSE', 'Failed to parse response'));
          }
          return;
        }
        void rejectWithApiError();
      });

      xhr.addEventListener('error', () => {
        cleanupAbort();
        reject(new ApiError('NETWORK_ERROR', 'Network request failed'));
      });

      xhr.addEventListener('abort', () => {
        cleanupAbort();
        reject(new ApiError('REQUEST_ABORTED', 'Upload was aborted'));
      });

      if (options?.signal) {
        if (options.signal.aborted) {
          xhr.abort();
          return;
        }
        options.signal.addEventListener('abort', handleAbort, { once: true });
      }

      xhr.open('POST', url);
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
      xhr.send(formData);
    });
  }
}
