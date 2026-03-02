export type ChatStreamFailureKind =
  | 'agent_offline'
  | 'agent_timeout'
  | 'agent_protocol'
  | 'agent_upstream'
  | 'interrupted';

export type NotebookRealtimeFailureKind =
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export function classifyChatStreamFailure(errorCode?: string | null): ChatStreamFailureKind {
  switch (errorCode) {
    case 'AGENT_OFFLINE':
      return 'agent_offline';
    case 'AGENT_TIMEOUT':
      return 'agent_timeout';
    case 'AGENT_PROTOCOL_ERROR':
      return 'agent_protocol';
    case 'AGENT_UPSTREAM_ERROR':
      return 'agent_upstream';
    default:
      return 'interrupted';
  }
}

export function classifyNotebookRealtimeFailure(
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error',
): NotebookRealtimeFailureKind | null {
  if (connectionStatus === 'connected') return null;
  return connectionStatus;
}
