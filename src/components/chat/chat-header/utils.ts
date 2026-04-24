import type { Agent, ChatSession, Endpoint } from '@/lib/api/types';
import type { SessionStreamStatus } from '@/lib/chat/stream-state';

export function findCurrentEndpoint(session: ChatSession | null, endpoints: Endpoint[]) {
  if (!session) return null;
  return endpoints.find((endpoint) => endpoint.id === session.endpoint_id) || null;
}

export function findCurrentExternalAgent(session: ChatSession | null, externalAgents: Agent[]) {
  if (!session?.external_agent_id) return null;
  return externalAgents.find((agent) => agent.id === session.external_agent_id) ?? null;
}

export function getStreamStatusText(
  streamStatus: SessionStreamStatus,
  t: (key: string) => string,
) {
  if (streamStatus === 'connecting' || streamStatus === 'streaming') return t('header.status_generating');
  if (streamStatus === 'stopping') return `${t('composer.stop')}…`;
  if (streamStatus === 'recovering') return t('header.status_recovering');
  if (streamStatus === 'stopped') return t('header.status_stopped');
  if (streamStatus === 'error') return t('header.status_error');
  return '';
}
