import { useCallback, useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  ChatAPI,
  StopSessionStreamResponse,
  StopStreamOptions,
  StopStreamResponse,
} from '@/lib/api/endpoints/chat';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { ApiError } from '@/lib/api/client';
import { resolveErrorMessageByCode } from '@/lib/api/errors';
import { getChatStreamAttach, postChatStream, streamSseJson } from '@/lib/chat/stream'; 
import { createThrottle } from '@/lib/chat/throttle';
import { chatMessagesKey, chatSessionsKey } from '@/lib/chat/query-keys';
import {
  CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
  CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
  isFinalChatExecutionStatus,
  type ChatStreamEscalationConfirmationResponseDetail,
  type SessionStreamState,
} from '@/lib/chat/stream-state';
import { useChatStreamStore } from '@/lib/chat/stream-store';
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
    streamErrorEmptyResponse: string;
    streamingFailed: string;
    stopRequiredBeforeReplaceFailed: string;
    stopFailedRetry: string;
    streamErrorAgentOffline: string;
    streamErrorAgentTimeout: string;
    streamErrorAgentProtocol: string;
    streamErrorAgentUpstream: string;
    streamWarningSessionWorkspaceRecreated: string;
    streamStopEscalationUnavailable?: string;
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
  stopStreamingSession: (
    sessionId: string,
    reason?: 'user' | 'replace',
    options?: StopStreamOptions,
  ) => Promise<boolean>;
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

export const CHAT_STOP_ESCALATION_PROMPT_DELAY_MS = 30_000;
const CHAT_STOP_ESCALATION_CONFIRM_TIMEOUT_MS = 5 * 60_000;

