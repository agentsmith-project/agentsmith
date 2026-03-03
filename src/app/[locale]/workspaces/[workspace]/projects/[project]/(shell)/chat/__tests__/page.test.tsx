import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanManageChatSessions, useHasPermission } from '@/lib/hooks/use-permissions';

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
const mockStopSessionStream = vi.fn().mockResolvedValue({ success: true, session_id: 'session_1', state: 'not_found_or_finished' });
const mockEndpointList = vi.fn().mockResolvedValue({
  items: [],
  total: 0,
  page: 1,
  page_size: 500,
  has_more: false,
});
const mockListLibraries = vi.fn().mockResolvedValue({ items: [] });
const mockListObjects = vi.fn().mockResolvedValue({ prefix: '', items: [] });
const mockDownloadObject = vi.fn().mockResolvedValue(new Blob());

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
      stopSessionStream: mockStopSessionStream,
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

vi.mock('@/lib/api/endpoints/files', () => ({
  FilesAPI: vi.fn().mockImplementation(function () {
    return {
      listLibraries: mockListLibraries,
      listObjects: mockListObjects,
      downloadObject: mockDownloadObject,
    };
  }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { token: string }) => unknown) => selector({ token: 'token' }),
}));

vi.mock('@/components/chat/ThreadsPane', () => ({
  ThreadsPane: ({ onDelete, onCreate }: { onDelete: (id: string) => void; onCreate: () => void }) => (
    <div data-testid="chat__threads-pane">
      <button type="button" data-testid="chat__new-thread-btn" onClick={onCreate}>
        new-thread
      </button>
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
  useCanManageChatSessions: vi.fn(() => true),
}));

import ChatPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);
const mockUseCanManageChatSessions = vi.mocked(useCanManageChatSessions);

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
  beforeEach(() => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseCanManageChatSessions.mockReturnValue(true);
  });

  it('renders compact layout with new-thread action', async () => {
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
      expect(screen.getByTestId('page-layout')).toBeInTheDocument();
    });

    expect(screen.getByTestId('chat__new-thread-btn')).toBeInTheDocument();
    expect(screen.getByTestId('page-layout__body')).toBeInTheDocument();
    expect(screen.getByTestId('chat__open-notebook')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/notebook');
    expect(screen.getByTestId('chat__open-endpoints')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/endpoints');
    expect(screen.getByTestId('chat__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
  });

  it('triggers new thread creation from toolbar', async () => {
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
    mockUseHasPermission.mockImplementation((permission: string) => permission !== 'project:endpoint:use');
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
