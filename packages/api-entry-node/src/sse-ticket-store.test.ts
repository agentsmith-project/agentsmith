import { afterEach, describe, expect, it } from 'vitest';
import {
  issueSSETicket,
  resetSSETicketsForTest,
  resolveSSETicket,
} from './sse-ticket-store.js';

describe('sse-ticket-store', () => {
  afterEach(() => {
    resetSSETicketsForTest();
  });

  it('issues opaque tickets that resolve back to the bearer token', () => {
    const issued = issueSSETicket({ bearerToken: 'jwt-token-123' });
    expect(issued.ticket).toMatch(/^sse_/);
    expect(issued.ticket).not.toBe('jwt-token-123');

    expect(resolveSSETicket(issued.ticket)).toMatchObject({
      bearerToken: 'jwt-token-123',
      maxConnections: 1,
    });
  });

  it('expires tickets after ttl', async () => {
    const issued = issueSSETicket({ bearerToken: 'jwt-token-123', ttlMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(resolveSSETicket(issued.ticket)).toBeNull();
  });
});