type ChatSessionEscalationTruth = ChatSession & {
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

type StopTarget =
  | { kind: 'session' }
  | { kind: 'stream'; streamId: string };

function getChatSessionEscalationReason(session: ChatSessionEscalationTruth): string | null {
  return typeof session.escalation_reason === 'string' && session.escalation_reason.trim()
    ? session.escalation_reason.trim()
    : null;
}

function isChatSessionTerminatingTruth(session: ChatSessionEscalationTruth): boolean {
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

function resolveStopResponseStatus(
  response: StopSessionStreamResponse | StopStreamResponse,
): 'stopping' | 'terminating' | null {
  if (response.state === 'not_found_or_finished' || response.status === 'not_found_or_finished') {
    return null;
  }
  if (response.stop_mode === 'terminate') return 'terminating';
  if (response.stop_mode === 'cancel') return 'stopping';
  const responseStatus = response.status ?? response.state;
  if (responseStatus === 'terminating') return 'terminating';
  if (responseStatus === 'stopping') return 'stopping';
  return null;
}

function requestChatStreamEscalationConfirmation(args: {
  sessionId: string;
  reason: string | null;
}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const requestId = `chat-stop-escalation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener(
        CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
        handleResponse,
      );
      resolve(confirmed);
    };
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<ChatStreamEscalationConfirmationResponseDetail>).detail;
      if (!detail || detail.requestId !== requestId) return;
      finish(detail.confirmed);
    };
    const timeoutId = window.setTimeout(
      () => finish(false),
      CHAT_STOP_ESCALATION_CONFIRM_TIMEOUT_MS,
    );
    window.addEventListener(
      CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
      handleResponse,
    );
    window.dispatchEvent(
      new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, {
        detail: {
          requestId,
          sessionId: args.sessionId,
          reason: args.reason,
        },
      }),
    );
  });
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
      CHAT_EMPTY_RESPONSE: messages.streamErrorEmptyResponse,
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

function mapStreamWarningMessage(
  warningCode: string | undefined,
  warningMessage: string | undefined,
  messages: UseChatStreamingArgs['messages'],
): string | null {
  if (warningCode === 'session.workspace_recreated') {
    return messages.streamWarningSessionWorkspaceRecreated;
  }
  if (typeof warningMessage === 'string' && warningMessage.trim().length > 0) {
    return warningMessage;
  }
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
  const stopEscalationTimersRef = useRef<Map<string, number>>(new Map());
  const stopTargetBySessionRef = useRef<Map<string, StopTarget>>(new Map());
  const stopRequestInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const stopEscalationPromptedRef = useRef<Set<string>>(new Set());
  const stopEscalationPromptInFlightRef = useRef<Set<string>>(new Set());
  const stopStreamingSessionRef = useRef<UseChatStreamingResult['stopStreamingSession'] | null>(null);
  const streamStateBySession = useChatStreamStore((s) => s.streamStateBySession);
  const streamIdBySession = useChatStreamStore((s) => s.streamIdBySession);
  const setStreamState = useChatStreamStore((s) => s.setStreamState);
  const clearStreamState = useChatStreamStore((s) => s.clearStreamState);
  const setStreamId = useChatStreamStore((s) => s.setStreamId);

  const setStreamIdForSession = useCallback((sessionId: string, streamIdValue: string | null) => {
    if (streamIdValue) {
      streamIdsRef.current.set(sessionId, streamIdValue);
      setStreamId(sessionId, streamIdValue);
      return;
    }
    streamIdsRef.current.delete(sessionId);
    setStreamId(sessionId, null);
  }, [setStreamId]);

  const clearStopEscalationState = useCallback((sessionId: string) => {
    const timer = stopEscalationTimersRef.current.get(sessionId);
    if (timer) {
      window.clearTimeout(timer);
      stopEscalationTimersRef.current.delete(sessionId);
    }
    stopTargetBySessionRef.current.delete(sessionId);
    stopEscalationPromptedRef.current.delete(sessionId);
    stopEscalationPromptInFlightRef.current.delete(sessionId);
  }, []);

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
      if (normalized.status !== 'stopping' && normalized.status !== 'terminating') {
        clearStopEscalationState(sessionId);
      }
      if ((normalized.status === 'stopped' || normalized.status === 'error') && !normalized.assistant) {
        const timer = window.setTimeout(() => {
          const currentState = useChatStreamStore.getState().streamStateBySession[sessionId];
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
        // Keep the stream state store minimal; remove idle empty states.
        const schedule = typeof queueMicrotask === 'function'
          ? queueMicrotask
          : (cb: () => void) => window.setTimeout(cb, 0);
        schedule(() => {
          const currentState = useChatStreamStore.getState().streamStateBySession[sessionId];
          if (currentState && currentState.status === 'idle' && !currentState.assistant) {
            clearStreamState(sessionId);
          }
        });
      }
      return normalized;
    });
  }, [clearStopEscalationState, clearStreamState, setStreamState]);

  const invalidateSessionTruth = useCallback((sessionId: string) => {
    queryClient.invalidateQueries({ queryKey: chatMessagesKey(workspaceId, projectId, sessionId) });
    queryClient.invalidateQueries({ queryKey: chatSessionsKey(workspaceId, projectId) });
  }, [projectId, queryClient, workspaceId]);

  const markSessionStopping = useCallback((sessionId: string) => {
    setSessionStreamState(sessionId, (prev) => ({
      status: 'stopping',
      assistant: prev.assistant ?? null,
    }));
  }, [setSessionStreamState]);

  useEffect(() => {
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    for (const [sessionId, state] of Object.entries(streamStateBySession)) {
      const session = sessionsById.get(sessionId);
      const stopInProgress = state.status === 'stopping' || state.status === 'terminating';
      if (!session) {
        if (!stopInProgress) {
          clearStopEscalationState(sessionId);
        }
      } else if (
        !isChatSessionTerminatingTruth(session) &&
        (
          session.execution_status === 'completed' ||
          session.execution_status === 'stopped' ||
          session.execution_status === 'failed'
        )
      ) {
        clearStopEscalationState(sessionId);
      }
      if (state.status !== 'stopped' && state.status !== 'error') continue;
      if (!session || session.execution_status === 'completed') {
        clearStreamState(sessionId);
      }
    }
    for (const session of sessions) {
      if (!isChatSessionTerminatingTruth(session) && isFinalChatExecutionStatus(session.execution_status)) {
        clearStopEscalationState(session.id);
      }
    }
  }, [clearStopEscalationState, clearStreamState, sessions, streamStateBySession]);

  useEffect(() => {
    if (!workspaceId || !projectId || sessions.length === 0) return;
    const candidates = sessions.filter(
      (session) =>
        (
          session.execution_status === 'running' ||
          session.execution_status === 'stopping' ||
          session.execution_status === 'terminating'
        ) &&
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
            const active = data.items.find((item) =>
              item.status === 'running' ||
              item.status === 'stopping' ||
              item.status === 'terminating'
            );
            if (active) {
              setStreamIdForSession(session.id, active.stream_id);
            }
          } catch {
            // Keep UI resilient when stream state is stale.
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
      if (session.execution_status !== 'running') return false;
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
              } else if (ev.event === 'warning') {
                const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
                const warningCode = data && typeof data.code === 'string' ? data.code : undefined;
                const warningMessage = data && typeof data.message === 'string' ? data.message : undefined;
                const mappedMessage = mapStreamWarningMessage(warningCode, warningMessage, messages);
                if (mappedMessage) {
                  toast.warning(mappedMessage);
                }
              } else if (ev.event === 'done') {
                break;
              }
            }

            throttler.flush();
            if (streamStillActive()) {
              setSessionStreamState(session.id, { status: 'idle', assistant: null });
            }
            invalidateSessionTruth(session.id);
          } catch (e: unknown) {
            if (controller.signal.aborted) {
              // Detaching shouldn't be treated as user stop; let execution_status drive indicators.
              if (streamStillActive()) {
                const currentState = useChatStreamStore.getState().streamStateBySession[session.id];
                if (currentState?.status === 'stopping') {
                  markSessionStopping(session.id);
                } else {
                  setSessionStreamState(session.id, { status: 'idle', assistant: null });
                }
              }
              return;
            }
            // Refresh/restore race: the stream may have finished between "list streams" and "attach".
            // In that case we silently fall back to refetching messages, instead of showing a scary error.
            if (e instanceof ApiError && e.errorCode === 'RESOURCE_NOT_FOUND') {
              setSessionStreamState(session.id, { status: 'idle', assistant: null });
              invalidateSessionTruth(session.id);
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
    messages.streamErrorEmptyResponse,
    messages.streamingFailed,
    patchStreamAssistantInCache,
    projectId,
    queryClient,
    sessions,
    token,
    upsertStreamAssistantToCache,
    workspaceId,
    chatAPI,
    invalidateSessionTruth,
    markSessionStopping,
    setSessionStreamState,
    setStreamIdForSession,
    streamIdBySession,
    messages,
  ]);

  const requestStop = async (
    sessionId: string,
    reason: 'user' | 'replace',
    options?: StopStreamOptions,
  ): Promise<boolean> => {
    const mode = options?.mode;
    const currentState = useChatStreamStore.getState().streamStateBySession[sessionId];
    const currentStreamId = streamIdsRef.current.get(sessionId) ?? streamIdBySession[sessionId] ?? null;
    const target = mode === 'terminate'
      ? (stopTargetBySessionRef.current.get(sessionId) ?? (currentStreamId ? { kind: 'stream' as const, streamId: currentStreamId } : { kind: 'session' as const }))
      : (currentStreamId ? { kind: 'stream' as const, streamId: currentStreamId } : { kind: 'session' as const });
    const controller = streamControllersRef.current.get(sessionId);

    let response: StopSessionStreamResponse | StopStreamResponse;
    try {
      if (target.kind === 'stream') {
        response = mode
          ? await chatAPI.stopStream(workspaceId, projectId, sessionId, target.streamId, options)
          : await chatAPI.stopStream(workspaceId, projectId, sessionId, target.streamId);
      } else {
        response = mode
          ? await chatAPI.stopSessionStream(workspaceId, projectId, sessionId, options)
          : await chatAPI.stopSessionStream(workspaceId, projectId, sessionId);
      }
    } catch {
      toast.error(reason === 'replace' ? messages.stopRequiredBeforeReplaceFailed : messages.stopFailedRetry);
      return false;
    }

    const nextStatus = resolveStopResponseStatus(response);
    invalidateSessionTruth(sessionId);
    if (nextStatus) {
      stopTargetBySessionRef.current.set(sessionId, target);
      setSessionStreamState(sessionId, {
        status: nextStatus,
        assistant: currentState?.assistant ?? null,
      });
      controller?.abort();
      if (target.kind === 'stream') {
        setStreamIdForSession(sessionId, null);
      }
      streamControllersRef.current.delete(sessionId);
      return reason !== 'replace' || nextStatus === 'terminating';
    }
    if (mode === 'terminate') {
      clearStopEscalationState(sessionId);
    }
    return true;
  };

  const scheduleStopEscalationCheck = useCallback((sessionId: string) => {
    if (stopEscalationTimersRef.current.has(sessionId)) return;
    if (stopEscalationPromptedRef.current.has(sessionId)) return;
    const timer = window.setTimeout(() => {
      stopEscalationTimersRef.current.delete(sessionId);
      if (stopEscalationPromptedRef.current.has(sessionId)) return;

      void (async () => {
        let session: ChatSessionEscalationTruth;
        try {
          session = await chatAPI.getSession(workspaceId, projectId, sessionId) as ChatSessionEscalationTruth;
        } catch {
          return;
        }
        if (isChatSessionTerminatingTruth(session)) {
          const current = useChatStreamStore.getState().streamStateBySession[sessionId];
          setSessionStreamState(sessionId, {
            status: 'terminating',
            assistant: current?.assistant ?? null,
          });
          clearStopEscalationState(sessionId);
          invalidateSessionTruth(sessionId);
          return;
        }
        if (session.execution_status !== 'stopping') {
          clearStopEscalationState(sessionId);
          invalidateSessionTruth(sessionId);
          return;
        }
        const reasonText = getChatSessionEscalationReason(session);
        stopEscalationPromptedRef.current.add(sessionId);
        if (session.can_escalate !== true) {
          const baseMessage =
            messages.streamStopEscalationUnavailable ??
            messages.stopFailedRetry;
          toast.info(reasonText ? `${baseMessage} ${reasonText}` : baseMessage);
          return;
        }
        if (stopEscalationPromptInFlightRef.current.has(sessionId)) return;
        stopEscalationPromptInFlightRef.current.add(sessionId);
        try {
          const confirmed = await requestChatStreamEscalationConfirmation({
            sessionId,
            reason: reasonText,
          });
          if (!confirmed) return;
          await stopStreamingSessionRef.current?.(sessionId, 'user', { mode: 'terminate' });
        } finally {
          stopEscalationPromptInFlightRef.current.delete(sessionId);
        }
      })();
    }, CHAT_STOP_ESCALATION_PROMPT_DELAY_MS);
    stopEscalationTimersRef.current.set(sessionId, timer);
  }, [
    chatAPI,
    clearStopEscalationState,
    invalidateSessionTruth,
    messages.stopFailedRetry,
    messages.streamStopEscalationUnavailable,
    projectId,
    setSessionStreamState,
    workspaceId,
  ]);

  const stopStreamingSession = async (
    sessionId: string,
    reason: 'user' | 'replace' = 'user',
    options?: StopStreamOptions,
  ): Promise<boolean> => {
    const mode = options?.mode;
    const currentState = useChatStreamStore.getState().streamStateBySession[sessionId];
    if (!mode && (currentState?.status === 'stopping' || currentState?.status === 'terminating')) {
      return false;
    }
    if (mode === 'terminate' && currentState?.status === 'terminating') {
      return false;
    }

    const requestKey = `${sessionId}:${mode ?? 'normal'}`;
    const inFlight = stopRequestInFlightRef.current.get(requestKey);
    if (inFlight) return inFlight;

    const request = requestStop(sessionId, reason, options)
      .then((accepted) => {
        if (accepted && reason === 'user' && !mode) {
          scheduleStopEscalationCheck(sessionId);
        }
        return accepted;
      })
      .finally(() => {
        stopRequestInFlightRef.current.delete(requestKey);
      });
    stopRequestInFlightRef.current.set(requestKey, request);
    return request;
  };
  stopStreamingSessionRef.current = stopStreamingSession;

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    for (const session of sessions) {
      if (session.execution_status !== 'stopping') continue;
      if (session.can_escalate !== true) continue;
      if (isChatSessionTerminatingTruth(session)) continue;
      scheduleStopEscalationCheck(session.id);
    }
  }, [projectId, scheduleStopEscalationCheck, sessions, workspaceId]);

  const stopStreaming = () => {
    if (!currentSessionId) return;
    void stopStreamingSession(currentSessionId, 'user');
  };

  useEffect(() => {
    const streamControllers = streamControllersRef.current;
    const streamIds = streamIdsRef.current;
    const cleanupTimers = streamCleanupTimersRef.current;
    const stopEscalationTimers = stopEscalationTimersRef.current;
    const stopRequests = stopRequestInFlightRef.current;
    const stopTargets = stopTargetBySessionRef.current;
    const stopPrompted = stopEscalationPromptedRef.current;
    const stopPromptInFlight = stopEscalationPromptInFlightRef.current;
    return () => {
      for (const controller of streamControllers.values()) {
        controller.abort();
      }
      for (const timer of cleanupTimers.values()) {
        window.clearTimeout(timer);
      }
      for (const timer of stopEscalationTimers.values()) {
        window.clearTimeout(timer);
      }
      streamControllers.clear();
      streamIds.clear();
      cleanupTimers.clear();
      stopEscalationTimers.clear();
      stopRequests.clear();
      stopTargets.clear();
      stopPrompted.clear();
      stopPromptInFlight.clear();
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
        } else if (ev.event === 'warning') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const warningCode = data && typeof data.code === 'string' ? data.code : undefined;
          const warningMessage = data && typeof data.message === 'string' ? data.message : undefined;
          const mappedMessage = mapStreamWarningMessage(warningCode, warningMessage, messages);
          if (mappedMessage) {
            toast.warning(mappedMessage);
          }
        } else if (ev.event === 'done') {
          break;
        }
      }

      if (content.length === 0) {
        throw new StreamUiError('CHAT_EMPTY_RESPONSE', messages.streamErrorEmptyResponse);
      }

      throttler.flush();
      if (streamStillActive()) {
        setSessionStreamState(runArgs.sessionId, { status: 'idle', assistant: null });
      }

      invalidateSessionTruth(runArgs.sessionId);
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        if (streamStillActive()) {
          const currentState = useChatStreamStore.getState().streamStateBySession[runArgs.sessionId];
          if (currentState?.status === 'stopping') {
            markSessionStopping(runArgs.sessionId);
          } else {
            setSessionStreamState(runArgs.sessionId, { status: 'stopped', assistant: null });
          }
        }
        invalidateSessionTruth(runArgs.sessionId);
        return;
      }
      const errorCode = mapStreamErrorCode(e);
      const errorMessage = mapStreamErrorMessage(e, messages);
      setSessionStreamState(runArgs.sessionId, { status: 'error', assistant: null, errorCode, errorMessage });
      toast.error(errorMessage);
      invalidateSessionTruth(runArgs.sessionId);
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
