/**
 * Authenticated SSE client.
 *
 * Current baseline:
 * - The browser still cannot attach Authorization headers to EventSource.
 * - AgentSmith exchanges the bearer token for an opaque `/api/v1/sse-ticket`.
 * - SSE URLs carry only the opaque ticket, not the JWT.
 *
 * Temporary JWT fallback remains available only through explicit env flags in
 * controlled local/test environments.
 */

// Environment variables for SSE ticket migration
const SSE_TICKET_ENABLED =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SSE_TICKET_ENABLED === 'true';
const SSE_TICKET_PERCENTAGE = Number(
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE || '0',
);
const IS_PRODUCTION =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
const SSE_ALLOW_JWT_FALLBACK =
  typeof process !== 'undefined'
  && process.env?.NEXT_PUBLIC_SSE_ALLOW_JWT_FALLBACK === 'true'
  && !IS_PRODUCTION;

/**
 * Configuration for SSE ticket migration
 */
export interface SSETicketConfig {
  /** Whether ticket mode is enabled via environment switch */
  enabled: boolean;
  /** Grayscale rollout percentage (0-100) */
  percentage: number;
}

/**
 * Get the current SSE ticket configuration from environment variables
 */
export function getSSETicketConfig(): SSETicketConfig {
  return {
    enabled: SSE_TICKET_ENABLED,
    percentage: SSE_TICKET_PERCENTAGE,
  };
}

/**
 * Determine if a given user should use ticket-based authentication based on grayscale rollout
 *
 * Uses a deterministic hash-based approach to ensure consistent behavior for each user.
 *
 * @param userId - User identifier for consistent rollout decision
 * @returns true if user should use ticket, false otherwise
 */
export function shouldUseTicket(userId: string): boolean {
  const config = getSSETicketConfig();

  // If ticket mode is not enabled, never use ticket
  if (!config.enabled) {
    return false;
  }

  // If percentage is 100%, all users use ticket
  if (config.percentage >= 100) {
    return true;
  }

  // If percentage is 0%, no users use ticket
  if (config.percentage <= 0) {
    return false;
  }

  // Simple hash-based rollout: hash userId to number 0-99, compare with percentage
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const bucket = Math.abs(hash) % 100;

  return bucket < config.percentage;
}

export interface SSEOptions {
  /** Callback invoked when the token expires (EventSource closes) */
  onTokenExpired?: () => void;
  /** Callback invoked when any error occurs */
  onError?: (error: Event) => void;
  /** Callback invoked when a message is received */
  onMessage?: (data: string) => void;
}

export class SSETicketError extends Error {
  constructor(
    public code:
      | 'SSE_TICKET_UNAVAILABLE'
      | 'SSE_TICKET_UNAUTHORIZED'
      | 'SSE_TICKET_RATE_LIMITED'
      | 'SSE_TICKET_UPSTREAM'
      | 'SSE_TICKET_NETWORK_ERROR'
      | 'SSE_TICKET_INVALID_RESPONSE',
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'SSETicketError';
  }
}

interface SSETicketFetchResult {
  ticket: string | null;
  error?: SSETicketError;
}

/**
 * Create an authenticated SSE connection
 *
 * @param path - The SSE endpoint path (e.g., '/api/v1/events')
 * @param token - Opaque SSE ticket (or null for unauthenticated streams)
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
 * Call this before `createAuthenticatedSSE` to avoid putting the JWT in the SSE URL.
 *
 * By default this function does NOT fall back to JWT on failure.
 * To temporarily enable fallback in controlled environments, set:
 * NEXT_PUBLIC_SSE_ALLOW_JWT_FALLBACK=true
 *
 * @param token - JWT (Bearer); if null, returns null
 * @param apiBase - Base URL for the API (e.g. https://api.example.com/api/v1)
 * @returns Opaque ticket to use in the SSE URL, null if no ticket is available,
 * or JWT when explicit fallback is enabled in controlled environments
 */
export async function fetchSSETicket(
  token: string | null,
  apiBase: string,
): Promise<string | null> {
  const result = await exchangeSSETicket(token, apiBase);
  return result.ticket;
}

async function exchangeSSETicket(
  token: string | null,
  apiBase: string,
): Promise<SSETicketFetchResult> {
  if (!token) return { ticket: null };
  const url = `${apiBase.replace(/\/+$/, '')}/sse-ticket`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (SSE_ALLOW_JWT_FALLBACK) {
        return { ticket: token };
      }
      return {
        ticket: null,
        error: mapTicketResponseError(res.status),
      };
    }
    const data = (await res.json()) as { ticket?: string };
    if (typeof data?.ticket === 'string' && data.ticket.length > 0) {
      return { ticket: data.ticket };
    }
    if (!SSE_ALLOW_JWT_FALLBACK) {
      return {
        ticket: null,
        error: new SSETicketError(
          'SSE_TICKET_INVALID_RESPONSE',
          'SSE ticket endpoint did not return a usable ticket.',
        ),
      };
    }
  } catch {
    // Network or parse error
    return SSE_ALLOW_JWT_FALLBACK
      ? { ticket: token }
      : {
        ticket: null,
        error: new SSETicketError(
          'SSE_TICKET_NETWORK_ERROR',
          'Failed to reach the SSE ticket endpoint.',
        ),
      };
  }
  return SSE_ALLOW_JWT_FALLBACK ? { ticket: token } : { ticket: null };
}

/**
 * Create an authenticated SSE connection, using a short-lived ticket when the backend
 * provides POST /api/v1/sse-ticket. Otherwise falls back only when the explicit
 * local/test JWT fallback switch is enabled.
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
  const result = await exchangeSSETicket(token, apiBase);
  if (token && !result.ticket && result.error) {
    throw result.error;
  }
  const ticket = result.ticket;
  return createAuthenticatedSSE(path, ticket, options);
}

/**
 * Returns the ticket string as-is.
 * `createAuthenticatedSSE` should only receive an opaque ticket generated by
 * `fetchSSETicket`, unless local/test fallback is explicitly enabled.
 */
function getSSETicket(token: string): string {
  return token;
}

function mapTicketResponseError(statusCode: number): SSETicketError {
  if (statusCode === 401 || statusCode === 403) {
    return new SSETicketError(
      'SSE_TICKET_UNAUTHORIZED',
      'SSE ticket request was rejected by authentication or authorization policy.',
      statusCode,
    );
  }
  if (statusCode === 404) {
    return new SSETicketError(
      'SSE_TICKET_UNAVAILABLE',
      'SSE ticket endpoint is not available in this environment.',
      statusCode,
    );
  }
  if (statusCode === 429) {
    return new SSETicketError(
      'SSE_TICKET_RATE_LIMITED',
      'SSE ticket request was rate limited.',
      statusCode,
    );
  }
  return new SSETicketError(
    'SSE_TICKET_UPSTREAM',
    'SSE ticket exchange failed due to an upstream server error.',
    statusCode,
  );
}
