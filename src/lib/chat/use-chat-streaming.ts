import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { getChatStreamAttach, postChatStream, streamSseJson } from '@/lib/chat/stream'; 
import { createThrottle } from '@/lib/chat/throttle';
import { chatMessagesKey, chatSessionsKey } from '@/lib/chat/query-keys';
import type { SessionStreamState } from '@/lib/chat/stream-state';
import { toast } from '@/components/ui/toast';

export interface RunChatStreamArgs {
  sessionId: string;
  model: string;
  endpointId: string;
  input?: { role: 'user'; content: string; attachments?: string[] };
  fromMessageId?: string;
  branchLeafMessageId?: string;
  mode?: 'append' | 'replace';
  displayMessageId?: string | null;
}

export interface UseChatStreamingArgs {
  token: string | null;
  workspaceId: string;
  projectId: string;
  sessions: ChatSession[];
  currentSessionId: string | null;
  chatAPI: ChatAPI;
  queryClient: QueryClient;
  messages: {
    streamError: string;
    streamingFailed: string;
    stopRequiredBeforeReplaceFailed: string;
    stopFailedRetry: string;
  };
  onReplaceStreamMeta?: (data: {
    variantGroupId?: string;
    variantIndex?: number;
  }) => void;
  upsertStreamAssistantToCache: (sessionId: string, message: ChatMessage) => void;
  patchStreamAssistantInCache: (
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'finish_reason' | 'tokens'>>,
  ) => void;
}

export interface UseChatStreamingResult {
  streamStateBySession: Record<string, SessionStreamState>;
  stopStreamingSession: (sessionId: string, reason?: 'user' | 'replace') => Promise<boolean>;
  stopStreaming: () => void;
  runStream: (args: RunChatStreamArgs) => Promise<void>;
}

