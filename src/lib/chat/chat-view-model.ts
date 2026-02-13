import type { ChatSession } from '@/lib/api/types';
import {
  mapRuntimeStatusToStreamStatus,
  type SessionStreamState,
  type SessionStreamStatus,
  type SessionStreamingAssistant,
} from '@/lib/chat/stream-state';

export interface ChatViewModel {
  activeStreamStatus: SessionStreamStatus;
  activeStreamingAssistant: SessionStreamingAssistant | null;
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
        return mapRuntimeStatusToStreamStatus(activeSession?.runtime_status);
      })()
    : 'idle';
  const activeStreamingAssistant = currentSessionId
    ? (streamStateBySession[currentSessionId]?.assistant ?? null)
    : null;
  const activeStreamErrorMessage = currentSessionId
    ? (streamStateBySession[currentSessionId]?.errorMessage ?? null)
    : null;
  const streamingSessionIds = Object.entries(streamStateBySession)
    .filter(([, state]) => state.status === 'connecting' || state.status === 'streaming')
    .map(([sessionId]) => sessionId);
  const runtimeStreamingSessionIds = sessions
    .filter((session) => session.runtime_status === 'running' || session.runtime_status === 'stopping')
    .map((session) => session.id);
  const mergedStreamingSessionIds = Array.from(new Set([...streamingSessionIds, ...runtimeStreamingSessionIds]));
  const disabled = activeStreamStatus === 'connecting' || activeStreamStatus === 'streaming';

  return {
    activeStreamStatus,
    activeStreamingAssistant,
    activeStreamErrorMessage,
    mergedStreamingSessionIds,
    disabled,
  };
}
