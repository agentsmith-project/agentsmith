import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanAccessChat } from '@/lib/hooks/use-permissions';

const mockGetSessions = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1000, has_more: false });
const mockGetMessages = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 500, has_more: false });
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
const mockDeleteSession = vi.fn().mockResolvedValue({});
const mockEndpointList = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 500, has_more: false });
const mockListLibraries = vi.fn().mockResolvedValue({ items: [] });
const mockListObjects = vi.fn().mockResolvedValue({ prefix: '', items: [] });
const mockDownloadObject = vi.fn().mockResolvedValue(new Blob());
const mockAgentList = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 500, has_more: false });

vi.mock('@/lib/api', () => ({ getApiClient: vi.fn(() => ({})) }));
vi.mock('@/lib/api/endpoints/chat', () => ({
  ChatAPI: vi.fn().mockImplementation(function () {
    return {
      getSessions: mockGetSessions,
      getMessages: mockGetMessages,
      getAttachments: mockGetAttachments,
      createSession: mockCreateSession,
      updateSession: vi.fn(),
      deleteSession: mockDeleteSession,
      createMessage: vi.fn(),
      editMessage: vi.fn(),
      initAttachment: vi.fn().mockResolvedValue({ attachment: { id: 'att_1' }, upload_url: null }),
      completeAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
      retryAttachment: vi.fn(),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 'session_1', state: 'not_found_or_finished' }),
    };
  }),
}));
vi.mock('@/lib/api/endpoints/endpoints', () => ({
  EndpointAPI: vi.fn().mockImplementation(function () { return { list: mockEndpointList }; }),
}));
vi.mock('@/lib/api/endpoints/files', () => ({
  FilesAPI: vi.fn().mockImplementation(function () { return { listLibraries: mockListLibraries, listObjects: mockListObjects, downloadObject: mockDownloadObject }; }),
}));
vi.mock('@/lib/api/endpoints/agents', () => ({
  AgentAPI: vi.fn().mockImplementation(function () { return { list: mockAgentList }; }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { token: string }) => unknown) => selector({ token: 'token' }),
}));
vi.mock('@/components/chat/ThreadsPane', () => ({
  ThreadsPane: ({ onDelete, onCreate }: { onDelete: (id: string) => void; onCreate: () => void }) => (
    <div data-testid="chat__threads-pane">
      <button type="button" data-testid="chat__new-thread-btn" onClick={onCreate}>new-thread</button>
      <button type="button" data-testid="chat__thread-delete-btn" onClick={() => onDelete('session_1')}>delete-thread</button>
    </div>
  ),
}));
vi.mock('@/components/chat/ChatMainPane', () => ({
  ChatMainPane: ({ externalAgents }: { externalAgents?: Array<{ name: string }> }) => (
    <div data-testid="chat__main-pane">
      {(externalAgents ?? []).map((agent) => (
        <span key={agent.name}>{agent.name}</span>
      ))}
    </div>
  ),
}));
vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanAccessChat: vi.fn(() => true),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import ChatPage from '../page';

const mockUseCanAccessChat = vi.mocked(useCanAccessChat);

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ChatPage', () => {
  beforeEach(() => {
    mockUseCanAccessChat.mockReturnValue(true);
    mockCreateSession.mockClear();
    mockDeleteSession.mockClear();
    mockAgentList.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 500, has_more: false });
  });

  it('renders compact layout with new-thread action', async () => {
    render(<ChatPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('page-layout')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chat__new-thread-btn')).toBeInTheDocument();
  });

  it('triggers new thread creation from toolbar', async () => {
    const user = userEvent.setup();
    render(<ChatPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />, { wrapper: createWrapper() });

    await user.click(await screen.findByTestId('chat__new-thread-btn'));
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    render(<ChatPage params={Promise.resolve({ workspace: '<script>', project: 'proj_1', locale: 'en' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks chat read permission', async () => {
    mockUseCanAccessChat.mockReturnValue(false);
    render(<ChatPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('only passes enabled external chat agents to the chat pane', async () => {
    mockAgentList.mockResolvedValue({
      items: [
        {
          id: 'agent_chat',
          name: 'Chat Agent',
          mode: 'external',
          status: 'enabled',
          interaction_kind: 'chat',
        },
        {
          id: 'agent_notebook',
          name: 'Notebook Agent',
          mode: 'external',
          status: 'enabled',
          interaction_kind: 'notebook',
        },
        {
          id: 'agent_internal',
          name: 'Internal Chat Agent',
          mode: 'internal',
          status: 'enabled',
          interaction_kind: 'chat',
        },
      ],
      total: 3,
      page: 1,
      page_size: 500,
      has_more: false,
    });

    render(<ChatPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Chat Agent')).toBeInTheDocument();
    });
    expect(screen.queryByText('Notebook Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Chat Agent')).not.toBeInTheDocument();
  });
});
