/**
 * Authenticated SSE Client
 *
 * ================================================================================
 * SECURITY WARNING: JWT TOKEN EXPOSURE IN SSE URLS
 * ================================================================================
 *
 * This implementation currently passes JWT tokens via URL query parameters.
 * This is a KNOWN SECURITY VULNERABILITY because:
 *
 * 1. **Server Access Logs**: JWT tokens appear in web server access logs
 * 2. **Browser History**: Tokens are visible in browser history
 * 3. **Referer Headers**: Tokens leak to external sites via Referer headers
 * 4. **Network Monitoring**: Tokens visible in proxy/load balancer logs
 *
 * Why this exists:
 * - The browser EventSource API does NOT support custom HTTP headers
 * - There is no native way to pass Authorization headers to SSE connections
 *
 * PRODUCTION SOLUTION (requires backend changes):
 * --------------------------------------------------------------------
 * Implement a ticket-based authentication system:
 *
 * 1. Client sends POST request to /api/v1/sse-ticket with Authorization header
 *    Request: POST /api/v1/sse-ticket
 *             Authorization: Bearer <jwt_token>
 *
 * 2. Backend validates JWT and returns short-lived ticket
 *    Response: { ticket_id: "abc123", expires_in: 300 }
 *              - ticket_id: Random, single-use, short-lived (5 min)
 *              - expires_in: Seconds until expiration
 *
 * 3. Client connects to SSE endpoint with ticket (not JWT)
 *    new EventSource('/api/v1/events?ticket=abc123')
 *
 * 4. Backend validates ticket independently without exposing sensitive data
 *    - Ticket is stored in Redis/memory with expiration
 *    - Ticket can only be used once (optional)
 *    - No sensitive data in URL or logs
 *
 * CURRENT STATUS:
 * --------------------------------------------------------------------
 * - Using "ticket" parameter name (abstraction layer, but still contains JWT)
 * - Token is URL-encoded for basic obfuscation
 * - Full security requires backend /sse-ticket endpoint implementation
 *
 * When backend implements POST /api/v1/sse-ticket, use fetchSSETicket() before
 * connecting so the URL contains a short-lived ticket instead of the JWT.
 *
 * Related: https://developer.mozilla.org/en-US/docs/Web/API/EventSource
 *          (EventSource does not support custom headers)
 */

export interface SSEOptions {
  /** Callback invoked when the token expires (EventSource closes) */
  onTokenExpired?: () => void;
  /** Callback invoked when any error occurs */
  onError?: (error: Event) => void;
  /** Callback invoked when a message is received */
  onMessage?: (data: string) => void;
}

/**
 * Create an authenticated SSE connection
 *
 * @param path - The SSE endpoint path (e.g., '/api/v1/events')
 * @param token - JWT token for authentication (will be encoded for URL)
 * @param options - SSE event handlers
 * @returns EventSource instance
 *
 * @example
 * ```ts
 * const sse = createAuthenticatedSSE('/api/v1/chat/stream', token, {
 *   onMessage: (data) => console.log('Received:', data),
 *   onTokenExpired: () => console.log('Token expired, re-authenticating...'),
 *   onError: (err) => console.error('SSE error:', err),
 * });
 * ```
 */
export function createAuthenticatedSSE(
  path: string,
  token: string | null,
  options?: SSEOptions,
): EventSource {
  let url = path;

  if (token) {
    // NOTE: When using createAuthenticatedSSEAsync + fetchSSETicket, this may be a short-lived ticket.
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}ticket=${encodeURIComponent(getSSETicket(token))}`;
  }

  const eventSource = new EventSource(url);

  if (options?.onTokenExpired || options?.onError) {
    eventSource.addEventListener('error', (event) => {
      const target = event.target as EventSource;
      // EventSource.CLOSED (2) indicates the connection closed
      // This may be due to token expiration or other issues
      if (target.readyState === EventSource.CLOSED) {
        options.onTokenExpired?.();
      }
      options.onError?.(event);
    });
  }

  if (options?.onMessage) {
    eventSource.onmessage = (event) => {
      options.onMessage?.(event.data);
    };
  }

  return eventSource;
}

/**
 * Exchange JWT for a short-lived SSE ticket when backend supports it.
 * Call this before createAuthenticatedSSE to avoid putting the JWT in the SSE URL.
 *
 * @param token - JWT (Bearer); if null, returns null
 * @param apiBase - Base URL for the API (e.g. https://api.example.com/api/v1)
 * @returns Ticket ID to use in SSE URL, or the token as fallback when backend does not support /sse-ticket
 */
export async function fetchSSETicket(
  token: string | null,
  apiBase: string,
): Promise<string | null> {
  if (!token) return null;
  const url = `${apiBase.replace(/\/+$/, '')}/sse-ticket`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return token;
    const data = (await res.json()) as { ticket_id?: string };
    if (typeof data?.ticket_id === 'string' && data.ticket_id.length > 0) {
      return data.ticket_id;
    }
  } catch {
    // Network or parse error: fall back to token in URL (existing risk)
  }
  return token;
}

/**
 * Create an authenticated SSE connection, using a short-lived ticket when the backend
 * provides POST /api/v1/sse-ticket. Otherwise falls back to token in URL (see module docs).
 *
 * @param path - Full SSE URL
 * @param token - JWT (or null for unauthenticated)
 * @param options - Event handlers
 * @param apiBase - API base URL for ticket exchange
 * @returns Promise that resolves to the EventSource
 */
export async function createAuthenticatedSSEAsync(
  path: string,
  token: string | null,
  options: SSEOptions | undefined,
  apiBase: string,
): Promise<EventSource> {
  const ticket = await fetchSSETicket(token, apiBase);
  return createAuthenticatedSSE(path, ticket, options);
}

/**
 * Get an SSE ticket for the connection (sync path).
 * Returns the token as-is; use fetchSSETicket + createAuthenticatedSSE for secure ticket flow.
 */
function getSSETicket(token: string): string {
  return token;
}
