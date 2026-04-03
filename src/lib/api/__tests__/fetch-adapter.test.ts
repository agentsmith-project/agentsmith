/**
 * Unit tests for FetchApiClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FetchApiClient } from '../adapters/fetch-adapter';
import { ApiError, API_BASE } from '../client';
import { notifyUnauthorized, tryRefreshSession } from '@/lib/auth/session-recovery';

vi.mock('@/lib/auth/session-recovery', () => ({
  notifyUnauthorized: vi.fn(),
  tryRefreshSession: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  status = 0;
  responseText = '';
  upload = {
    addEventListener: vi.fn(),
  };

  private listeners = new Map<string, Array<() => void>>();
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => {
    this.emit('abort');
  });
  setRequestHeader = vi.fn();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  addEventListener(event: string, handler: () => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(handler);
    this.listeners.set(event, existing);
  }

  emit(event: string) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler();
    }
  }

  static latest() {
    const instance = MockXMLHttpRequest.instances.at(-1);
    if (!instance) {
      throw new Error('No XMLHttpRequest instance created');
    }
    return instance;
  }

  static reset() {
    MockXMLHttpRequest.instances = [];
  }
}

global.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;

describe('FetchApiClient', () => {
  let client: FetchApiClient;
  const testToken = 'test-auth-token';

  beforeEach(() => {
    client = new FetchApiClient();
    mockFetch.mockClear();
    MockXMLHttpRequest.reset();
    vi.mocked(tryRefreshSession).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Token Management', () => {
    it('should set and get token', () => {
      client.setToken(testToken);
      expect(client.getToken()).toBe(testToken);
    });

    it('should clear token', () => {
      client.setToken(testToken);
      expect(client.getToken()).toBe(testToken);
      client.clearToken();
      expect(client.getToken()).toBeNull();
    });

    it('should return null when token not set', () => {
      expect(client.getToken()).toBeNull();
    });
  });

  describe('HTTP Methods', () => {
    const mockResponse = { id: 1, name: 'Test' };

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => mockResponse,
      });
    });

    it('should make GET request', async () => {
      const result = await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should make POST request with body', async () => {
      const body = { name: 'Test', value: 123 };
      await client.post('/test', body);

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should make PUT request with body', async () => {
      const body = { name: 'Updated' };
      await client.put('/test/1', body);

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test/1`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        })
      );
    });

    it('should make PATCH request with body', async () => {
      const body = { status: 'active' };
      await client.patch('/test/1', body);

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test/1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });

    it('should make DELETE request', async () => {
      await client.delete('/test/1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test/1`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('Authorization Headers', () => {
    beforeEach(() => {
      client.setToken(testToken);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      });
    });

    it('should include Authorization header when token is set', async () => {
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${testToken}`,
          }),
        })
      );
    });

    it('should not include Authorization header when token is cleared', async () => {
      client.clearToken();
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String),
          }),
        })
      );
    });

    it('should include Authorization header for blob downloads when token is set', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: async () => blob,
      });

      await expect(client.getBlob('/files/test')).resolves.toBe(blob);

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/files/test`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${testToken}`,
          }),
        }),
      );
    });
  });

  describe('Query Parameters', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
      });
    });

    it('should append query parameters to URL', async () => {
      await client.get('/test', { params: { page: 1, limit: 10 } });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test?page=1&limit=10`,
        expect.any(Object)
      );
    });

    it('should handle numeric parameters', async () => {
      await client.get('/test', { params: { id: 123, count: 456 } });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test?id=123&count=456`,
        expect.any(Object)
      );
    });

    it('should handle empty parameters object', async () => {
      await client.get('/test', { params: {} });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.any(Object)
      );
    });

    it('should encode special characters in parameters', async () => {
      await client.get('/test', { params: { search: 'hello world', filter: 'a&b' } });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('search=hello+world');
      expect(calledUrl).toContain('filter=a%26b');
    });
  });

  describe('Error Handling', () => {
    it('should notify global session recovery on 401 responses when refresh fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({
          error_code: 'UNAUTHORIZED',
          message: 'Unauthorized',
          request_id: 'req-auth-1',
        }),
      });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).toHaveBeenCalledWith('/test');
    });

    it('should retry once after successful session refresh', async () => {
      vi.mocked(tryRefreshSession).mockResolvedValue(true);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: { get: () => null },
          json: async () => ({
            error_code: 'UNAUTHORIZED',
            message: 'Unauthorized',
            request_id: 'req-auth-1',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ id: 'ok' }),
        });

      await expect(client.get('/test')).resolves.toEqual({ id: 'ok' });
      expect(tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry blob download once after successful session refresh', async () => {
      vi.mocked(tryRefreshSession).mockResolvedValue(true);
      const blob = new Blob(['after-refresh'], { type: 'text/plain' });
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: { get: () => null },
          json: async () => ({
            error_code: 'UNAUTHORIZED',
            message: 'Unauthorized',
            request_id: 'req-auth-blob',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          blob: async () => blob,
        });

      await expect(client.getBlob('/download')).resolves.toBe(blob);
      expect(tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry multipart upload once after successful session refresh', async () => {
      vi.mocked(tryRefreshSession).mockResolvedValue(true);

      const uploadPromise = client.postMultipart('/upload', new FormData());

      const first = MockXMLHttpRequest.latest();
      first.status = 401;
      first.responseText = JSON.stringify({
        error_code: 'UNAUTHORIZED',
        message: 'Unauthorized',
        request_id: 'req-upload-1',
      });
      first.emit('load');

      await Promise.resolve();

      const second = MockXMLHttpRequest.latest();
      second.status = 200;
      second.responseText = JSON.stringify({ id: 'uploaded' });
      second.emit('load');

      await expect(uploadPromise).resolves.toEqual({ id: 'uploaded' });
      expect(tryRefreshSession).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).not.toHaveBeenCalled();
    });

    it('should throw ApiError on HTTP error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: async () => ({
          error_code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          request_id: 'req-123',
        }),
      });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      await expect(client.get('/test')).rejects.toThrow('Invalid input');
    });

    it('should include error details in ApiError', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({
          error_code: 'NOT_FOUND',
          message: 'Resource not found',
          request_id: 'req-456',
        }),
      });

      try {
        await client.get('/test');
        expect.fail('Should have thrown ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).errorCode).toBe('NOT_FOUND');
        expect((error as ApiError).requestId).toBe('req-456');
      }
    });

    it('should use default error code when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: async () => ({
          message: 'Internal server error',
        }),
      });

      try {
        await client.get('/test');
        expect.fail('Should have thrown ApiError');
      } catch (error) {
        expect((error as ApiError).errorCode).toBe('UNKNOWN_ERROR');
      }
    });

    it('should use HTTP status in message when error message not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({}),
      });

      try {
        await client.get('/test');
        expect.fail('Should have thrown ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).toContain('HTTP 503');
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      await expect(client.get('/test')).rejects.toThrow('Network request failed');
    });

    it('should re-throw ApiError instances directly', async () => {
      const originalError = new ApiError('CUSTOM_ERROR', 'Custom error message');
      mockFetch.mockRejectedValue(originalError);

      await expect(client.get('/test')).rejects.toThrow(originalError);
    });
  });

  describe('Custom Headers', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      });
    });

    it('should merge custom headers with default headers', async () => {
      await client.get('/test', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Another-Header': 'another-value',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
            'X-Another-Header': 'another-value',
          }),
        })
      );
    });

    it('should allow overriding default headers', async () => {
      await client.post('/test', {}, {
        headers: {
          'Content-Type': 'application/xml',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
          }),
        })
      );
    });
  });

  describe('SSE Connection', () => {
    let capturedUrl: string = '';

    beforeEach(() => {
      capturedUrl = '';
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ticket: 'test-sse-ticket' }),
      });

      // Mock EventSource constructor
      class MockEventSource {
        url: string;
        readyState: 0 | 1 | 2;
        withCredentials: boolean;
        onopen: ((this: EventSource, ev: Event) => unknown) | null;
        onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null;
        onerror: ((this: EventSource, ev: Event) => unknown) | null;
        CONNECTING: 0;
        OPEN: 1;
        CLOSED: 2;

        constructor(url: string) {
          this.url = url;
          capturedUrl = url;
          this.readyState = 0;
          this.withCredentials = false;
          this.onopen = null;
          this.onmessage = null;
          this.onerror = null;
          this.CONNECTING = 0;
          this.OPEN = 1;
          this.CLOSED = 2;
        }

        addEventListener() { return vi.fn(); }
        removeEventListener() { return vi.fn(); }
        dispatchEvent() { return true; }
        close() { return vi.fn(); }
      }

      global.EventSource = MockEventSource as unknown as typeof EventSource;
    });

    it('should create EventSource with correct URL', async () => {
      const eventSource = await client.connectSSE('/events');

      expect(capturedUrl).toBe(`${API_BASE}/events`);
      expect(eventSource).toBeInstanceOf(EventSource);
    });

    it('should append ticket as query parameter for SSE', async () => {
      client.setToken(testToken);
      const eventSource = await client.connectSSE('/events');

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/sse-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(capturedUrl).toBe(`${API_BASE}/events?ticket=test-sse-ticket`);
      expect(eventSource).toBeInstanceOf(EventSource);
    });

    it('should append query parameters to SSE URL', async () => {
      const eventSource = await client.connectSSE('/events', {
        params: { filter: 'test', type: 'realtime' },
      });

      expect(capturedUrl).toBe(`${API_BASE}/events?filter=test&type=realtime`);
      expect(eventSource).toBeInstanceOf(EventSource);
    });

    it('should combine ticket and query parameters for SSE', async () => {
      client.setToken(testToken);
      const eventSource = await client.connectSSE('/events', {
        params: { channel: 'updates' },
      });

      expect(capturedUrl).toContain('ticket=test-sse-ticket');
      expect(capturedUrl).toContain('channel=updates');
      expect(eventSource).toBeInstanceOf(EventSource);
    });

    it('should handle SSE URL that already has query params', async () => {
      client.setToken(testToken);
      const eventSource = await client.connectSSE('/events?initial=true');

      expect(capturedUrl).toBe(`${API_BASE}/events?initial=true&ticket=test-sse-ticket`);
      expect(eventSource).toBeInstanceOf(EventSource);
    });
  });

  describe('Request Options', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      });
    });

    it('should pass signal to fetch for abort capability', async () => {
      const controller = new AbortController();
      const signal = controller.signal;

      await client.get('/test', { signal });

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE}/test`,
        expect.objectContaining({
          signal,
        })
      );
    });
  });
});
