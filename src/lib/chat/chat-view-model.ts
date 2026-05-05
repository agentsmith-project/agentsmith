import type { ChatMessage, ChatSession } from '@/lib/api/types';
import {
  isFinalChatExecutionStatus,
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

interface PersistedStreamErrorTruth {
  code: string | null;
  message: string | null;
}

function isLocalStreamActive(status: SessionStreamStatus): boolean {
  return status === 'connecting' || status === 'recovering' || status === 'streaming' || status === 'terminating';
}

function isSessionTerminating(session: ChatSession | null | undefined): boolean {
  if (!session) return false;
  if (isFinalChatExecutionStatus(session.execution_status)) return false;
  if (session.stop_mode === 'cancel') return false;
  return (
    session.execution_status === 'terminating' ||
    session.status === 'terminating' ||
    session.stop_mode === 'terminate'
  );
}

function isExecutionActive(session: ChatSession | null | undefined): boolean {
  if (!session) return false;
  return (
    session.execution_status === 'running' ||
    session.execution_status === 'stopping' ||
    session.execution_status === 'terminating' ||
    isSessionTerminating(session)
  );
}

function resolveActiveStreamStatus(
  localStatus: SessionStreamStatus,
  session: ChatSession | null | undefined,
  hasPersistedErrorTruth: boolean,
): SessionStreamStatus {
  const executionStatus = session?.execution_status;
  if (isSessionTerminating(session)) return 'terminating';
  if (localStatus === 'terminating' && !isFinalChatExecutionStatus(executionStatus)) return 'terminating';
  if (executionStatus === 'stopping') return 'stopping';
  if (localStatus === 'connecting' || localStatus === 'recovering') return localStatus;
  if (localStatus === 'stopping' && executionStatus !== 'completed' && executionStatus !== 'stopped' && executionStatus !== 'failed') {
    return 'stopping';
  }
  if (isExecutionActive(session)) return 'streaming';
  if (localStatus === 'streaming') return 'streaming';
  if (executionStatus === 'failed') return 'error';
  if (localStatus === 'error' || hasPersistedErrorTruth) return 'error';
  if (executionStatus === 'stopped') return 'stopped';
  if (executionStatus === 'completed') return 'idle';
  if (localStatus === 'stopped') return localStatus;
  return 'idle';
}

function resolvePersistedStreamError(messages: ChatMessage[]): PersistedStreamErrorTruth | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const errorCode = typeof message.error_code === 'string' && message.error_code.trim().length > 0
      ? message.error_code.trim()
      : null;
    const explicitErrorMessage = typeof message.error_message === 'string' && message.error_message.trim().length > 0
      ? message.error_message.trim()
      : null;
    const failedContentMessage = message.message_status === 'failed' && message.content.trim().length > 0
      ? message.content.trim()
      : null;
    const hasErrorTruth = message.message_status === 'failed' || errorCode !== null || explicitErrorMessage !== null;

    if (!hasErrorTruth) return null;

    return {
      code: errorCode,
      message: explicitErrorMessage ?? failedContentMessage,
    };
  }

  return null;
}

export function buildChatViewModel(args: {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  sessions: ChatSession[];
  messages: ChatMessage[];
  visibleMessages?: ChatMessage[];
  streamStateBySession: Record<string, SessionStreamState>;
}): ChatViewModel {
  const {
    currentSessionId,
    activeSession,
    sessions,
    messages,
    visibleMessages,
    streamStateBySession,
  } = args;
  const activeLocalState = currentSessionId ? (streamStateBySession[currentSessionId] ?? null) : null;
  const activeLocalStatus = activeLocalState?.status ?? 'idle';
  const persistedStreamError = resolvePersistedStreamError(visibleMessages ?? messages);

  const activeStreamStatus: SessionStreamStatus = currentSessionId
    ? resolveActiveStreamStatus(activeLocalStatus, activeSession, Boolean(persistedStreamError))
    : 'idle';
  const activeStreamingAssistant = currentSessionId
    ? (activeLocalState?.assistant ?? null)
    : null;
  const activeLocalError = currentSessionId && activeLocalStatus === 'error'
    ? {
        code: activeLocalState?.errorCode ?? null,
        message: activeLocalState?.errorMessage ?? null,
      }
    : null;
  const activeStreamErrorTruth = activeLocalError ?? persistedStreamError;
  const activeStreamErrorCode = activeStreamErrorTruth?.code ?? null;
  const activeStreamErrorMessage = activeStreamErrorTruth?.message ?? null;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const streamingSessionIds = Object.entries(streamStateBySession)
    .filter(([sessionId, state]) => {
      if (!isLocalStreamActive(state.status)) return false;
      const session = sessionsById.get(sessionId);
      return state.status !== 'terminating' || isSessionTerminating(session) || !isFinalChatExecutionStatus(session?.execution_status);
    })
    .map(([sessionId]) => sessionId);
  const executionStreamingSessionIds = sessions
    .filter((session) => isExecutionActive(session))
    .map((session) => session.id);
  const mergedStreamingSessionIds = Array.from(new Set([...streamingSessionIds, ...executionStreamingSessionIds]));
  const disabled =
    activeStreamStatus === 'stopping'
    || isLocalStreamActive(activeStreamStatus)
    || (activeStreamStatus !== 'error' && isExecutionActive(activeSession));

  return {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorCode,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  };
}
