import type { ChatSession } from '@/lib/api/types';
import {
  mapExecutionStatusToStreamStatus,
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

export function buildChatViewModel(args: {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  sessions: ChatSession[];
  streamStateBySession: Record<string, SessionStreamState>;
}): ChatViewModel {
  const { currentSessionId, activeSession, sessions, streamStateBySession } = args;

  const activeStreamStatus: SessionStreamStatus = currentSessionId
    ? (() => {
        const localStatus = streamStateBySession[currentSessionId]?.status ?? 'idle';
        if (localStatus !== 'idle') return localStatus;
        return mapExecutionStatusToStreamStatus(activeSession?.execution_status);
      })()
    : 'idle';
  const activeStreamingAssistant = currentSessionId
    ? (streamStateBySession[currentSessionId]?.assistant ?? null)
    : null;
  const activeStreamErrorCode = currentSessionId
    ? (streamStateBySession[currentSessionId]?.errorCode ?? null)
    : null;
  const activeStreamErrorMessage = currentSessionId
    ? (streamStateBySession[currentSessionId]?.errorMessage ?? null)
    : null;
  const streamingSessionIds = Object.entries(streamStateBySession)
    .filter(([, state]) => state.status === 'connecting' || state.status === 'streaming')
    .map(([sessionId]) => sessionId);
  const runtimeStreamingSessionIds = sessions
    .filter((session) => session.execution_status === 'running' || session.execution_status === 'stopping')
    .map((session) => session.id);
  const mergedStreamingSessionIds = Array.from(new Set([...streamingSessionIds, ...runtimeStreamingSessionIds]));
  const disabled = activeStreamStatus === 'connecting' || activeStreamStatus === 'streaming';

  return {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorCode,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  };
}
