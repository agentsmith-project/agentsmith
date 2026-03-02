import { describe, expect, it } from 'vitest';
import {
  classifyChatStreamFailure,
  classifyNotebookRealtimeFailure,
} from '@/lib/build-failure-explainability';

describe('build failure explainability helpers', () => {
  it('classifies chat stream failures by stable error code', () => {
    expect(classifyChatStreamFailure('AGENT_OFFLINE')).toBe('agent_offline');
    expect(classifyChatStreamFailure('AGENT_TIMEOUT')).toBe('agent_timeout');
    expect(classifyChatStreamFailure('AGENT_PROTOCOL_ERROR')).toBe('agent_protocol');
    expect(classifyChatStreamFailure('AGENT_UPSTREAM_ERROR')).toBe('agent_upstream');
    expect(classifyChatStreamFailure('UNKNOWN')).toBe('interrupted');
    expect(classifyChatStreamFailure(null)).toBe('interrupted');
  });

  it('classifies notebook realtime connection states', () => {
    expect(classifyNotebookRealtimeFailure('connecting')).toBe('connecting');
    expect(classifyNotebookRealtimeFailure('reconnecting')).toBe('reconnecting');
    expect(classifyNotebookRealtimeFailure('disconnected')).toBe('disconnected');
    expect(classifyNotebookRealtimeFailure('error')).toBe('error');
    expect(classifyNotebookRealtimeFailure('error', 'SSE_TICKET_UNAVAILABLE')).toBe('ticket_unavailable');
    expect(classifyNotebookRealtimeFailure('error', 'SSE_TICKET_UNAUTHORIZED')).toBe('ticket_unauthorized');
    expect(classifyNotebookRealtimeFailure('error', 'SSE_TICKET_RATE_LIMITED')).toBe('ticket_rate_limited');
    expect(classifyNotebookRealtimeFailure('error', 'SSE_TICKET_NETWORK_ERROR')).toBe('ticket_network');
    expect(classifyNotebookRealtimeFailure('error', 'TRACE_RECONCILE_FAILED')).toBe('reconcile_failed');
    expect(classifyNotebookRealtimeFailure('connected')).toBeNull();
  });
});
