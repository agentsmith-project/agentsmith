import type { ChatSession } from '@/lib/api/types';
import type { SessionStreamStatus } from '@/lib/chat/stream-state';

export type ChatComposerState =
  | 'no_thread'
  | 'need_endpoint'
  | 'editing'
  | 'streaming'
  | 'pending'
  | 'error_recoverable'
  | 'ready';

export interface ChatComposerStateInput {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  editingMessageId: string | null;
  streamStatus: SessionStreamStatus;
  createMessagePending: boolean;
  editMessagePending: boolean;
  initAttachmentPending: boolean;
}

export function hasEndpointBinding(session: ChatSession | null): boolean {
  if (!session) return false;
  return session.endpoint_id.trim().length > 0 && session.model.trim().length > 0;
}

export function deriveChatComposerState(input: ChatComposerStateInput): ChatComposerState {
  if (!input.currentSessionId || !input.activeSession) return 'no_thread';
  if (!hasEndpointBinding(input.activeSession)) return 'need_endpoint';
  if (input.editingMessageId) return 'editing';
  if (input.streamStatus === 'connecting' || input.streamStatus === 'streaming') return 'streaming';
  if (input.createMessagePending || input.editMessagePending || input.initAttachmentPending) return 'pending';
  if (input.streamStatus === 'error') return 'error_recoverable';
  return 'ready';
}
