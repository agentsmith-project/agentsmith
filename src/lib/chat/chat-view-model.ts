import type { ChatSession } from '@/lib/api/types';
import {
  type SessionStreamState,
  type SessionStreamStatus,
  type SessionStreamingAssistant,
} from '@/lib/chat/stream-state';

export interface ChatViewModel {
  activeStreamStatus: SessionStreamStatus;
  activeStreamingAssistant: SessionStreamingAssistant | null;
  activeStreamErrorCode: string | null;
  activeStreamErrorMessage: string | null;
  mergedStreamingSessionIds: string[];
  disabled: boolean;
}

function isLocalStreamActive(status: SessionStreamStatus): boolean {
  return status === 'connecting' || status === 'recovering' || status === 'streaming';
}

function isExecutionActive(status: ChatSession['execution_status'] | undefined): boolean {
  return status === 'running' || status === 'stopping';
}

function resolveActiveStreamStatus(
  localStatus: SessionStreamStatus,
  executionStatus: ChatSession['execution_status'] | undefined,
): SessionStreamStatus {
  if (executionStatus === 'stopping') return 'stopping';
  if (localStatus === 'connecting' || localStatus === 'recovering') return localStatus;
  if (localStatus === 'stopping' && executionStatus !== 'completed' && executionStatus !== 'stopped' && executionStatus !== 'failed') {
    return 'stopping';
  }
  if (isExecutionActive(executionStatus)) return 'streaming';
  if (localStatus === 'streaming') return 'streaming';
  if (executionStatus === 'failed') return 'error';
  if (executionStatus === 'stopped') return 'stopped';
  if (executionStatus === 'completed') return 'idle';
  if (localStatus === 'error' || localStatus === 'stopped') return localStatus;
  return 'idle';
}

export function buildChatViewModel(args: {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  sessions: ChatSession[];
  streamStateBySession: Record<string, SessionStreamState>;
}): ChatViewModel {
  const { currentSessionId, activeSession, sessions, streamStateBySession } = args;
  const activeLocalState = currentSessionId ? (streamStateBySession[currentSessionId] ?? null) : null;
  const activeLocalStatus = activeLocalState?.status ?? 'idle';
  const activeExecutionStatus = activeSession?.execution_status;

  const activeStreamStatus: SessionStreamStatus = currentSessionId
    ? resolveActiveStreamStatus(activeLocalStatus, activeExecutionStatus)
    : 'idle';
  const activeStreamingAssistant = currentSessionId
    ? (activeLocalState?.assistant ?? null)
    : null;
  const activeStreamErrorCode = currentSessionId && activeStreamStatus === 'error' && activeLocalStatus === 'error'
    ? (activeLocalState?.errorCode ?? null)
    : null;
  const activeStreamErrorMessage = currentSessionId && activeStreamStatus === 'error' && activeLocalStatus === 'error'
    ? (activeLocalState?.errorMessage ?? null)
    : null;
  const streamingSessionIds = Object.entries(streamStateBySession)
    .filter(([, state]) => isLocalStreamActive(state.status))
    .map(([sessionId]) => sessionId);
  const executionStreamingSessionIds = sessions
    .filter((session) => isExecutionActive(session.execution_status))
    .map((session) => session.id);
  const mergedStreamingSessionIds = Array.from(new Set([...streamingSessionIds, ...executionStreamingSessionIds]));
  const disabled = activeLocalStatus === 'stopping' || isLocalStreamActive(activeLocalStatus) || isExecutionActive(activeExecutionStatus);

  return {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorCode,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  };
}
