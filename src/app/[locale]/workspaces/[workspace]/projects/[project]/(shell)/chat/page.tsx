/**
 * Chat Page (v1)
 *
 * Two-pane layout:
 * - Left: Threads list
 * - Right: Chat window (header + messages + composer)
 *
 * Style must follow `文档/UXUI/2026-01-31-视觉设计系统-v1.md`.
 */

'use client';

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api';
import { ChatAPI } from '@/lib/api/endpoints/chat';
import { EndpointAPI } from '@/lib/api/endpoints/endpoints';
import type { Attachment, ChatMessage, ChatSession, Endpoint } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain, getGroupIdForMessageId } from '@/lib/chat/branch';
import { postChatStream, streamSseJson } from '@/lib/chat/stream';
import { createThrottle } from '@/lib/chat/throttle';

import { toast } from '@/components/ui/toast';
import { ThreadsPane } from '@/components/chat/ThreadsPane';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { Markdown } from '@/components/chat/Markdown';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
 

interface ChatPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

type SessionStreamStatus = 'idle' | 'connecting' | 'streaming' | 'stopped' | 'error';

interface SessionStreamingAssistant {
  messageId?: string | null;
  content: string;
  mode: 'append' | 'replace';
  startedAt: number;
  lastTokenAt: number;
}

interface SessionStreamState {
  status: SessionStreamStatus;
  assistant: SessionStreamingAssistant | null;
}

function createClientStreamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stream_${crypto.randomUUID()}`;
  }
  return `stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function ChatPage({ params }: ChatPageProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('chat');
  const tErrors = useTranslations('errors');

  const token = useAuthStore((s) => s.token);
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string } | null>(null);
  const canAccessChat = useHasPermission('project:chat:access');
  const canReadThreads = canAccessChat;
  const canUseChat = canAccessChat;
  const canManageChatSessions = canAccessChat;

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composerBySession, setComposerBySession] = useState<Record<string, string>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [activeVariantIndexByGroup, setActiveVariantIndexByGroup] = useState<Record<string, number>>({});
  const lastVariantTailRef = useRef<Map<string, string>>(new Map());
  const manualVariantGroupsRef = useRef<Set<string>>(new Set());
  const pendingAutoGroupRef = useRef<string | null>(null);
  const [suppressAutoScroll, setSuppressAutoScroll] = useState(false);
  const [deleteThreadDialogOpen, setDeleteThreadDialogOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<{ id: string; title?: string } | null>(null);
  const suppressTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamControllersRef = useRef<Map<string, AbortController>>(new Map());
  const streamIdsRef = useRef<Map<string, string>>(new Map());
  const [streamStateBySession, setStreamStateBySession] = useState<Record<string, SessionStreamState>>({});

  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const apiClient = useMemo(() => getApiClient(), []);
  const chatAPI = useMemo(() => new ChatAPI(apiClient), [apiClient]);
  const endpointAPI = useMemo(() => new EndpointAPI(apiClient), [apiClient]);

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['chat', 'sessions', workspaceId, projectId],
    queryFn: () => chatAPI.getSessions(workspaceId, projectId, { page: 1, page_size: 1000 }),
    enabled: !!workspaceId && !!projectId && canReadThreads,
  });

  const sessions = useMemo(() => sessionsData?.items ?? [], [sessionsData]);

  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [currentSessionId, sessions]);

  const activeSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  const { data: endpointsData } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId, { page: 1, page_size: 500 }),
    enabled: !!workspaceId && !!projectId && canReadThreads,
  });

  const endpoints = endpointsData?.items ?? [];

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['chat', 'messages', workspaceId, projectId, currentSessionId],
    queryFn: () => {
      if (!currentSessionId) return { items: [], total: 0, page: 1, page_size: 500, has_more: false };
      return chatAPI.getMessages(workspaceId, projectId, currentSessionId, { page: 1, page_size: 500 });
    },
    enabled: !!currentSessionId && !!workspaceId && !!projectId && canReadThreads,
  });

  const messages = useMemo(() => messagesData?.items ?? [], [messagesData?.items]);

  const visibleLeafId = useMemo(() => {
    if (messages.length === 0) return null;
    const groups = buildVariantGroups(messages);
    const { chain } = buildVisibleChain(messages, groups, activeVariantIndexByGroup);
    const last = chain[chain.length - 1];
    return last?.id ?? null;
  }, [messages, activeVariantIndexByGroup]);

  useEffect(() => {
    manualVariantGroupsRef.current.clear();
    pendingAutoGroupRef.current = null;
    lastVariantTailRef.current = new Map();
    setSuppressAutoScroll(false);
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    const status = currentSessionId ? (streamStateBySession[currentSessionId]?.status ?? 'idle') : 'idle';
    if (status !== 'idle') return;
    const groups = buildVariantGroups(messages);
    const nextMap = new Map(lastVariantTailRef.current);
    const updates: Record<string, number> = {};

    for (const [groupId, group] of groups.groups.entries()) {
      if (group.items.length === 0) continue;
      const last = group.items[group.items.length - 1];
      const lastId = last.id;
      const prevId = lastVariantTailRef.current.get(groupId);
      nextMap.set(groupId, lastId);

      const shouldAuto =
        pendingAutoGroupRef.current === groupId ||
        !manualVariantGroupsRef.current.has(groupId);

      if (
        shouldAuto &&
        (!Object.prototype.hasOwnProperty.call(activeVariantIndexByGroup, groupId) || (prevId && prevId !== lastId))
      ) {
        const idx = last.variant_index ?? last.revision_index ?? group.items.length - 1;
        updates[groupId] = idx;
      }
    }

    if (Object.keys(updates).length > 0) {
      setActiveVariantIndexByGroup((prev) => ({ ...prev, ...updates }));
    }
    if (pendingAutoGroupRef.current) pendingAutoGroupRef.current = null;
    lastVariantTailRef.current = nextMap;
  }, [messages, activeVariantIndexByGroup, currentSessionId, streamStateBySession]);

  const { data: attachmentsData } = useQuery({
    queryKey: ['chat', 'attachments', workspaceId, projectId, currentSessionId],
    queryFn: () => {
      if (!currentSessionId) return { items: [], total: 0 };
      return chatAPI.getAttachments(workspaceId, projectId, currentSessionId);
    },
    enabled: !!currentSessionId && !!workspaceId && !!projectId && canReadThreads,
    refetchInterval: (query) => {
      const data = query.state.data as { items: Attachment[]; total: number } | undefined;
      const items = data?.items ?? [];
      return items.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing') ? 2000 : false;
    },
  });

  const attachments = attachmentsData?.items ?? [];

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const firstActive = endpoints.find((e) => e.status === 'active') || null;
      return chatAPI.createSession(
        workspaceId,
        projectId,
        firstActive ? { endpoint_id: firstActive.id, model: firstActive.openai_model } : {},
      );
    },
    onSuccess: (data: ChatSession) => {
      setCurrentSessionId(data.id);
      setSearchQuery('');
      setEditingMessageId(null);
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async (args: {
      sessionId: string;
      data: Partial<Pick<ChatSession, 'title' | 'model' | 'endpoint_id' | 'pinned' | 'starred'>>;
    }) => chatAPI.updateSession(workspaceId, projectId, args.sessionId, args.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => chatAPI.deleteSession(workspaceId, projectId, sessionId),
    onSuccess: (_data, sessionId) => {
      if (currentSessionId === sessionId) setCurrentSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', workspaceId, projectId, sessionId] });
    },
  });

  const createMessageMutation = useMutation({
    mutationFn: async (args: { sessionId: string; content: string; attachments?: string[]; parent_id?: string | null }) =>
      chatAPI.createMessage(workspaceId, projectId, args.sessionId, {
        role: 'user',
        content: args.content,
        attachments: args.attachments,
        parent_id: args.parent_id ?? null,
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', workspaceId, projectId, vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async (args: { sessionId: string; messageId: string; content: string }) =>
      chatAPI.editMessage(workspaceId, projectId, args.sessionId, args.messageId, { content: args.content }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', workspaceId, projectId, vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
    },
  });

  const initAttachmentMutation = useMutation({
    mutationFn: async (args: { sessionId: string; file: File }) => {
      const res = await chatAPI.initAttachment(workspaceId, projectId, args.sessionId, {
        file_name: args.file.name,
        file_type: args.file.type || 'application/octet-stream',
        file_size: args.file.size,
      });
      return { ...res, sessionId: args.sessionId, file: args.file };
    },
    onSuccess: async ({ attachment, upload_url, sessionId, file }) => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'attachments', workspaceId, projectId, sessionId] });
      if (!upload_url) return;
      try {
        const put = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await chatAPI.completeAttachment(workspaceId, projectId, sessionId, attachment.id, {});
        queryClient.invalidateQueries({ queryKey: ['chat', 'attachments', workspaceId, projectId, sessionId] });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Upload failed');
      }
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (args: { sessionId: string; attachmentId: string }) =>
      chatAPI.deleteAttachment(workspaceId, projectId, args.sessionId, args.attachmentId),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: ['chat', 'attachments', workspaceId, projectId, vars.sessionId] }),
  });

  const retryAttachmentMutation = useMutation({
    mutationFn: async (args: { sessionId: string; attachmentId: string }) =>
      chatAPI.retryAttachment(workspaceId, projectId, args.sessionId, args.attachmentId),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: ['chat', 'attachments', workspaceId, projectId, vars.sessionId] }),
  });

  const upsertStreamAssistantToCache = (sessionId: string, message: ChatMessage) => {
    queryClient.setQueryData(
      ['chat', 'messages', workspaceId, projectId, sessionId],
      (
        prev:
          | {
              items: ChatMessage[];
              total: number;
              page: number;
              page_size: number;
              has_more: boolean;
            }
          | undefined,
      ) => {
        if (!prev) return prev;
        const index = prev.items.findIndex((item) => item.id === message.id);
        if (index >= 0) {
          const nextItems = [...prev.items];
          nextItems[index] = { ...nextItems[index], ...message };
          return { ...prev, items: nextItems };
        }
        return {
          ...prev,
          items: [...prev.items, message],
          total: prev.total + 1,
        };
      },
    );
  };

  const patchStreamAssistantInCache = (
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'finish_reason' | 'tokens'>>,
  ) => {
    queryClient.setQueryData(
      ['chat', 'messages', workspaceId, projectId, sessionId],
      (
        prev:
          | {
              items: ChatMessage[];
              total: number;
              page: number;
              page_size: number;
              has_more: boolean;
            }
          | undefined,
      ) => {
        if (!prev) return prev;
        const index = prev.items.findIndex((item) => item.id === messageId);
        if (index < 0) return prev;
        const nextItems = [...prev.items];
        nextItems[index] = {
          ...nextItems[index],
          ...patch,
        };
        return { ...prev, items: nextItems };
      },
    );
  };

  const setSessionStreamState = (
    sessionId: string,
    updater: SessionStreamState | ((prev: SessionStreamState) => SessionStreamState),
  ) => {
    setStreamStateBySession((prev) => {
      const current = prev[sessionId] ?? { status: 'idle' as SessionStreamStatus, assistant: null };
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next.status === 'idle' && !next.assistant) {
        if (!prev[sessionId]) return prev;
        const { [sessionId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [sessionId]: next };
    });
  };

  const stopStreamingSession = async (sessionId: string, reason: 'user' | 'replace' = 'user') => {
    const streamId = streamIdsRef.current.get(sessionId);
    const controller = streamControllersRef.current.get(sessionId);
    if (!streamId && !controller) return;

    if (streamId) {
      try {
        await chatAPI.stopStream(workspaceId, projectId, sessionId, streamId);
      } catch {
        // Keep local abort as authoritative UX action.
      }
    }
    controller?.abort();
    streamIdsRef.current.delete(sessionId);
    streamControllersRef.current.delete(sessionId);
    setSessionStreamState(sessionId, {
      status: reason === 'user' ? 'stopped' : 'idle',
      assistant: null,
    });
  };

  const stopStreaming = () => {
    if (!currentSessionId) return;
    void stopStreamingSession(currentSessionId, 'user');
  };

  useEffect(() => {
    const streamControllers = streamControllersRef.current;
    const streamIds = streamIdsRef.current;
    return () => {
      for (const controller of streamControllers.values()) {
        controller.abort();
      }
      streamControllers.clear();
      streamIds.clear();
    };
  }, []);

  const runStream = async (args: {
    sessionId: string;
    model: string;
    endpointId: string;
    input?: { role: 'user'; content: string; attachments?: string[] };
    fromMessageId?: string;
    branchLeafMessageId?: string;
    mode?: 'append' | 'replace';
    displayMessageId?: string | null;
  }) => {
    await stopStreamingSession(args.sessionId, 'replace');

    const controller = new AbortController();
    const clientStreamId = createClientStreamId();
    streamControllersRef.current.set(args.sessionId, controller);
    streamIdsRef.current.set(args.sessionId, clientStreamId);

    const mode = args.mode ?? (args.fromMessageId ? 'replace' : 'append');
    const now = Date.now();
    setSessionStreamState(args.sessionId, {
      status: 'connecting',
      assistant: {
        messageId: args.displayMessageId ?? null,
        content: '',
        mode,
        startedAt: now,
        lastTokenAt: now,
      },
    });

    const throttler = createThrottle<string>(40, (next) => {
      setSessionStreamState(args.sessionId, (prev) => ({
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
      setSessionStreamState(args.sessionId, (prev) => ({
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
      streamControllersRef.current.get(args.sessionId) === controller;

    try {
      const res = await postChatStream({
        token,
        workspaceId,
        projectId,
        sessionId: args.sessionId,
        body: {
          model: args.model,
          endpoint_id: args.endpointId,
          branch_leaf_message_id: args.branchLeafMessageId,
          from_message_id: args.fromMessageId,
          input: args.input,
          client_stream_id: clientStreamId,
        },
        signal: controller.signal,
      });
      setSessionStreamState(args.sessionId, (prev) => ({
        ...prev,
        status: 'streaming',
      }));
      let content = '';
      let liveMessageId: string | null = mode === 'replace' ? args.fromMessageId ?? null : null;

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
            streamIdsRef.current.set(args.sessionId, metaStreamId);
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
                setActiveVariantIndexByGroup((prev) => ({ ...prev, [variantGroupId]: variantIndex }));
              }
              upsertStreamAssistantToCache(args.sessionId, {
                id: metaMessageId,
                session_id: args.sessionId,
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
              patchStreamAssistantInCache(args.sessionId, liveMessageId, {
                content,
                tokens: content.length,
                finish_reason: null,
              });
            }
          }
        } else if (ev.event === 'error') {
          const data = (typeof ev.data === 'object' && ev.data !== null ? (ev.data as Record<string, unknown>) : null);
          const message = data && typeof data.message === 'string' ? data.message : 'Stream error';
          throw new Error(message);
        } else if (ev.event === 'done') {
          break;
        }
      }

      throttler.flush();
      if (streamStillActive()) {
        setSessionStreamState(args.sessionId, { status: 'idle', assistant: null });
      }

      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', workspaceId, projectId, args.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        if (streamStillActive()) {
          setSessionStreamState(args.sessionId, { status: 'stopped', assistant: null });
        }
        queryClient.invalidateQueries({ queryKey: ['chat', 'messages', workspaceId, projectId, args.sessionId] });
        queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
        return;
      }
      setSessionStreamState(args.sessionId, { status: 'error', assistant: null });
      toast.error(e instanceof Error ? e.message : 'Streaming failed');
    } finally {
      if (streamControllersRef.current.get(args.sessionId) === controller) {
        streamControllersRef.current.delete(args.sessionId);
      }
      const currentStreamId = streamIdsRef.current.get(args.sessionId);
      if (!currentStreamId || currentStreamId === clientStreamId) {
        streamIdsRef.current.delete(args.sessionId);
      }
    }
  };

  const handleSend = async () => {
    if (!canUseChat) return;
    if (!currentSessionId) return;
    if (!activeSession) return;

    const composerValue = composerBySession[currentSessionId] || '';
    const content = composerValue.trim();
    if (!content) return;

    const readyAttachmentIds = attachments.filter((a) => a.upload_status === 'ready').map((a) => a.id);
    const hasBlocking = attachments.some((a) => a.upload_status !== 'ready');
    if (hasBlocking) return;

    if (editingMessageId) return;

    const userMsg = await createMessageMutation.mutateAsync({
      sessionId: currentSessionId,
      content,
      attachments: readyAttachmentIds,
      parent_id: visibleLeafId,
    });
    setComposerBySession((prev) => ({ ...prev, [currentSessionId]: '' }));
      await runStream({
        sessionId: currentSessionId,
        model: activeSession.model,
        endpointId: activeSession.endpoint_id,
        branchLeafMessageId: userMsg.id,
        input: { role: 'user', content, attachments: readyAttachmentIds },
        mode: 'append',
      });
  };

  const onPickFiles = () => {
    if (!canUseChat) return;
    fileInputRef.current?.click();
  };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!canUseChat) return;
    if (!currentSessionId) return;
    if (files.length === 0) return;
    for (const f of files) {
      await initAttachmentMutation.mutateAsync({ sessionId: currentSessionId, file: f });
    }
  };

  if (!resolvedParams) {
    return (
          <PageState state="loading">
        <div className="flex items-center justify-center h-full">
          <div className="text-tertiary">{t('loading')}</div>
        </div>
      </PageState>
    );
  }

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadThreads) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const composerValue = currentSessionId ? composerBySession[currentSessionId] || '' : '';
  const activeStreamStatus: SessionStreamStatus = currentSessionId
    ? (streamStateBySession[currentSessionId]?.status ?? 'idle')
    : 'idle';
  const activeStreamingAssistant = currentSessionId
    ? (streamStateBySession[currentSessionId]?.assistant ?? null)
    : null;
  const streamingSessionIds = Object.entries(streamStateBySession)
    .filter(([, state]) => state.status === 'connecting' || state.status === 'streaming')
    .map(([sessionId]) => sessionId);
  const disabled =
    (activeStreamStatus === 'connecting' || activeStreamStatus === 'streaming') &&
    !!activeStreamingAssistant;

  return (
    <PageState state="success">
      <PageLayout
        density="immersive"
        contentWidth="full"
        header={<PageHeader title={t('title')} />}
      >
        <div className="h-full min-h-0 flex overflow-hidden rounded-md border border-subtle bg-panel/40">
          <ThreadsPane
            sessions={sessions}
            activeSessionId={currentSessionId}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSelect={(id) => {
              setCurrentSessionId(id);
              setEditingMessageId(null);
            }}
            streamingSessionIds={streamingSessionIds}
              onRename={(id, title) => {
              if (!canManageChatSessions) return;
              updateSessionMutation.mutate({ sessionId: id, data: { title } });
            }}
            onToggleStar={(id, next) => {
              if (!canManageChatSessions) return;
              updateSessionMutation.mutate({ sessionId: id, data: { starred: next } });
            }}
            onTogglePin={(id, next) => {
              if (!canManageChatSessions) return;
              updateSessionMutation.mutate({ sessionId: id, data: { pinned: next } });
            }}
            onDelete={(id) => {
              if (!canManageChatSessions) return;
              const thread = sessions.find((s) => s.id === id) || null;
              setThreadToDelete({ id, title: thread?.title });
              setDeleteThreadDialogOpen(true);
            }}
            onCreate={() => {
              if (!canUseChat) return;
              createSessionMutation.mutate();
            }}
            canCreate={canUseChat}
            createPending={createSessionMutation.isPending}
            isLoading={sessionsLoading}
          />

          <section className="flex-1 flex min-w-0 flex-col bg-background overflow-hidden" data-testid="chat__main-pane">
            <ChatHeader
              session={activeSession}
              endpoints={endpoints}
              streamStatus={activeStreamStatus}
              onRename={(title) => {
                if (!canManageChatSessions) return;
                if (!activeSession) return;
                updateSessionMutation.mutate({ sessionId: activeSession.id, data: { title } });
              }}
              onSelectEndpoint={(e: Endpoint) => {
                if (!canManageChatSessions) return;
                if (!activeSession) return;
                updateSessionMutation.mutate({ sessionId: activeSession.id, data: { endpoint_id: e.id, model: e.openai_model } });
              }}
            />

            <div className="flex-1 min-h-0">
              {!currentSessionId ? (
                <div className="h-full flex items-center justify-center px-4">
                  <div className="mx-auto w-full max-w-[560px] text-center px-6">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
                    <div className="text-foreground font-medium mb-1">{t('no_active_thread_title')}</div>
                    <div className="text-tertiary text-sm">{t('no_active_thread_description')}</div>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => {
                        if (!canUseChat) return;
                        createSessionMutation.mutate();
                      }}
                      disabled={!canUseChat || createSessionMutation.isPending}
                      data-testid="chat__empty-create-btn"
                    >
                      <Plus className="w-4 h-4" />
                      {t('new_thread')}
                    </Button>
                  </div>
                </div>
              ) : messagesLoading ? (
                <div className="h-full flex items-center justify-center px-4">
                  <div className="text-tertiary">{t('loading')}</div>
                </div>
              ) : (
                <MessageList
                  messages={messages}
                  activeVariantIndexByGroup={activeVariantIndexByGroup}
                  editingMessageId={editingMessageId}
                  onSelectVariant={(groupId, nextIndex) => {
                    manualVariantGroupsRef.current.add(groupId);
                    setSuppressAutoScroll(true);
                    if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current);
                    suppressTimerRef.current = window.setTimeout(() => setSuppressAutoScroll(false), 1500);
                    setActiveVariantIndexByGroup((prev) => ({ ...prev, [groupId]: nextIndex }));
                  }}
                  onEdit={(m) => {
                    if (disabled) return;
                    if (!canUseChat) return;
                    if (m.role !== 'user') return;
                    setEditingMessageId(m.id);
                  }}
                  onEditCommit={async (m, nextContent) => {
                    if (disabled) return;
                    if (!canUseChat) return;
                    if (!currentSessionId) return;
                    const edited = await editMessageMutation.mutateAsync({
                      sessionId: currentSessionId,
                      messageId: m.id,
                      content: nextContent,
                    });
                    upsertStreamAssistantToCache(currentSessionId, edited);
                    if (edited.logical_id && typeof edited.revision_index === 'number') {
                      const logicalId = edited.logical_id;
                      const revisionIndex = edited.revision_index;
                      setActiveVariantIndexByGroup((prev) => ({
                        ...prev,
                        [logicalId]: revisionIndex,
                      }));
                    }
                    pendingAutoGroupRef.current = edited.logical_id || (edited.revision_of ? `log_${edited.revision_of}` : null);
                    setEditingMessageId(null);
                    if (activeSession?.model && activeSession?.endpoint_id) {
                      const groups = buildVariantGroups(messages);
                      const { chain } = buildVisibleChain(messages, groups, activeVariantIndexByGroup);
                      const editedIndex = chain.findIndex((item) => item.id === m.id);
                      const previewAssistant =
                        editedIndex >= 0
                          ? chain.slice(editedIndex + 1).find((item) => item.role === 'assistant')
                          : undefined;
                      await runStream({
                        sessionId: currentSessionId,
                        model: activeSession.model,
                        endpointId: activeSession.endpoint_id,
                        fromMessageId: edited.id,
                        displayMessageId: previewAssistant?.id ?? null,
                        mode: 'replace',
                      });
                    }
                  }}
                  onEditCancel={() => setEditingMessageId(null)}
                  onRegenerate={async (m) => {
                    if (disabled) return;
                    if (!canUseChat) return;
                    if (!activeSession || !currentSessionId) return;
                    if (messages.length) {
                      const groups = buildVariantGroups(messages);
                      pendingAutoGroupRef.current = getGroupIdForMessageId(groups, m.id);
                    }
                    await runStream({
                      sessionId: currentSessionId,
                      model: activeSession.model,
                      endpointId: activeSession.endpoint_id,
                      fromMessageId: m.id,
                      mode: 'replace',
                    });
                  }}
                  disabled={disabled}
                  footer={
                    activeStreamingAssistant && activeStreamingAssistant.mode === 'append' ? (
                      <div className="px-4 py-2">
                        <div className="flex justify-start">
                          <div className="max-w-[80%] rounded-md px-4 py-3 border bg-surface-high text-primary border-subtle">
                            <div className="text-xs text-tertiary mb-1">Assistant</div>
                            <div className="space-y-2">
                              <Markdown content={activeStreamingAssistant.content || '…'} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null
                  }
                  streamingAssistant={activeStreamingAssistant}
                  followOutput={activeStreamingAssistant?.mode !== 'replace'}
                  suppressAutoScroll={suppressAutoScroll}
                />
              )}
            </div>

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />

            {currentSessionId && (
              <Composer
                value={composerValue}
                onChange={(v) => {
                  if (!currentSessionId) return;
                  setComposerBySession((prev) => ({ ...prev, [currentSessionId]: v }));
                }}
                onSend={handleSend}
                onStop={stopStreaming}
                mode="compose"
                autoFocus={!editingMessageId && activeStreamStatus === 'idle'}
                onPickFiles={() => {
                  if (editingMessageId) {
                    toast.info(t('attachments.disabled_while_editing'));
                    return;
                  }
                  onPickFiles();
                }}
                attachments={attachments}
                onRemoveAttachment={(id) => {
                  if (!canUseChat) return;
                  if (!currentSessionId) return;
                  deleteAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId: id });
                }}
                onRetryAttachment={(id) => {
                  if (!canUseChat) return;
                  if (!currentSessionId) return;
                  retryAttachmentMutation.mutate({ sessionId: currentSessionId, attachmentId: id });
                }}
                disabled={
                  !currentSessionId ||
                  !canUseChat ||
                  createMessageMutation.isPending ||
                  editMessageMutation.isPending ||
                  initAttachmentMutation.isPending ||
                  disabled ||
                  !!editingMessageId
                }
                streaming={disabled}
              />
            )}
          </section>
        </div>
        <AlertDialog open={deleteThreadDialogOpen} onOpenChange={setDeleteThreadDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete_confirm_message', { name: threadToDelete?.title ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                data-testid="chat__delete-thread-confirm"
                onClick={(e) => {
                  e.preventDefault();
                  if (!threadToDelete) return;
                  deleteSessionMutation.mutate(threadToDelete.id);
                  setDeleteThreadDialogOpen(false);
                  setThreadToDelete(null);
                }}
                className="bg-error text-white hover:bg-error/90"
              >
                {t('delete_confirm_action')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
