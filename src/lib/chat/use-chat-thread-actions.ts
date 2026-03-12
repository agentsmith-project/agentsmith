import { useCallback } from 'react';
import type { Endpoint, ChatSession, Agent } from '@/lib/api/types';

interface ThreadToDelete {
  id: string;
  title?: string;
}

interface UseChatThreadActionsArgs {
  canUseChat: boolean;
  canManageChatSessions: boolean;
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  createSession: () => void;
  updateSession: (args: {
    sessionId: string;
    data: Partial<Pick<ChatSession, 'title' | 'model' | 'endpoint_id' | 'external_agent_id' | 'pinned' | 'starred'>>;
  }) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
  setEditingMessageId: (messageId: string | null) => void;
  setThreadToDelete: (thread: ThreadToDelete | null) => void;
  setDeleteThreadDialogOpen: (open: boolean) => void;
}

interface UseChatThreadActionsResult {
  onSelectThread: (sessionId: string) => void;
  onCreateThread: () => void;
  onRenameThread: (sessionId: string, title: string) => void;
  onToggleThreadStar: (sessionId: string, next: boolean) => void;
  onToggleThreadPin: (sessionId: string, next: boolean) => void;
  onDeleteThreadRequest: (sessionId: string) => void;
  onRenameActiveSession: (title: string) => void;
  onSelectActiveEndpoint: (endpoint: Endpoint) => void;
  onSelectExternalAgent: (agent: Agent) => void;
}

export function useChatThreadActions(args: UseChatThreadActionsArgs): UseChatThreadActionsResult {
  const {
    canUseChat,
    canManageChatSessions,
    sessions,
    activeSession,
    createSession,
    updateSession,
    setCurrentSessionId,
    setEditingMessageId,
    setThreadToDelete,
    setDeleteThreadDialogOpen,
  } = args;

  const onSelectThread = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    setEditingMessageId(null);
  }, [setCurrentSessionId, setEditingMessageId]);

  const onCreateThread = useCallback(() => {
    if (!canUseChat) return;
    createSession();
  }, [canUseChat, createSession]);

  const onRenameThread = useCallback((sessionId: string, title: string) => {
    if (!canManageChatSessions) return;
    updateSession({ sessionId, data: { title } });
  }, [canManageChatSessions, updateSession]);

  const onToggleThreadStar = useCallback((sessionId: string, next: boolean) => {
    if (!canManageChatSessions) return;
    updateSession({ sessionId, data: { starred: next } });
  }, [canManageChatSessions, updateSession]);

  const onToggleThreadPin = useCallback((sessionId: string, next: boolean) => {
    if (!canManageChatSessions) return;
    updateSession({ sessionId, data: { pinned: next } });
  }, [canManageChatSessions, updateSession]);

  const onDeleteThreadRequest = useCallback((sessionId: string) => {
    if (!canManageChatSessions) return;
    const thread = sessions.find((session) => session.id === sessionId) || null;
    setThreadToDelete({ id: sessionId, title: thread?.title });
    setDeleteThreadDialogOpen(true);
  }, [canManageChatSessions, sessions, setDeleteThreadDialogOpen, setThreadToDelete]);

  const onRenameActiveSession = useCallback((title: string) => {
    if (!canManageChatSessions || !activeSession) return;
    updateSession({ sessionId: activeSession.id, data: { title } });
  }, [activeSession, canManageChatSessions, updateSession]);

  const onSelectActiveEndpoint = useCallback((endpoint: Endpoint) => {
    if (!canManageChatSessions || !activeSession) return;
    updateSession({
      sessionId: activeSession.id,
      data: { endpoint_id: endpoint.id, external_agent_id: undefined, model: endpoint.model },
    });
  }, [activeSession, canManageChatSessions, updateSession]);

  const onSelectExternalAgent = useCallback((agent: Agent) => {
    if (!canManageChatSessions || !activeSession) return;
    updateSession({
      sessionId: activeSession.id,
      data: { external_agent_id: agent.id, endpoint_id: '', model: activeSession.model || 'external-agent' },
    });
  }, [activeSession, canManageChatSessions, updateSession]);

  return {
    onSelectThread,
    onCreateThread,
    onRenameThread,
    onToggleThreadStar,
    onToggleThreadPin,
    onDeleteThreadRequest,
    onRenameActiveSession,
    onSelectActiveEndpoint,
    onSelectExternalAgent,
  };
}
