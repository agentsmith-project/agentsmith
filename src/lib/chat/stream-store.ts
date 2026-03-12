import { create } from 'zustand';
import type { SessionStreamState } from '@/lib/chat/stream-state';

interface ChatStreamStoreState {
  streamIdBySession: Record<string, string>;
  streamStateBySession: Record<string, SessionStreamState>;
  setStreamId: (sessionId: string, streamId: string | null) => void;
  setStreamState: (
    sessionId: string,
    next: SessionStreamState | ((prev: SessionStreamState) => SessionStreamState),
  ) => void;
  clearStreamState: (sessionId: string) => void;
}

export const useChatStreamStore = create<ChatStreamStoreState>((set) => ({
  streamIdBySession: {},
  streamStateBySession: {},
  setStreamId: (sessionId, streamId) => {
    set((state) => {
      if (streamId) {
        if (state.streamIdBySession[sessionId] === streamId) return state;
        return { streamIdBySession: { ...state.streamIdBySession, [sessionId]: streamId } };
      }
      if (!Object.prototype.hasOwnProperty.call(state.streamIdBySession, sessionId)) return state;
      const { [sessionId]: _removed, ...rest } = state.streamIdBySession;
      return { streamIdBySession: rest };
    });
  },
  setStreamState: (sessionId, next) => {
    set((state) => {
      const current = state.streamStateBySession[sessionId] ?? { status: 'idle', assistant: null };
      const resolved = typeof next === 'function' ? next(current) : next;
      return {
        streamStateBySession: {
          ...state.streamStateBySession,
          [sessionId]: resolved,
        },
      };
    });
  },
  clearStreamState: (sessionId) => {
    set((state) => {
      if (!Object.prototype.hasOwnProperty.call(state.streamStateBySession, sessionId)) {
        return state;
      }
      const { [sessionId]: _removed, ...rest } = state.streamStateBySession;
      return { streamStateBySession: rest };
    });
  },
}));
