import { useCallback, useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { ApiError } from '@/lib/api/client';
import { resolveErrorMessageByCode } from '@/lib/api/errors';
import { getChatStreamAttach, postChatStream, streamSseJson } from '@/lib/chat/stream'; 
import { createThrottle } from '@/lib/chat/throttle';
import { chatMessagesKey, chatSessionsKey } from '@/lib/chat/query-keys';
import type { SessionStreamState } from '@/lib/chat/stream-state';
import { useChatRuntimeStore } from '@/lib/chat/runtime-store';
import { toast } from '@/components/ui/toast';
import type { ChatMessageInputRef } from '@/lib/types/input-ref';

export interface RunChatStreamArgs {
  sessionId: string;
  model: string;
  endpointId: string;
  input?: { role: 'user'; content: string; inputs?: ChatMessageInputRef[] };
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
    streamErrorAgentOffline: string;
    streamErrorAgentTimeout: string;
    streamErrorAgentProtocol: string;
    streamErrorAgentUpstream: string;
  };
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

class StreamUiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StreamUiError';
    this.code = code;
  }
}

function mapStreamErrorMessage(error: unknown, messages: UseChatStreamingArgs['messages']): string {
  const code = (() => {
    if (error instanceof StreamUiError) return error.code;
    if (error instanceof ApiError) return error.errorCode;
    return '';
  })();
  const mapped = resolveErrorMessageByCode(
    code,
    {
      AGENT_TIMEOUT: messages.streamErrorAgentTimeout,
      AGENT_PROTOCOL_ERROR: messages.streamErrorAgentProtocol,
      AGENT_UPSTREAM_ERROR: messages.streamErrorAgentUpstream,
      AGENT_OFFLINE: messages.streamErrorAgentOffline,
    },
    '',
  );
  if (mapped) return mapped;
  if (error instanceof Error) return error.message;
  return messages.streamingFailed;
}

