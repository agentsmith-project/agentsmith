import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession, Endpoint } from '@/lib/api/types';
import { useChatThreadActions } from '@/lib/chat/use-chat-thread-actions';
import { toast } from '@/components/ui/toast';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'update_failed') return 'Failed to update';
    return key;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

function createSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session_1',
    project_id: 'project_1',
    title: 'Session',
    model: 'gpt-4o',
    endpoint_id: 'ep_1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 0,
    total_tokens: 0,
    ...overrides,
  };
}

const alternateEndpoint: Endpoint = {
  id: 'ep_2',
  project_id: 'project_1',
  name: 'Backup endpoint',
  model: 'claude-3-7-sonnet',
  type: 'catalog',
  upstream_protocol: 'anthropic_messages',
  base_url: 'https://example.test',
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useChatThreadActions', () => {
  it('does not switch model while the active stream is still backend-authoritative', () => {
    const updateSession = vi.fn();

    const { result } = renderHook(() =>
      useChatThreadActions({
        canUseChat: true,
        canManageChatSessions: true,
        canChangeModel: false,
        sessions: [createSession()],
        activeSession: createSession(),
        createSession: vi.fn(),
        updateSession,
        setCurrentSessionId: vi.fn(),
        setEditingMessageId: vi.fn(),
        setThreadToDelete: vi.fn(),
        setDeleteThreadDialogOpen: vi.fn(),
      } as Parameters<typeof useChatThreadActions>[0]),
    );

    result.current.onSelectActiveEndpoint(alternateEndpoint);

    expect(updateSession).not.toHaveBeenCalled();
  });

  it('does not leak an unhandled rejection when a fire-and-forget session update fails', async () => {
    const updateSession = vi.fn().mockRejectedValue(new Error('update failed'));
    const unhandledRejections: PromiseRejectionEvent[] = [];
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    try {
      const { result } = renderHook(() =>
        useChatThreadActions({
          canUseChat: true,
          canManageChatSessions: true,
          sessions: [createSession()],
          activeSession: createSession(),
          createSession: vi.fn(),
          updateSession,
          setCurrentSessionId: vi.fn(),
          setEditingMessageId: vi.fn(),
          setThreadToDelete: vi.fn(),
          setDeleteThreadDialogOpen: vi.fn(),
        }),
      );

      expect(() => {
        result.current.onSelectActiveEndpoint(alternateEndpoint);
      }).not.toThrow();

      await Promise.resolve();
      await Promise.resolve();

      expect(updateSession).toHaveBeenCalledWith({
        sessionId: 'session_1',
        data: {
          endpoint_id: 'ep_2',
          model: 'claude-3-7-sonnet',
        },
      });
      expect(toast.error).toHaveBeenCalledWith('update failed');
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    }
  });

  it('does not expose an external agent selector action from chat thread actions', () => {
    const { result } = renderHook(() =>
      useChatThreadActions({
        canUseChat: true,
        canManageChatSessions: true,
        sessions: [createSession()],
        activeSession: createSession(),
        createSession: vi.fn(),
        updateSession: vi.fn(),
        setCurrentSessionId: vi.fn(),
        setEditingMessageId: vi.fn(),
        setThreadToDelete: vi.fn(),
        setDeleteThreadDialogOpen: vi.fn(),
      }),
    );

    expect(result.current).not.toHaveProperty('onSelectExternalAgent');
  });
});
