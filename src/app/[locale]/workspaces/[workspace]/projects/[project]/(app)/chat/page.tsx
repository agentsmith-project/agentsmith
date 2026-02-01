/**
 * Chat Page
 *
 * Three-column layout for AI chat interactions:
 * - Left: Session list
 * - Center: Chat messages and input
 * - Right: Session info and attachments
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, MessageSquare, Settings, Paperclip } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, ChatAPI } from '@/lib/api';

interface ChatPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const queryClient = useQueryClient();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);

  // Get current project from auth store
  const currentProject = useAuthStore((state) => state.currentProject);

  // Await params in useEffect (not in a hook that would be conditional)
  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  // Create API client (memoized would be better but this works for now)
  const chatAPI = new ChatAPI(getApiClient());

  // Workspace and project IDs - use defaults if not resolved yet
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  // Fetch chat sessions - enabled when we have valid IDs
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['chat', 'sessions', workspaceId, projectId],
    queryFn: () => chatAPI.getSessions(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });

  // Fetch current session messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['chat', 'messages', workspaceId, projectId, currentSessionId],
    queryFn: () => {
      if (!currentSessionId) return { items: [], total: 0 };
      return chatAPI.getMessages(workspaceId, projectId, currentSessionId);
    },
    enabled: !!currentSessionId,
  });

  // Create new session mutation
  const createSessionMutation = useMutation({
    mutationFn: () => chatAPI.createSession(workspaceId, projectId),
    onSuccess: (data) => {
      setCurrentSessionId(data.id);
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', workspaceId, projectId] });
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (content: string) => {
      if (!currentSessionId) throw new Error('No active session');
      return chatAPI.createMessage(workspaceId, projectId, currentSessionId, {
        role: 'user',
        content,
      });
    },
    onSuccess: () => {
      setInputMessage('');
      queryClient.invalidateQueries({
        queryKey: ['chat', 'messages', workspaceId, projectId, currentSessionId],
      });
    },
  });

  const handleSendMessage = () => {
    if (inputMessage.trim() && !sendMessageMutation.isPending) {
      sendMessageMutation.mutate(inputMessage);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const sessions = sessionsData?.items || [];
  const messages = messagesData?.items || [];
  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // Show loading state while params are being resolved
  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Session List */}
      <div className="w-80 border-r border-subtle bg-surface">
        <div className="p-4 border-b border-border">
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
            className="w-full flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="p-2 overflow-y-auto h-[calc(100%-60px)]">
          {sessionsLoading ? (
            <div className="text-sm text-tertiary text-center py-4">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-sm text-tertiary text-center py-4">No sessions yet</div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setCurrentSessionId(session.id)}
                  className={`w-full text-left px-3 h-10 rounded-sm transition-colors ${
                    currentSessionId === session.id
                      ? 'bg-hover text-foreground'
                      : 'hover:bg-hover text-primary'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className={`w-4 h-4 flex-shrink-0 ${currentSessionId === session.id ? 'text-accent' : 'text-icon-default'}`} />
                    <div className="truncate text-sm">{session.title || 'New Chat'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center Panel - Chat Messages */}
      <div className="flex-1 flex flex-col bg-background">
        {currentSession ? (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {messagesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-tertiary">Loading messages...</div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
                    <p className="text-tertiary">Start a conversation...</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 max-w-3xl mx-auto">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-md px-4 py-2 border ${
                          message.role === 'user'
                            ? 'bg-hover text-foreground border-subtle'
                            : 'bg-surface-high text-primary border-subtle'
                        }`}
                      >
                        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                      </div>
                    </div>
                  ))}
                  {sendMessageMutation.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-surface-high text-tertiary rounded-md px-4 py-2 border border-subtle">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce" />
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce delay-100" />
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce delay-200" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border p-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="p-2 text-icon-default hover:text-foreground transition-colors"
                    title="Attach file"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 resize-none rounded-sm border border-subtle bg-surface-high px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    disabled={sendMessageMutation.isPending}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || sendMessageMutation.isPending}
                    className="px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-tertiary" />
              <h2 className="text-lg font-semibold text-foreground mb-2">No active session</h2>
              <p className="text-tertiary mb-4">Create a new chat to start talking</p>
              <button
                onClick={() => createSessionMutation.mutate()}
                disabled={createSessionMutation.isPending}
                className="px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors disabled:opacity-50"
              >
                New Chat
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Session Info */}
      <div className="w-72 border-l border-subtle bg-surface">
        {currentSession ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Session Info</h3>
              <button className="p-1 text-icon-default hover:text-foreground transition-colors">
                <Settings className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-tertiary">Title</div>
                <div className="font-medium text-primary">{currentSession.title || 'New Chat'}</div>
              </div>
              <div>
                <div className="text-tertiary">Created</div>
                <div className="text-primary">{new Date(currentSession.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-tertiary">Messages</div>
                <div className="text-primary">{messages.length}</div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <h4 className="font-semibold text-foreground mb-3">Attachments</h4>
              <div className="text-sm text-tertiary">
                No attachments yet
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="text-sm text-tertiary text-center">
              Select or create a session to view details
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
