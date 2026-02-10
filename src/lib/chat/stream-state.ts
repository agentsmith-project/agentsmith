import type { ChatSession } from '@/lib/api/types';

export type SessionStreamStatus = 'idle' | 'connecting' | 'streaming' | 'stopped' | 'error';

export interface SessionStreamingAssistant {
  messageId?: string | null;
  content: string;
  mode: 'append' | 'replace';
  startedAt: number;
  lastTokenAt: number;
}

export interface SessionStreamState {
  status: SessionStreamStatus;
  assistant: SessionStreamingAssistant | null;
}

export function mapRuntimeStatusToStreamStatus(
  runtimeStatus: ChatSession['runtime_status'] | undefined,
): SessionStreamStatus {
  if (runtimeStatus === 'running' || runtimeStatus === 'stopping') return 'streaming';
  if (runtimeStatus === 'failed') return 'error';
  if (runtimeStatus === 'stopped') return 'stopped';
  return 'idle';
}
