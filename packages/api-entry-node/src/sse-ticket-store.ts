import type { CachePort } from '@mbos/ports';
import {
  issueInternalTicket,
  resetInternalTicketsForTest,
  resolveInternalTicket,
} from './internal-ticket-store.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function issueSSETicket(cache: CachePort, args: {
  bearerToken: string;
  ttlMs?: number;
  maxConnections?: number;
}): Promise<{
  ticket: string;
  expiresAt: string;
  maxConnections: number;
}> {
  const ttlMs = Math.max(1, args.ttlMs ?? DEFAULT_TTL_MS);
  const maxConnections = Math.max(1, args.maxConnections ?? 1);
  const issued = await issueInternalTicket(cache, {
    purpose: 'sse_access',
    userId: 'sse_ticket',
    prefix: 'sse',
    payload: {
      bearer_token: args.bearerToken,
    },
    ttlMs,
    maxUses: maxConnections,
  });
  return {
    ticket: issued.ticket,
    expiresAt: issued.expiresAt,
    maxConnections,
  };
}

export async function resolveSSETicket(cache: CachePort, ticket: string): Promise<{
  bearerToken: string;
  expiresAt: string;
  maxConnections: number;
} | null> {
  const record = await resolveInternalTicket(cache, ticket, 'sse_access');
  if (!record) return null;
  return {
    bearerToken: record.payload.bearer_token,
    expiresAt: record.expires_at,
    maxConnections: record.max_uses,
  };
}

export async function resetSSETicketsForTest(cache: CachePort, issuedTickets: readonly string[] = []): Promise<void> {
  await resetInternalTicketsForTest(cache, issuedTickets);
}
