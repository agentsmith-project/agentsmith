import { randomUUID } from 'node:crypto';

type SSETicketRecord = {
  bearerToken: string;
  expiresAtMs: number;
  maxConnections: number;
  remainingConnections: number;
};

const SSE_TICKETS = new Map<string, SSETicketRecord>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function sweepExpiredTickets(now = Date.now()): void {
  for (const [ticket, record] of SSE_TICKETS.entries()) {
    if (record.expiresAtMs <= now) {
      SSE_TICKETS.delete(ticket);
    }
  }
}

export function issueSSETicket(args: {
  bearerToken: string;
  ttlMs?: number;
  maxConnections?: number;
}): {
  ticket: string;
  expiresAt: string;
  maxConnections: number;
} {
  const ttlMs = Math.max(1, args.ttlMs ?? DEFAULT_TTL_MS);
  const maxConnections = Math.max(1, args.maxConnections ?? 1);
  const now = Date.now();
  sweepExpiredTickets(now);
  const ticket = `sse_${randomUUID().replace(/-/g, '')}`;
  const expiresAtMs = now + ttlMs;
  SSE_TICKETS.set(ticket, {
    bearerToken: args.bearerToken,
    expiresAtMs,
    maxConnections,
    remainingConnections: maxConnections,
  });
  return {
    ticket,
    expiresAt: new Date(expiresAtMs).toISOString(),
    maxConnections,
  };
}

export function resolveSSETicket(ticket: string): {
  bearerToken: string;
  expiresAt: string;
  maxConnections: number;
} | null {
  sweepExpiredTickets();
  const record = SSE_TICKETS.get(ticket);
  if (!record) return null;
  record.remainingConnections -= 1;
  if (record.remainingConnections <= 0) {
    SSE_TICKETS.delete(ticket);
  } else {
    SSE_TICKETS.set(ticket, record);
  }
  return {
    bearerToken: record.bearerToken,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    maxConnections: record.maxConnections,
  };
}

export function resetSSETicketsForTest(): void {
  SSE_TICKETS.clear();
}
