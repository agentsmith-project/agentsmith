import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  issueSSETicket,
  resetSSETicketsForTest,
  resolveSSETicket,
} from './sse-ticket-store.js';

describe('sse-ticket-store', () => {
  const cache = new InMemoryCache();
  const issuedTickets: string[] = [];

  afterEach(() => {
    return resetSSETicketsForTest(cache, issuedTickets.splice(0));
  });

  it('issues opaque tickets that resolve back to the bearer token', async () => {
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);
    expect(issued.ticket).toMatch(/^sse_/);
    expect(issued.ticket).not.toBe('jwt-token-123');

    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toMatchObject({
      bearerToken: 'jwt-token-123',
      maxConnections: 1,
    });
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toBeNull();
  });

  it('supports multiple resolves when maxConnections is greater than one', async () => {
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123', maxConnections: 2 });
    issuedTickets.push(issued.ticket);
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toMatchObject({
      bearerToken: 'jwt-token-123',
      maxConnections: 2,
    });
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toMatchObject({
      bearerToken: 'jwt-token-123',
      maxConnections: 2,
    });
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toBeNull();
  });

  it('expires tickets after ttl', async () => {
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123', ttlMs: 5 });
    issuedTickets.push(issued.ticket);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toBeNull();
  });

  it('can resolve a ticket issued through the same shared cache from another call site', async () => {
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-shared' });
    issuedTickets.push(issued.ticket);
    await expect(resolveSSETicket(cache, issued.ticket)).resolves.toMatchObject({
      bearerToken: 'jwt-token-shared',
      maxConnections: 1,
    });
  });
});
