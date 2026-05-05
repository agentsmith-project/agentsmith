import { randomUUID } from 'node:crypto';
import type { CachePort } from '@mbos/ports';

export type InternalTicketPurpose = 'sse_access' | 'agent_execution' | 'terminal_ws_access';

export interface SseAccessTicketPayload {
  bearer_token: string;
}

export interface AgentExecutionTicketPayload {
  endpoint_id: string;
  task_id?: string;
  runner_session_id?: string;
  agent_runner_id?: string;
}

export interface TerminalWsAccessTicketPayload {
  task_id: string;
  terminal_session_id: string;
}

export type InternalTicketPayloadByPurpose = {
  sse_access: SseAccessTicketPayload;
  agent_execution: AgentExecutionTicketPayload;
  terminal_ws_access: TerminalWsAccessTicketPayload;
};

type InternalTicketRecord<P extends InternalTicketPurpose = InternalTicketPurpose> = {
  purpose: P;
  user_id: string;
  workspace_id?: string;
  project_id?: string;
  expires_at_ms: number;
  max_uses: number;
  remaining_uses: number;
  payload: InternalTicketPayloadByPurpose[P];
};

export type ResolvedInternalTicket<P extends InternalTicketPurpose = InternalTicketPurpose> = {
  ticket: string;
  purpose: P;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  expires_at: string;
  max_uses: number;
  remaining_uses: number;
  payload: InternalTicketPayloadByPurpose[P];
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const INTERNAL_TICKET_NAMESPACE = 'internal:ticket';

function ticketKey(ticket: string): string {
  return `${INTERNAL_TICKET_NAMESPACE}:${ticket}`;
}

function toResolvedTicket<P extends InternalTicketPurpose>(
  ticket: string,
  record: InternalTicketRecord<P>,
): ResolvedInternalTicket<P> {
  return {
    ticket,
    purpose: record.purpose,
    user_id: record.user_id,
    workspace_id: record.workspace_id ?? null,
    project_id: record.project_id ?? null,
    expires_at: new Date(record.expires_at_ms).toISOString(),
    max_uses: record.max_uses,
    remaining_uses: record.remaining_uses,
    payload: record.payload,
  };
}

function normalizeAgentExecutionTicketPayload(input: AgentExecutionTicketPayload): AgentExecutionTicketPayload {
  return {
    endpoint_id: input.endpoint_id,
    ...(typeof input.task_id === 'string' && input.task_id.trim() ? { task_id: input.task_id.trim() } : {}),
    ...(typeof input.runner_session_id === 'string' && input.runner_session_id.trim()
      ? { runner_session_id: input.runner_session_id.trim() }
      : {}),
    ...(typeof input.agent_runner_id === 'string' && input.agent_runner_id.trim()
      ? { agent_runner_id: input.agent_runner_id.trim() }
      : {}),
  };
}

function normalizeInternalTicketPayload<P extends InternalTicketPurpose>(
  purpose: P,
  payload: InternalTicketPayloadByPurpose[P],
): InternalTicketPayloadByPurpose[P] {
  if (purpose === 'agent_execution') {
    return normalizeAgentExecutionTicketPayload(
      payload as AgentExecutionTicketPayload,
    ) as InternalTicketPayloadByPurpose[P];
  }
  return payload;
}

export async function issueInternalTicket<P extends InternalTicketPurpose>(
  cache: CachePort,
  args: {
    purpose: P;
    userId: string;
    workspaceId?: string | null;
    projectId?: string | null;
    payload: InternalTicketPayloadByPurpose[P];
    prefix?: string;
    ttlMs?: number;
    maxUses?: number;
  },
): Promise<{
  ticket: string;
  expiresAt: string;
  maxUses: number;
}> {
  const ttlMs = Math.max(1, args.ttlMs ?? DEFAULT_TTL_MS);
  const maxUses = Math.max(1, args.maxUses ?? 1);
  const now = Date.now();
  const prefix = (args.prefix ?? 'int').trim().replace(/[^a-z0-9_-]/gi, '') || 'int';
  const ticket = `${prefix}_${randomUUID().replace(/-/g, '')}`;
  const record: InternalTicketRecord<P> = {
    purpose: args.purpose,
    user_id: args.userId,
    ...(args.workspaceId ? { workspace_id: args.workspaceId } : {}),
    ...(args.projectId ? { project_id: args.projectId } : {}),
    expires_at_ms: now + ttlMs,
    max_uses: maxUses,
    remaining_uses: maxUses,
    payload: normalizeInternalTicketPayload(args.purpose, args.payload),
  };
  await cache.set(ticketKey(ticket), JSON.stringify(record), Math.max(1, Math.ceil(ttlMs / 1000)));
  return {
    ticket,
    expiresAt: new Date(record.expires_at_ms).toISOString(),
    maxUses,
  };
}

export async function resolveInternalTicket<P extends InternalTicketPurpose>(
  cache: CachePort,
  ticket: string,
  expectedPurpose?: P,
): Promise<ResolvedInternalTicket<P> | null> {
  if (!ticket.trim()) return null;
  const raw = await cache.get(ticketKey(ticket));
  if (!raw) return null;
  let record: InternalTicketRecord | null = null;
  try {
    record = JSON.parse(raw) as InternalTicketRecord;
  } catch {
    await cache.del(ticketKey(ticket));
    return null;
  }
  if (!record || record.expires_at_ms <= Date.now()) {
    await cache.del(ticketKey(ticket));
    return null;
  }
  if (expectedPurpose && record.purpose !== expectedPurpose) {
    return null;
  }
  record.remaining_uses -= 1;
  const resolved = toResolvedTicket(ticket, record as InternalTicketRecord<P>);
  if (record.remaining_uses <= 0) {
    await cache.del(ticketKey(ticket));
  } else {
    const remainingMs = Math.max(1, record.expires_at_ms - Date.now());
    await cache.set(ticketKey(ticket), JSON.stringify(record), Math.max(1, Math.ceil(remainingMs / 1000)));
  }
  return resolved;
}

export async function resetInternalTicketsForTest(
  cache: CachePort,
  issuedTickets: readonly string[] = [],
): Promise<void> {
  await Promise.all(issuedTickets.map((ticket) => cache.del(ticketKey(ticket))));
}

export function isAgentExecutionTicket(
  ticket: ResolvedInternalTicket | null | undefined,
): ticket is ResolvedInternalTicket<'agent_execution'> {
  return ticket?.purpose === 'agent_execution';
}

export function isTerminalWsAccessTicket(
  ticket: ResolvedInternalTicket | null | undefined,
): ticket is ResolvedInternalTicket<'terminal_ws_access'> {
  return ticket?.purpose === 'terminal_ws_access';
}