function mapStreamErrorCode(error: unknown): string | null {
  if (error instanceof StreamUiError) return error.code;
  if (error instanceof ApiError) return error.errorCode ?? null;
  return null;
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
    upsertStreamAssistantToCache,
    patchStreamAssistantInCache,
  } = args;

  const streamControllersRef = useRef<Map<string, AbortController>>(new Map());
  const streamIdsRef = useRef<Map<string, string>>(new Map());
  const streamCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const streamStateBySession = useChatRuntimeStore((s) => s.streamStateBySession);
  const streamIdBySession = useChatRuntimeStore((s) => s.streamIdBySession);
  const setStreamState = useChatRuntimeStore((s) => s.setStreamState);
  const clearStreamState = useChatRuntimeStore((s) => s.clearStreamState);
  const setStreamId = useChatRuntimeStore((s) => s.setStreamId);

  const setStreamIdForSession = useCallback((sessionId: string, streamIdValue: string | null) => {
    if (streamIdValue) {
      streamIdsRef.current.set(sessionId, streamIdValue);
      setStreamId(sessionId, streamIdValue);
      return;
    }
    streamIdsRef.current.delete(sessionId);
    setStreamId(sessionId, null);
  }, [setStreamId]);

  const setSessionStreamState = useCallback((
    sessionId: string,
    updater: SessionStreamState | ((prev: SessionStreamState) => SessionStreamState),
  ) => {
    const cleanupTimers = streamCleanupTimersRef.current;
    const existingTimer = cleanupTimers.get(sessionId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      cleanupTimers.delete(sessionId);
    }

    setStreamState(sessionId, (prev) => {
      const next = typeof updater === 'function'
        ? (updater as (p: SessionStreamState) => SessionStreamState)(prev)
        : updater;
      const normalized: SessionStreamState = next.status === 'error'
        ? next
        : { ...next, errorCode: null, errorMessage: null };
      if ((normalized.status === 'stopped' || normalized.status === 'error') && !normalized.assistant) {
        const timer = window.setTimeout(() => {
          const currentState = useChatRuntimeStore.getState().streamStateBySession[sessionId];
          if (!currentState) return;
          if (
            currentState.status === 'connecting' ||
            currentState.status === 'streaming' ||
            currentState.status === 'recovering'
          ) return;
          clearStreamState(sessionId);
          cleanupTimers.delete(sessionId);
        }, 60_000);
        cleanupTimers.set(sessionId, timer);
      }
      if (normalized.status === 'idle' && !normalized.assistant) {
        // Keep the runtime store minimal; remove idle empty states.
        const schedule = typeof queueMicrotask === 'function'
          ? queueMicrotask
          : (cb: () => void) => window.setTimeout(cb, 0);
        schedule(() => {
          const currentState = useChatRuntimeStore.getState().streamStateBySession[sessionId];
          if (currentState && currentState.status === 'idle' && !currentState.assistant) {
            clearStreamState(sessionId);
          }
        });
      }
      return normalized;
    });
  }, [clearStreamState, setStreamState]);

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
  }, [chatAPI, projectId, sessions, setStreamIdForSession, workspaceId]);

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
            status: 'recovering',
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
            let liveMessageId: string | null = null;
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
                  liveMessageId = metaMessageId;
                  setSessionStreamState(session.id, (prev) => ({
                    status: prev.status === 'idle' ? 'streaming' : prev.status,
                    assistant: prev.assistant ? { ...prev.assistant, messageId: metaMessageId } : null,
                  }));
                  // Ensure message bubble exists even if the messages query hasn't refetched yet.
                  upsertStreamAssistantToCache(session.id, {
                    id: metaMessageId,
                    session_id: session.id,
                    role: 'assistant',
                    content: '',
                    created_at: new Date().toISOString(),
                    finish_reason: null,
                  });
                  const variantGroupId = data && typeof data.variant_group_id === 'string'
                    ? data.variant_group_id
                    : undefined;
                  const variantIndex = data && typeof data.variant_index === 'number'
                    ? data.variant_index
                    : undefined;
                  if (variantGroupId && typeof variantIndex === 'number') {
                    setSessionStreamState(session.id, (prev) => ({
                      status: prev.status,
                      assistant: prev.assistant ? { ...prev.assistant, variantGroupId, variantIndex } : prev.assistant,
                    }));
                  }
                }
              } else if (ev.event === 'delta') {
                const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
                const delta = data && typeof data.delta === 'string' ? data.delta : null;
                if (delta) {
                  content += delta;
                  throttler.push(content);
                  if (liveMessageId) {
                    patchStreamAssistantInCache(session.id, liveMessageId, { content, finish_reason: null });
                  }
                }
              } else if (ev.event === 'error') {
                const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
                const code = data && typeof data.error_code === 'string' ? data.error_code : 'CHAT_STREAM_ERROR';
                const message = data && typeof data.message === 'string' ? data.message : messages.streamError;
                throw new StreamUiError(code, message);
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
            // Refresh/restore race: the stream may have finished between "list streams" and "attach".
            // In that case we silently fall back to refetching messages, instead of showing a scary error.
            if (e instanceof ApiError && e.errorCode === 'RESOURCE_NOT_FOUND') {
              setSessionStreamState(session.id, { status: 'idle', assistant: null });
              queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, session.id) });
              queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
              return;
            }
            const errorCode = mapStreamErrorCode(e);
            const errorMessage = mapStreamErrorMessage(e, messages);
            setSessionStreamState(session.id, { status: 'error', assistant: null, errorCode, errorMessage });
            toast.error(errorMessage);
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
  }, [
    messages.streamErrorAgentOffline,
    messages.streamErrorAgentProtocol,
    messages.streamErrorAgentTimeout,
    messages.streamErrorAgentUpstream,
    messages.streamError,
    messages.streamingFailed,
    patchStreamAssistantInCache,
    projectId,
    queryClient,
    sessions,
    token,
    upsertStreamAssistantToCache,
    workspaceId,
    chatAPI,
    setSessionStreamState,
    setStreamIdForSession,
    streamIdBySession,
    messages,
  ]);

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
    const mode = runArgs.mode ?? (runArgs.fromMessageId ? 'replace' : 'append');
    if (mode === 'replace') {
      const previousStopped = await stopStreamingSession(runArgs.sessionId, 'replace');
      if (!previousStopped) {
        return;
      }
    }

    const controller = new AbortController();
    streamControllersRef.current.set(runArgs.sessionId, controller);

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
            setSessionStreamState(runArgs.sessionId, (prev) => ({
              status: prev.status,
              assistant: prev.assistant ? { ...prev.assistant, variantGroupId, variantIndex } : prev.assistant,
            }));
          }
          // Always render streaming output by updating a single assistant message in the list.
          // This prevents duplicated "footer bubble" after refresh when the backend has already persisted the message.
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
            setAssistantMessageId(metaMessageId);
          }
        } else if (ev.event === 'delta') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const delta = data && typeof data.delta === 'string' ? data.delta : null;
          if (delta) {
            content += delta;
            throttler.push(content);
            if (liveMessageId) {
              patchStreamAssistantInCache(runArgs.sessionId, liveMessageId, {
                content,
                finish_reason: null,
              });
            }
          }
        } else if (ev.event === 'error') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const code = data && typeof data.error_code === 'string' ? data.error_code : 'CHAT_STREAM_ERROR';
          const message = data && typeof data.message === 'string' ? data.message : messages.streamError;
          throw new StreamUiError(code, message);
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
      const errorCode = mapStreamErrorCode(e);
      const errorMessage = mapStreamErrorMessage(e, messages);
      setSessionStreamState(runArgs.sessionId, { status: 'error', assistant: null, errorCode, errorMessage });
      toast.error(errorMessage);
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