export function useChatStreaming(args: UseChatStreamingArgs): UseChatStreamingResult {
  const {
    token,
    workspaceId,
    projectId,
    sessions,
    currentSessionId,
    chatAPI,
    queryClient,
    messages,
    onReplaceStreamMeta,
    upsertStreamAssistantToCache,
    patchStreamAssistantInCache,
  } = args;

  const streamControllersRef = useRef<Map<string, AbortController>>(new Map());
  const streamIdsRef = useRef<Map<string, string>>(new Map());
  const [streamIdBySession, setStreamIdBySession] = useState<Record<string, string>>({});
  const streamCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const [streamStateBySession, setStreamStateBySession] = useState<Record<string, SessionStreamState>>({});

  const setStreamIdForSession = (sessionId: string, streamId: string | null) => {
    if (streamId) {
      streamIdsRef.current.set(sessionId, streamId);
      setStreamIdBySession((prev) => (prev[sessionId] === streamId ? prev : { ...prev, [sessionId]: streamId }));
      return;
    }
    streamIdsRef.current.delete(sessionId);
    setStreamIdBySession((prev) => {
      if (!(sessionId in prev)) return prev;
      const { [sessionId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const setSessionStreamState = (
    sessionId: string,
    updater: SessionStreamState | ((prev: SessionStreamState) => SessionStreamState),
  ) => {
    setStreamStateBySession((prev) => {
      const current = prev[sessionId] ?? { status: 'idle', assistant: null };
      const next = typeof updater === 'function' ? updater(current) : updater;
      const cleanupTimers = streamCleanupTimersRef.current;
      const existingTimer = cleanupTimers.get(sessionId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        cleanupTimers.delete(sessionId);
      }
      if ((next.status === 'stopped' || next.status === 'error') && !next.assistant) {
        const timer = window.setTimeout(() => {
          setStreamStateBySession((statePrev) => {
            const currentState = statePrev[sessionId];
            if (!currentState) return statePrev;
            if (currentState.status === 'connecting' || currentState.status === 'streaming') {
              return statePrev;
            }
            const { [sessionId]: _removed, ...rest } = statePrev;
            return rest;
          });
          cleanupTimers.delete(sessionId);
        }, 60_000);
        cleanupTimers.set(sessionId, timer);
      }
      if (next.status === 'idle' && !next.assistant) {
        if (!prev[sessionId]) return prev;
        const { [sessionId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [sessionId]: next };
    });
  };

  useEffect(() => {
    if (!workspaceId || !projectId || sessions.length === 0) return;
    const candidates = sessions.filter(
      (session) =>
        (session.runtime_status === 'running' || session.runtime_status === 'stopping') &&
        !streamIdsRef.current.has(session.id),
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const recoverActiveStreamIds = async () => {
      await Promise.all(
        candidates.map(async (session) => {
          try {
            const data = await chatAPI.getSessionStreams(workspaceId, projectId, session.id);
            if (cancelled) return;
            const active = data.items.find((item) => item.status === 'running' || item.status === 'stopping');
            if (active) {
              setStreamIdForSession(session.id, active.stream_id);
            }
          } catch {
            // Keep UI resilient when runtime state is stale.
          }
        }),
      );
    };

    void recoverActiveStreamIds();
    return () => {
      cancelled = true;
    };
  }, [chatAPI, projectId, sessions, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projectId || sessions.length === 0) return;

    const candidates = sessions.filter((session) => {
      if (session.runtime_status !== 'running' && session.runtime_status !== 'stopping') return false;
      if (streamControllersRef.current.has(session.id)) return false;
      return typeof streamIdBySession[session.id] === 'string';
    });
    if (candidates.length === 0) return;

    let cancelled = false;
    const attachAll = async () => {
      await Promise.all(
        candidates.map(async (session) => {
          const streamId = streamIdBySession[session.id] ?? null;
          if (!streamId) return;
          if (cancelled) return;

          const controller = new AbortController();
          streamControllersRef.current.set(session.id, controller);
          const now = Date.now();
          setSessionStreamState(session.id, {
            status: 'connecting',
            assistant: {
              messageId: null,
              content: '',
              mode: 'append',
              startedAt: now,
              lastTokenAt: now,
            },
          });

          const throttler = createThrottle<string>(40, (next) => {
            setSessionStreamState(session.id, (prev) => ({
              status: prev.status === 'idle' ? 'streaming' : prev.status,
              assistant: prev.assistant
                ? { ...prev.assistant, content: next, lastTokenAt: Date.now() }
                : {
                    messageId: null,
                    content: next,
                    mode: 'append',
                    startedAt: Date.now(),
                    lastTokenAt: Date.now(),
                  },
            }));
          });

          const streamStillActive = () =>
            streamControllersRef.current.get(session.id) === controller;

          try {
            const res = await getChatStreamAttach({
              token,
              workspaceId,
              projectId,
              sessionId: session.id,
              streamId,
              signal: controller.signal,
            });

            setSessionStreamState(session.id, (prev) => ({
              ...prev,
              status: 'streaming',
            }));

            let content = '';
            for await (const ev of streamSseJson(res, controller.signal)) {
              if (controller.signal.aborted || !streamStillActive()) break;
              if (ev.event === 'meta') {
                const data = (typeof ev.data === 'object' && ev.data !== null
                  ? (ev.data as Record<string, unknown>)
                  : null);
                const metaStreamId = data && typeof data.stream_id === 'string'
                  ? data.stream_id
                  : null;
                if (metaStreamId) {
                  setStreamIdForSession(session.id, metaStreamId);
                }
                const metaMessageId = data && typeof data.assistant_message_id === 'string'
                  ? data.assistant_message_id
                  : null;
                if (metaMessageId) {
                  setSessionStreamState(session.id, (prev) => ({
                    status: prev.status === 'idle' ? 'streaming' : prev.status,
                    assistant: prev.assistant ? { ...prev.assistant, messageId: metaMessageId } : null,
                  }));
                }
              } else if (ev.event === 'delta') {
                const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
                const delta = data && typeof data.delta === 'string' ? data.delta : null;
                if (delta) {
                  content += delta;
                  throttler.push(content);
                }
              } else if (ev.event === 'error') {
                const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
                const message = data && typeof data.message === 'string' ? data.message : messages.streamError;
                throw new Error(message);
              } else if (ev.event === 'done') {
                break;
              }
            }

            throttler.flush();
            if (streamStillActive()) {
              setSessionStreamState(session.id, { status: 'idle', assistant: null });
            }
            queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, session.id) });
            queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
          } catch (e: unknown) {
            if (controller.signal.aborted) {
              // Detaching shouldn't be treated as user stop; let runtime_status drive indicators.
              if (streamStillActive()) {
                setSessionStreamState(session.id, { status: 'idle', assistant: null });
              }
              return;
            }
            setSessionStreamState(session.id, { status: 'error', assistant: null });
            toast.error(e instanceof Error ? e.message : messages.streamingFailed);
          } finally {
            if (streamControllersRef.current.get(session.id) === controller) {
              streamControllersRef.current.delete(session.id);
            }
            // When attach finishes, clear the cached stream id. If the stream is still active,
            // the sessions poll + recover effect will repopulate it.
            setStreamIdForSession(session.id, null);
          }
        }),
      );
    };

    void attachAll();
    return () => {
      cancelled = true;
    };
  }, [messages.streamError, messages.streamingFailed, projectId, queryClient, sessions, streamIdBySession, token, workspaceId, chatAPI]);

  const stopStreamingSession = async (
    sessionId: string,
    reason: 'user' | 'replace' = 'user',
  ): Promise<boolean> => {
    const streamId = streamIdsRef.current.get(sessionId) ?? streamIdBySession[sessionId] ?? null;
    const controller = streamControllersRef.current.get(sessionId);
    if (!streamId && !controller) {
      try {
        await chatAPI.stopSessionStream(workspaceId, projectId, sessionId);
      } catch {
        toast.error(reason === 'replace' ? messages.stopRequiredBeforeReplaceFailed : messages.stopFailedRetry);
        return false;
      }
      setSessionStreamState(sessionId, {
        status: reason === 'user' ? 'stopped' : 'idle',
        assistant: null,
      });
      return true;
    }

    if (streamId) {
      try {
        await chatAPI.stopStream(workspaceId, projectId, sessionId, streamId);
      } catch {
        toast.error(reason === 'replace' ? messages.stopRequiredBeforeReplaceFailed : messages.stopFailedRetry);
        return false;
      }
    }
    controller?.abort();
    setStreamIdForSession(sessionId, null);
    streamControllersRef.current.delete(sessionId);
    setSessionStreamState(sessionId, {
      status: reason === 'user' ? 'stopped' : 'idle',
      assistant: null,
    });
    return true;
  };

  const stopStreaming = () => {
    if (!currentSessionId) return;
    void stopStreamingSession(currentSessionId, 'user');
  };

  useEffect(() => {
    const streamControllers = streamControllersRef.current;
    const streamIds = streamIdsRef.current;
    const cleanupTimers = streamCleanupTimersRef.current;
    return () => {
      for (const controller of streamControllers.values()) {
        controller.abort();
      }
      for (const timer of cleanupTimers.values()) {
        window.clearTimeout(timer);
      }
      streamControllers.clear();
      streamIds.clear();
      cleanupTimers.clear();
    };
  }, []);

  const runStream = async (runArgs: RunChatStreamArgs): Promise<void> => {
    const previousStopped = await stopStreamingSession(runArgs.sessionId, 'replace');
    if (!previousStopped) {
      return;
    }

    const controller = new AbortController();
    streamControllersRef.current.set(runArgs.sessionId, controller);

    const mode = runArgs.mode ?? (runArgs.fromMessageId ? 'replace' : 'append');
    const now = Date.now();
    setSessionStreamState(runArgs.sessionId, {
      status: 'connecting',
      assistant: {
        messageId: runArgs.displayMessageId ?? null,
        content: '',
        mode,
        startedAt: now,
        lastTokenAt: now,
      },
    });

    const throttler = createThrottle<string>(40, (next) => {
      setSessionStreamState(runArgs.sessionId, (prev) => ({
        status: prev.status === 'idle' ? 'streaming' : prev.status,
        assistant: prev.assistant
          ? { ...prev.assistant, content: next, lastTokenAt: Date.now() }
          : {
              messageId: null,
              content: next,
              mode,
              startedAt: Date.now(),
              lastTokenAt: Date.now(),
            },
      }));
    });

    const setAssistantMessageId = (messageId: string) => {
      setSessionStreamState(runArgs.sessionId, (prev) => ({
        status: prev.status === 'idle' ? 'streaming' : prev.status,
        assistant: prev.assistant
          ? { ...prev.assistant, messageId }
          : {
              messageId,
              content: '',
              mode,
              startedAt: Date.now(),
              lastTokenAt: Date.now(),
            },
      }));
    };

    const streamStillActive = () =>
      streamControllersRef.current.get(runArgs.sessionId) === controller;

    try {
      const res = await postChatStream({
        token,
        workspaceId,
        projectId,
        sessionId: runArgs.sessionId,
        body: {
          model: runArgs.model,
          endpoint_id: runArgs.endpointId,
          branch_leaf_message_id: runArgs.branchLeafMessageId,
          from_message_id: runArgs.fromMessageId,
          input: runArgs.input,
        },
        signal: controller.signal,
      });
      const streamIdFromHeader = res.headers.get('x-chat-stream-id');
      if (streamIdFromHeader) {
        setStreamIdForSession(runArgs.sessionId, streamIdFromHeader);
      }
      setSessionStreamState(runArgs.sessionId, (prev) => ({
        ...prev,
        status: 'streaming',
      }));
      let content = '';
      let liveMessageId: string | null = mode === 'replace' ? runArgs.fromMessageId ?? null : null;

      for await (const ev of streamSseJson(res, controller.signal)) {
        if (controller.signal.aborted || !streamStillActive()) break;
        if (ev.event === 'meta') {
          const data = (typeof ev.data === 'object' && ev.data !== null
            ? (ev.data as Record<string, unknown>)
            : null);
          const metaStreamId = data && typeof data.stream_id === 'string'
            ? data.stream_id
            : null;
          if (metaStreamId) {
            setStreamIdForSession(runArgs.sessionId, metaStreamId);
          }
          const metaMessageId = data && typeof data.assistant_message_id === 'string'
            ? data.assistant_message_id
            : null;
          if (metaMessageId) {
            liveMessageId = metaMessageId;
            if (mode === 'replace') {
              const parentId = data && typeof data.parent_message_id === 'string'
                ? data.parent_message_id
                : null;
              const variantGroupId = data && typeof data.variant_group_id === 'string'
                ? data.variant_group_id
                : undefined;
              const variantIndex = data && typeof data.variant_index === 'number'
                ? data.variant_index
                : undefined;
              if (variantGroupId && typeof variantIndex === 'number') {
                onReplaceStreamMeta?.({ variantGroupId, variantIndex });
              }
              upsertStreamAssistantToCache(runArgs.sessionId, {
                id: metaMessageId,
                session_id: runArgs.sessionId,
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString(),
                finish_reason: null,
                parent_id: parentId,
                variant_group_id: variantGroupId,
                variant_index: variantIndex,
              });
            }
            setAssistantMessageId(metaMessageId);
          }
        } else if (ev.event === 'delta') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const delta = data && typeof data.delta === 'string' ? data.delta : null;
          if (delta) {
            content += delta;
            throttler.push(content);
            if (mode === 'replace' && liveMessageId) {
              patchStreamAssistantInCache(runArgs.sessionId, liveMessageId, {
                content,
                finish_reason: null,
              });
            }
          }
        } else if (ev.event === 'error') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const message = data && typeof data.message === 'string' ? data.message : messages.streamError;
          throw new Error(message);
        } else if (ev.event === 'done') {
          break;
        }
      }

      throttler.flush();
      if (streamStillActive()) {
        setSessionStreamState(runArgs.sessionId, { status: 'idle', assistant: null });
      }

      queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, runArgs.sessionId) });
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        if (streamStillActive()) {
          setSessionStreamState(runArgs.sessionId, { status: 'stopped', assistant: null });
        }
        queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, runArgs.sessionId) });
        queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
        return;
      }
      setSessionStreamState(runArgs.sessionId, { status: 'error', assistant: null });
      toast.error(e instanceof Error ? e.message : messages.streamingFailed);
      queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, runArgs.sessionId) });
      queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
    } finally {
      if (streamControllersRef.current.get(runArgs.sessionId) === controller) {
        streamControllersRef.current.delete(runArgs.sessionId);
      }
      setStreamIdForSession(runArgs.sessionId, null);
    }
  };

  return {
    streamStateBySession,
    stopStreamingSession,
    stopStreaming,
    runStream,
  };
}
