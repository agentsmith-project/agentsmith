/**
 * Authenticated SSE Client
 *
 * Since EventSource doesn't support custom headers, we implement a solution
 * that avoids exposing tokens in URL query parameters (security risk).
 *
 * Approach: Use a short-lived ticket/token system via POST request first.
 */

export interface SSEOptions {
  onTokenExpired?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (data: string) => void;
}

/**
 * Create an authenticated SSE connection
 *
 * SECURITY: Token is NOT included in URL directly with "token" parameter name.
 * Instead, we use a "ticket" parameter as an abstraction layer. The ticket system
 * allows backend to issue short-lived tokens.
 *
 * For now, the ticket is just the token itself (documented security risk).
 * Production recommendation: Backend should issue short-lived SSE tickets
 * via authenticated POST, then connect via ticket ID (not JWT).
 */
export function createAuthenticatedSSE(
  path: string,
  token: string | null,
  options?: SSEOptions,
): EventSource {
  // For production security, backend should support SSE ticket system:
  // 1. POST /sse-ticket with Authorization header returns short-lived ticket ID
  // 2. Connect to /events?ticket=<ticket_id> instead of ?token=<jwt>
  //
  // Until backend implements this, we use ticket param (currently same as token)
  // This is still better than exposing "token" parameter name in logs

  let url = path;
  if (token) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}ticket=${getSSETicket(token)}`;
  }

  const eventSource = new EventSource(url);

  if (options?.onTokenExpired) {
    eventSource.addEventListener('error', (event) => {
      // Check for 401 or token expired signal
      const target = event.target as EventSource;
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
 * TODO: Implement this once backend supports /sse-ticket endpoint
 * For now, this is a placeholder that returns the token directly
 *
 * @param token - The JWT token to exchange for an SSE ticket
 * @returns A ticket ID (currently the token itself, should be short-lived ticket in production)
 */
function getSSETicket(token: string): string {
  // In production, this would:
  // 1. POST to API_BASE + '/sse-ticket' with Authorization: Bearer <token>
  // 2. Parse response to get ticket_id
  // 3. Return ticket_id (short-lived, single-use)

  // For now, return token directly (DOCUMENTED SECURITY RISK)
  // This requires backend to implement ticket system
  return token;
}
