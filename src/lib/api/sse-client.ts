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
 * TODO: [SECURITY] Implement ticket system once backend supports /sse-ticket endpoint
 * TODO: [SECURITY] Create /api/v1/sse-ticket endpoint in backend
 * TODO: [SECURITY] Add Redis-based ticket storage with 5-minute expiration
 * TODO: [SECURITY] Update this function to fetch ticket before SSE connection
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
    // NOTE: Using "ticket" parameter name as abstraction layer
    // Currently contains the JWT token directly (documented security risk)
    // TODO: Replace with actual ticket ID once backend implements /sse-ticket
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}ticket=${encodeURIComponent(getSSETicket(token))}`;
  }

  const eventSource = new EventSource(url);

  if (options?.onTokenExpired) {
    eventSource.addEventListener('error', (event) => {
      const target = event.target as EventSource;
      // EventSource.CLOSED (2) indicates the connection closed
      // This may be due to token expiration or other issues
      if (target.readyState === EventSource.CLOSED) {
        options.onTokenExpired?.();
      }
      options?.onError?.(event);
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
 * Get an SSE ticket for the connection
 *
 * CURRENT IMPLEMENTATION (insecure):
 * Returns the JWT token directly, which is then passed via URL query parameter.
 * This is documented as a security risk (see module-level documentation).
 *
 * PRODUCTION IMPLEMENTATION (secure):
 * Should exchange the JWT for a short-lived ticket via authenticated POST:
 *
 * ```ts
 * async function getSSETicket(token: string): Promise<string> {
 *   const response = await fetch('/api/v1/sse-ticket', {
 *     method: 'POST',
 *     headers: { 'Authorization': `Bearer ${token}` },
 *   });
 *
 *   if (!response.ok) {
 *     throw new Error('Failed to obtain SSE ticket');
 *   }
 *
 *   const { ticket_id } = await response.json();
 *   return ticket_id;
 * }
 * ```
 *
 * @param token - The JWT token to exchange for an SSE ticket
 * @returns A ticket ID (currently the token itself - SECURITY RISK)
 *
 * TODO: [SECURITY] Implement ticket exchange once backend supports /sse-ticket
 * TODO: [BACKEND] Add POST /api/v1/sse-ticket endpoint
 * TODO: [BACKEND] Store tickets in Redis with 5-minute expiration
 * TODO: [BACKEND] Validate tickets on SSE connection
 */
function getSSETicket(token: string): string {
  // TEMPORARY: Return token directly (DOCUMENTED SECURITY RISK)
  // This exposes the JWT in URL, server logs, browser history, and Referer headers
  //
  // MIGRATION PATH:
  // 1. Backend implements /api/v1/sse-ticket endpoint
  // 2. This function becomes async and fetches ticket from backend
  // 3. createAuthenticatedSSE awaits the ticket before connecting
  // 4. Ticket is single-use, short-lived (5 minutes)
  // 5. No sensitive data exposed in URLs or logs

  return token;
}
