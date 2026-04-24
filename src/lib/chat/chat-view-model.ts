import type { ChatSession } from '@/lib/api/types';
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

function isLocalStreamActive(status: SessionStreamStatus): boolean {
  return status === 'connecting' || status === 'recovering' || status === 'streaming' || status === 'terminating';
}

function isSessionTerminating(session: ChatSession | null | undefined): boolean {
  if (!session) return false;
  const hasTerminalDebt = session.termination_state === 'terminating';
  if (hasTerminalDebt) return true;
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

  const activeStreamStatus: SessionStreamStatus = currentSessionId
    ? resolveActiveStreamStatus(activeLocalStatus, activeSession)
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
  const disabled = activeStreamStatus === 'stopping' || isLocalStreamActive(activeStreamStatus) || isExecutionActive(activeSession);

  return {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorCode,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  };
}
