import type { ChatSession } from '@/lib/api/types';

export type SessionStreamStatus = 'idle' | 'connecting' | 'recovering' | 'streaming' | 'stopped' | 'error';

export interface SessionStreamingAssistant {
  messageId?: string | null;
  content: string;
  mode: 'append' | 'replace';
  startedAt: number;
  lastTokenAt: number;
  variantGroupId?: string;
  variantIndex?: number;
}

export interface SessionStreamState {
  status: SessionStreamStatus;
  assistant: SessionStreamingAssistant | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function mapExecutionStatusToStreamStatus(
  executionStatus: ChatSession['execution_status'] | undefined,
): SessionStreamStatus {
  if (executionStatus === 'running' || executionStatus === 'stopping') return 'streaming';
  if (executionStatus === 'failed') return 'error';
  if (executionStatus === 'stopped') return 'stopped';
  return 'idle';
}
