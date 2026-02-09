export type ChatStreamStatus =
  | 'running'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'rejected';

export function logChatStreamEvent(input: {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId?: string;
  endpointId?: string;
  status: ChatStreamStatus;
  durationMs?: number;
  stopReason?: 'user_stop' | 'session_stop' | 'upstream_error' | 'timeout' | 'session_stream_conflict';
}): void {
  const payload: Record<string, unknown> = {
    event: 'chat_stream_lifecycle',
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    session_id: input.sessionId,
    stream_id: input.streamId,
    endpoint_id: input.endpointId,
    status: input.status,
    duration_ms: input.durationMs,
    stop_reason: input.stopReason,
    ts: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
