import type { ChatSession } from '@/lib/api/types';

export type SessionStreamStatus =
  | 'idle'
  | 'connecting'
  | 'recovering'
  | 'streaming'
  | 'stopping'
  | 'terminating'
  | 'stopped'
  | 'error';

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

export const CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT =
  'agentsmith:chat-stream-escalation-request';
export const CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT =
  'agentsmith:chat-stream-escalation-response';

export interface ChatStreamEscalationConfirmationRequestDetail {
  requestId: string;
  sessionId: string;
  reason?: string | null;
}

export interface ChatStreamEscalationConfirmationResponseDetail {
  requestId: string;
  confirmed: boolean;
}

export function mapExecutionStatusToStreamStatus(
  executionStatus: ChatSession['execution_status'] | undefined,
): SessionStreamStatus {
  if (executionStatus === 'running') return 'streaming';
  if (executionStatus === 'stopping') return 'stopping';
  if (executionStatus === 'terminating') return 'terminating';
  if (executionStatus === 'failed') return 'error';
  if (executionStatus === 'stopped') return 'stopped';
  return 'idle';
}

export function isFinalChatExecutionStatus(
  executionStatus: ChatSession['execution_status'] | undefined,
): boolean {
  return executionStatus === 'completed' || executionStatus === 'stopped' || executionStatus === 'failed';
}
