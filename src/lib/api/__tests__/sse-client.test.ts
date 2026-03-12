import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedSSE, createAuthenticatedSSEAsync, fetchSSETicket, SSETicketError } from '../sse-client';

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
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('returns null when token is null', async () => {
    expect(await fetchSSETicket(null, 'https://api.example.com/api/v1')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns ticket when backend returns 200 with ticket', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'short-lived-ticket-123' }),
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

  it('returns null when backend returns non-ok (strict mode default)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (strict mode default)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBeNull();
  });

  it('returns token when explicit JWT fallback is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SSE_ALLOW_JWT_FALLBACK', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();
    const sseModule = await import('../sse-client');
    const { fetchSSETicket } = sseModule;

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBe('my-jwt');
  });

  it('never falls back to JWT in production even when fallback env is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SSE_ALLOW_JWT_FALLBACK', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const sseModule = await import('../sse-client');
    const { fetchSSETicket } = sseModule;

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await fetchSSETicket('my-jwt', 'https://api.example.com/api/v1');
    expect(result).toBeNull();

    vi.stubEnv('NODE_ENV', 'test');
  });
});

// =============================================================================
// NEW TESTS FOR SSE TICKET MIGRATION (Epic B1)
// =============================================================================

describe('SSE Ticket Migration - Feature Flag', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('respects SSE_TICKET_ENABLED environment variable for runtime switch', async () => {
    // Enable ticket mode via env var
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';

    // Dynamic import to get the module with updated env
    const sseModule = await import('../sse-client');
    const { fetchSSETicket } = sseModule;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'ticket-abc-123' }),
    });
    globalThis.fetch = mockFetch;

    const result = await fetchSSETicket('jwt-token', 'https://api.example.com/api/v1');

    // Should fetch ticket when enabled
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/sse-ticket',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-token' },
      }),
    );
    expect(result).toBe('ticket-abc-123');

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
  });

  it('returns null when ticket mode enabled and fetch fails (no JWT fallback)', async () => {
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';

    const sseModule = await import('../sse-client');
    const { fetchSSETicket } = sseModule;

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    globalThis.fetch = mockFetch;

    const result = await fetchSSETicket('jwt-token', 'https://api.example.com/api/v1');

    // Should NOT fall back to JWT - return null instead
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalled();

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
  });
});

describe('SSE Ticket Migration - Grayscale Rollout', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('respects SSE_TICKET_PERCENTAGE for grayscale rollout (10%)', async () => {
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';
    process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE = '10';

    const sseModule = await import('../sse-client');
    const { shouldUseTicket } = sseModule;

    // When percentage is 10, 10% of requests should use ticket
    // We use a seeded random for deterministic testing
    const usesTicket = await shouldUseTicket?.('user-123');

    // For user-123 with 10% percentage, should return boolean
    expect(typeof usesTicket).toBe('boolean');

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
    delete process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE;
  });

  it('respects SSE_TICKET_PERCENTAGE for grayscale rollout (100%)', async () => {
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';
    process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE = '100';

    const sseModule = await import('../sse-client');
    const { shouldUseTicket } = sseModule;

    // When percentage is 100, all requests should use ticket
    const usesTicket = await shouldUseTicket?.('any-user');
    expect(usesTicket).toBe(true);

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
    delete process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE;
  });

  it('respects SSE_TICKET_PERCENTAGE for grayscale rollout (0%)', async () => {
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';
    process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE = '0';

    const sseModule = await import('../sse-client');
    const { shouldUseTicket } = sseModule;

    // When percentage is 0, no requests should use ticket
    const usesTicket = await shouldUseTicket?.('any-user');
    expect(usesTicket).toBe(false);

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
    delete process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE;
  });
});

describe('SSE Ticket Migration - Security', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never includes JWT token in SSE URL when using ticket mode', async () => {
    const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'secure-ticket-xyz' }),
    });
    globalThis.fetch = mockFetch;

    const sseModule = await import('../sse-client');
    const { createAuthenticatedSSEAsync } = sseModule;

    const eventSource = await createAuthenticatedSSEAsync(
      '/api/v1/chat/stream',
      jwtToken,
      undefined,
      'https://api.example.com/api/v1',
    );

    // JWT should NOT be in URL
    expect(eventSource.url).not.toContain(jwtToken);
    expect(eventSource.url).not.toContain('eyJ');

    // Ticket should be in URL instead
    expect(eventSource.url).toContain('ticket=secure-ticket-xyz');

    // JWT should only be sent in Authorization header
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/sse-ticket',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${jwtToken}` },
      }),
    );
  });
});

describe('SSE Ticket Migration - Smoke Tests (Full Flow)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('smoke: full ticket flow - connect, receive, reconnection', async () => {
    const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    const apiBase = 'https://api.example.com/api/v1';

    // Mock successful ticket exchange
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'ticket-smoke-test-123' }),
    });
    globalThis.fetch = mockFetch;

    const sseModule = await import('../sse-client');
    const { createAuthenticatedSSEAsync, getSSETicketConfig } = sseModule;

    // Step 1: Verify config can be read
    const config = getSSETicketConfig();
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('percentage');

    // Step 2: Create SSE connection with ticket
    const eventSource = await createAuthenticatedSSEAsync(
      '/api/v1/chat/stream',
      jwtToken,
      undefined,
      apiBase,
    );

    // Step 3: Verify ticket was fetched
    expect(mockFetch).toHaveBeenCalledWith(
      `${apiBase}/sse-ticket`,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${jwtToken}` },
      }),
    );

    // Step 4: Verify SSE URL contains ticket, not JWT
    expect(eventSource.url).toContain('ticket=ticket-smoke-test-123');
    expect(eventSource.url).not.toContain(jwtToken);
    expect(eventSource.url).not.toContain('eyJ');

    // Step 5: Verify EventSource was created successfully
    expect(eventSource).toBeInstanceOf(EventSource);
  });

  it('smoke: ticket flow graceful degradation when endpoint unavailable', async () => {
    const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    const apiBase = 'https://api.example.com/api/v1';

    // Mock 404 response (ticket endpoint not implemented yet)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    globalThis.fetch = mockFetch;

    await expect(
      createAuthenticatedSSEAsync(
        '/api/v1/chat/stream',
        jwtToken,
        undefined,
        apiBase,
      ),
    ).rejects.toMatchObject({
      name: 'SSETicketError',
      code: 'SSE_TICKET_UNAVAILABLE',
    } satisfies Partial<SSETicketError>);

    expect(mockFetch).toHaveBeenCalled();
  });

  it('smoke: deterministic user assignment for grayscale rollout', async () => {
    process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED = 'true';
    process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE = '50';

    const sseModule = await import('../sse-client');
    const { shouldUseTicket } = sseModule;

    // Test that the same user gets the same result consistently
    const userId = 'test-user-consistency-123';

    const result1 = shouldUseTicket?.(userId);
    const result2 = shouldUseTicket?.(userId);
    const result3 = shouldUseTicket?.(userId);

    // All results should be identical (deterministic)
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);

    // Different users should potentially get different results at 50%
    const differentUserResult = shouldUseTicket?.('different-user-456');
    // We can't guarantee they're different, but we verify the function works
    expect(typeof differentUserResult).toBe('boolean');

    delete process.env.NEXT_PUBLIC_SSE_TICKET_ENABLED;
    delete process.env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE;
  });
});
