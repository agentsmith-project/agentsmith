import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockGetSessions = vi.fn().mockResolvedValue({
  items: [],
  total: 0,
  page: 1,
  page_size: 1000,
  has_more: false,
});
const mockGetMessages = vi.fn().mockResolvedValue({
  items: [],
  total: 0,
  page: 1,
  page_size: 500,
  has_more: false,
});
const mockGetAttachments = vi.fn().mockResolvedValue({ items: [], total: 0 });
const mockCreateSession = vi.fn().mockResolvedValue({
  id: 'session_1',
  project_id: 'proj_1',
  title: 'New Chat',
  model: 'gpt-4o',
  endpoint_id: 'ep_1',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
});
const mockUpdateSession = vi.fn().mockResolvedValue({});
const mockDeleteSession = vi.fn().mockResolvedValue({});
const mockCreateMessage = vi.fn().mockResolvedValue({ id: 'msg_1' });
const mockEditMessage = vi.fn().mockResolvedValue({ id: 'msg_1' });
const mockInitAttachment = vi.fn().mockResolvedValue({ attachment: { id: 'att_1' }, upload_url: null });
const mockCompleteAttachment = vi.fn().mockResolvedValue({});
const mockDeleteAttachment = vi.fn().mockResolvedValue({});
const mockRetryAttachment = vi.fn().mockResolvedValue({});
const mockEndpointList = vi.fn().mockResolvedValue({
  items: [],
  total: 0,
  page: 1,
  page_size: 500,
  has_more: false,
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/api/endpoints/chat', () => ({
  ChatAPI: vi.fn().mockImplementation(function () {
    return {
      getSessions: mockGetSessions,
      getMessages: mockGetMessages,
      getAttachments: mockGetAttachments,
      createSession: mockCreateSession,
      updateSession: mockUpdateSession,
      deleteSession: mockDeleteSession,
      createMessage: mockCreateMessage,
      editMessage: mockEditMessage,
      initAttachment: mockInitAttachment,
      completeAttachment: mockCompleteAttachment,
      deleteAttachment: mockDeleteAttachment,
      retryAttachment: mockRetryAttachment,
    };
  }),
}));

vi.mock('@/lib/api/endpoints/endpoints', () => ({
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockEndpointList,
    };
  }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { token: string }) => unknown) => selector({ token: 'token' }),
}));

vi.mock('@/components/chat/ThreadsPane', () => ({
  ThreadsPane: ({ onDelete }: { onDelete: (id: string) => void }) => (
    <div data-testid="chat__threads-pane">
      <button type="button" data-testid="chat__thread-delete-btn" onClick={() => onDelete('session_1')}>
        delete-thread
      </button>
    </div>
  ),
}));

vi.mock('@/components/chat/ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat__header" />,
}));

vi.mock('@/components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="chat__message-list" />,
}));

vi.mock('@/components/chat/Composer', () => ({
  Composer: () => <div data-testid="chat__composer" />,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import ChatPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ChatPage', () => {
  it('renders compact header layout with new-thread action', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <ChatPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(within(header).getByTestId('chat__new-thread-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('page-layout__toolbar')).not.toBeInTheDocument();
  });

  it('triggers new thread creation from toolbar', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ChatPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const button = await screen.findByTestId('chat__new-thread-btn');
    expect(mockCreateSession).not.toHaveBeenCalled();

    await user.click(button);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  it('uses dialog confirmation before deleting a thread', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ChatPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const deleteBtn = await screen.findByTestId('chat__thread-delete-btn');
    await user.click(deleteBtn);

    expect(screen.getByText(/delete_confirm_title/i)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /delete_confirm_action/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith('ws_1', 'proj_1', 'session_1');
    });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <ChatPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks chat read permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <ChatPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
