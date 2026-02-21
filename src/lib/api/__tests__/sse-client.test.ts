import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedSSE, fetchSSETicket } from '../sse-client';

// Mock EventSource class
class MockEventSource {
  url: string;
  readyState = 0;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }
}

describe('createAuthenticatedSSE', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create EventSource with ticket parameter instead of token', () => {
    const sseConnection = createAuthenticatedSSE('/test-path', 'my-secret-token');

    expect(sseConnection).toBeInstanceOf(EventSource);
    expect(sseConnection.url).toContain('?ticket=');
    expect(sseConnection.url).not.toContain('?token=');
  });

  it('should create EventSource without token when null is passed', () => {
    const sseConnection = createAuthenticatedSSE('/test-path', null);

    expect(sseConnection).toBeInstanceOf(EventSource);
    expect(sseConnection.url).not.toContain('?ticket=');
    expect(sseConnection.url).toBe('/test-path');
  });

  it('should register error event listener when onTokenExpired callback provided', () => {
    const onTokenExpired = vi.fn();
    const sseConnection = createAuthenticatedSSE('/test-path', 'test-token', {
      onTokenExpired,
    });

    expect(sseConnection.addEventListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  it('should register onmessage handler when onMessage callback provided', () => {
    const onMessage = vi.fn();
    const sseConnection = createAuthenticatedSSE('/test-path', 'test-token', {
      onMessage,
    });

    expect(sseConnection.onmessage).toBeInstanceOf(Function);
  });

  it('should URL-encode the token for basic obfuscation', () => {
    // Token with special characters that need encoding
    const tokenWithSpecialChars = 'abc123+=/xyz';
    const sseConnection = createAuthenticatedSSE('/test-path', tokenWithSpecialChars);

    // Verify the token is URL-encoded (special chars are encoded)
    expect(sseConnection.url).toContain('ticket=');
    // '+' should be encoded as %2B, '/' as %2F, '=' as %3D
    expect(sseConnection.url).toContain('%2B');
    expect(sseConnection.url).toContain('%2F');
    expect(sseConnection.url).toContain('%3D');
  });

  it('should use & separator when URL already has query params', () => {
    const sseConnection = createAuthenticatedSSE('/test-path?existing=param', 'my-token');

    expect(sseConnection.url).toContain('&ticket=');
    expect(sseConnection.url).not.toContain('??ticket=');
  });
});

describe('fetchSSETicket', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null when token is null', async () => {
    expect(await fetchSSETicket(null, 'https://api.example.com/api/v1')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns ticket_id when backend returns 200 with ticket_id', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket_id: 'short-lived-ticket-123' }),
    });
    const result = await fetchSSETicket('jwt-token', 'https://api.example.com/api/v1');
    expect(result).toBe('short-lived-ticket-123');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/sse-ticket',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-token' },
      }),
    );
  });

  it('returns token when backend returns non-ok', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBe('my-jwt');
  });

  it('returns token when fetch throws', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBe('my-jwt');
  });
});
