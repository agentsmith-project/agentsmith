import { randomUUID } from 'node:crypto';
import type { CachePort } from '@mbos/ports';

type SSETicketRecord = {
  bearerToken: string;
  expiresAtMs: number;
  maxConnections: number;
  remainingConnections: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const TEST_TICKET_NAMESPACE = 'sse:ticket';

function ticketKey(ticket: string): string {
  return `${TEST_TICKET_NAMESPACE}:${ticket}`;
}

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
  const now = Date.now();
  const ticket = `sse_${randomUUID().replace(/-/g, '')}`;
  const expiresAtMs = now + ttlMs;
  await cache.set(ticketKey(ticket), JSON.stringify({
    bearerToken: args.bearerToken,
    expiresAtMs,
    maxConnections,
    remainingConnections: maxConnections,
  } satisfies SSETicketRecord), Math.max(1, Math.ceil(ttlMs / 1000)));
  return {
    ticket,
    expiresAt: new Date(expiresAtMs).toISOString(),
    maxConnections,
  };
}

export async function resolveSSETicket(cache: CachePort, ticket: string): Promise<{
  bearerToken: string;
  expiresAt: string;
  maxConnections: number;
} | null> {
  if (!ticket.trim()) return null;
  const raw = await cache.get(ticketKey(ticket));
  if (!raw) return null;
  let record: SSETicketRecord | null = null;
  try {
    record = JSON.parse(raw) as SSETicketRecord;
  } catch {
    await cache.del(ticketKey(ticket));
    return null;
  }
  if (!record) return null;
  if (record.expiresAtMs <= Date.now()) {
    await cache.del(ticketKey(ticket));
    return null;
  }
  record.remainingConnections -= 1;
  if (record.remainingConnections <= 0) {
    await cache.del(ticketKey(ticket));
  } else {
    const remainingMs = Math.max(1, record.expiresAtMs - Date.now());
    await cache.set(ticketKey(ticket), JSON.stringify(record), Math.max(1, Math.ceil(remainingMs / 1000)));
  }
  return {
    bearerToken: record.bearerToken,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    maxConnections: record.maxConnections,
  };
}

export async function resetSSETicketsForTest(cache: CachePort, issuedTickets: readonly string[] = []): Promise<void> {
  await Promise.all(issuedTickets.map((ticket) => cache.del(ticketKey(ticket))));
}
