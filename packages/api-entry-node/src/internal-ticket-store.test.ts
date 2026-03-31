import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  issueInternalTicket,
  resetInternalTicketsForTest,
  resolveInternalTicket,
} from './internal-ticket-store.js';

describe('internal-ticket-store', () => {
  const cache = new InMemoryCache();
  const issuedTickets: string[] = [];

  afterEach(() => resetInternalTicketsForTest(cache, issuedTickets.splice(0)));

  it('issues agent execution tickets with scoped payload', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_1',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
      maxUses: 3,
    });
    issuedTickets.push(issued.ticket);

    expect(issued.ticket).toMatch(/^exec_/);

    await expect(resolveInternalTicket(cache, issued.ticket, 'agent_execution')).resolves.toMatchObject({
      purpose: 'agent_execution',
      user_id: 'user_1',
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      max_uses: 3,
      payload: expect.objectContaining({
        endpoint_id: 'ep_1',
        task_id: 'task_1',
      }),
    });
  });

  it('rejects purpose mismatches without consuming the stored ticket', async () => {
    const issued = await issueInternalTicket(cache, {
      purpose: 'agent_execution',
      userId: 'user_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_1',
        mode: 'chat',
      },
    });
    issuedTickets.push(issued.ticket);

    await expect(resolveInternalTicket(cache, issued.ticket, 'sse_access')).resolves.toBeNull();
    await expect(resolveInternalTicket(cache, issued.ticket, 'agent_execution')).resolves.toMatchObject({
      purpose: 'agent_execution',
    });
  });
});
