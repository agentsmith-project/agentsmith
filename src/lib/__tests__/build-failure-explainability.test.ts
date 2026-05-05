import { describe, expect, it } from 'vitest';
import {
  classifyAgentTaskTraceFailure,
  classifyChatStreamFailure,
  classifyAgentTaskRealtimeFailure,
} from '@/lib/build-failure-explainability';
import { ApiError } from '@/lib/api/client';

describe('build failure explainability helpers', () => {
  it('classifies chat stream failures by stable error code', () => {
    expect(classifyChatStreamFailure('AGENT_OFFLINE')).toBe('agent_offline');
    expect(classifyChatStreamFailure('AGENT_TIMEOUT')).toBe('agent_timeout');
    expect(classifyChatStreamFailure('AGENT_PROTOCOL_ERROR')).toBe('agent_protocol');
    expect(classifyChatStreamFailure('AGENT_UPSTREAM_ERROR')).toBe('agent_upstream');
    expect(classifyChatStreamFailure('UNKNOWN')).toBe('interrupted');
    expect(classifyChatStreamFailure(null)).toBe('interrupted');
  });

  it('classifies Agent task realtime connection states', () => {
    expect(classifyAgentTaskRealtimeFailure('connecting')).toBe('connecting');
    expect(classifyAgentTaskRealtimeFailure('reconnecting')).toBe('reconnecting');
    expect(classifyAgentTaskRealtimeFailure('disconnected')).toBe('disconnected');
    expect(classifyAgentTaskRealtimeFailure('error')).toBe('error');
    expect(classifyAgentTaskRealtimeFailure('error', 'SSE_TICKET_UNAVAILABLE')).toBe('ticket_unavailable');
    expect(classifyAgentTaskRealtimeFailure('error', 'SSE_TICKET_UNAUTHORIZED')).toBe('ticket_unauthorized');
    expect(classifyAgentTaskRealtimeFailure('error', 'SSE_TICKET_RATE_LIMITED')).toBe('ticket_rate_limited');
    expect(classifyAgentTaskRealtimeFailure('error', 'TASK_EVENTS_STREAM_UNAVAILABLE')).toBe('stream_unavailable');
    expect(classifyAgentTaskRealtimeFailure('error', 'TASK_EVENTS_STREAM_INTERRUPTED')).toBe('stream_interrupted');
    expect(classifyAgentTaskRealtimeFailure('error', 'TASK_EVENTS_RECOVERY_EXHAUSTED')).toBe('stream_recovery_exhausted');
    expect(classifyAgentTaskRealtimeFailure('error', 'SSE_TICKET_NETWORK_ERROR')).toBe('ticket_network');
    expect(classifyAgentTaskRealtimeFailure('error', 'TRACE_RECONCILE_FAILED')).toBe('reconcile_failed');
    expect(classifyAgentTaskRealtimeFailure('connected')).toBeNull();
  });

  it('classifies Agent task trace fetch failures', () => {
    expect(classifyAgentTaskTraceFailure(new ApiError('NOT_FOUND', 'Missing', 'req', 404))).toBe('trace_unavailable');
    expect(classifyAgentTaskTraceFailure(new ApiError('FORBIDDEN', 'Denied', 'req', 403))).toBe('trace_forbidden');
    expect(classifyAgentTaskTraceFailure(new ApiError('NETWORK_ERROR', 'Offline', 'req'))).toBe('trace_network');
    expect(classifyAgentTaskTraceFailure(new Error('Unknown'))).toBe('trace_failed');
  });
});
