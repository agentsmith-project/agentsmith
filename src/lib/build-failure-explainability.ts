import { ApiError } from '@/lib/api/client';

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
  | 'error'
  | 'stream_unavailable'
  | 'stream_interrupted'
  | 'stream_recovery_exhausted'
  | 'ticket_unavailable'
  | 'ticket_unauthorized'
  | 'ticket_rate_limited'
  | 'ticket_network'
  | 'reconcile_failed';

export type NotebookTraceFailureKind =
  | 'trace_unavailable'
  | 'trace_forbidden'
  | 'trace_network'
  | 'trace_failed';

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
  errorCode?: string | null,
): NotebookRealtimeFailureKind | null {
  if (connectionStatus === 'connected') return null;
  if (connectionStatus === 'error') {
    switch (errorCode) {
      case 'SSE_TICKET_UNAVAILABLE':
        return 'ticket_unavailable';
      case 'SSE_TICKET_UNAUTHORIZED':
        return 'ticket_unauthorized';
      case 'SSE_TICKET_RATE_LIMITED':
        return 'ticket_rate_limited';
      case 'TASK_EVENTS_STREAM_UNAVAILABLE':
        return 'stream_unavailable';
      case 'TASK_EVENTS_STREAM_INTERRUPTED':
        return 'stream_interrupted';
      case 'TASK_EVENTS_RECOVERY_EXHAUSTED':
        return 'stream_recovery_exhausted';
      case 'SSE_TICKET_NETWORK_ERROR':
      case 'SSE_TICKET_UPSTREAM':
      case 'SSE_TICKET_INVALID_RESPONSE':
        return 'ticket_network';
      case 'TRACE_RECONCILE_FAILED':
        return 'reconcile_failed';
      default:
        return 'error';
    }
  }
  return connectionStatus;
}

export function classifyNotebookTraceFailure(error: unknown): NotebookTraceFailureKind {
  if (error instanceof ApiError) {
    if (error.isNotFoundError()) {
      return 'trace_unavailable';
    }
    if (error.isPermissionError()) {
      return 'trace_forbidden';
    }
    if (error.isNetworkError() || error.isServerError()) {
      return 'trace_network';
    }
  }
  return 'trace_failed';
}
