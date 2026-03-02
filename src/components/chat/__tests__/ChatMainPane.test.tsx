import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatMainPane, type ChatMainPaneProps } from '../ChatMainPane';

vi.mock('@/components/chat/ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat-header" />,
}));

vi.mock('@/components/chat/Composer', () => ({
  Composer: () => <div data-testid="chat-composer" />,
}));

vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="chat-message-list" />,
}));

function createProps(overrides: Partial<ChatMainPaneProps> = {}): ChatMainPaneProps {
  return {
    currentSessionId: 'session_1',
    activeSession: {
      id: 'session_1',
      title: 'Session 1',
      endpoint_id: 'ep_1',
      external_agent_id: 'agent_1',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    },
    endpoints: [],
    externalAgents: [],
    messages: [],
    messagesLoading: false,
    attachments: [],
    activeVariantIndexByGroup: {},
    editingMessageId: null,
    disabled: false,
    activeStreamStatus: 'error',
    activeStreamingAssistant: null,
    activeStreamErrorCode: 'AGENT_UPSTREAM',
    activeStreamErrorMessage: 'Upstream 503',
    suppressAutoScroll: false,
    createPending: false,
    createMessagePending: false,
    editMessagePending: false,
    initAttachmentPending: false,
    canUseChat: true,
    canAttachFiles: true,
    composerValue: '',
    fileInputRef: { current: null },
    labels: {
      loading: 'Loading',
      noActiveThreadTitle: 'No thread',
      noActiveThreadDescription: 'No active thread',
      noActiveThreadHint: 'Create a thread',
      noEndpointHint: 'Need endpoint',
      streamErrorHint: 'Error',
      streamErrorTitleInterrupted: 'Interrupted',
      streamErrorTitleAgentOffline: 'Offline',
      streamErrorTitleAgentTimeout: 'Timeout',
      streamErrorTitleAgentProtocol: 'Protocol',
      streamErrorTitleAgentUpstream: 'Upstream',
      streamDiagnosticsRuntime: 'Open Runtime',
      streamDiagnosticsReleaseOps: 'Open Release Ops',
      streamDiagnosticsAgent: 'Open Agent Diagnostics',
      newThread: 'New Thread',
      selectThreadHint: 'Select thread',
      attachmentsDisabledReason: 'Disabled',
      assistant: 'Assistant',
    },
    onCreateThread: vi.fn(),
    onRenameActiveSession: vi.fn(),
    onSelectActiveEndpoint: vi.fn(),
    onSelectExternalAgent: vi.fn(),
    onSelectVariant: vi.fn(),
    onEditMessage: vi.fn(),
    onEditCommit: vi.fn(),
    onRegenerate: vi.fn(),
    onComposerChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onPickFiles: vi.fn(),
    onPickFromLibrary: vi.fn(),
    onPickUrl: vi.fn(),
    onFilePicked: vi.fn(),
    onAttachFiles: vi.fn().mockResolvedValue(undefined),
    onRemoveAttachment: vi.fn(),
    onRetryAttachment: vi.fn(),
    onCancelEdit: vi.fn(),
    diagnosticsLinks: {
      runtime: '/runtime-observability?result=error',
      releaseOps: '/release-ops?result=error',
      agent: '/agents?agent=agent_1',
    },
    ...overrides,
  };
}

describe('ChatMainPane', () => {
  it('shows cross-surface diagnostics links for stream errors', () => {
    render(<ChatMainPane {...createProps()} />);

    expect(screen.getByTestId('chat__stream-error-open-runtime')).toHaveAttribute(
      'href',
      '/runtime-observability?result=error',
    );
    expect(screen.getByTestId('chat__stream-error-open-release-ops')).toHaveAttribute(
      'href',
      '/release-ops?result=error',
    );
    expect(screen.getByTestId('chat__stream-error-open-agent')).toHaveAttribute(
      'href',
      '/agents?agent=agent_1',
    );
  });

  it('omits agent diagnostics link when no agent link is available', () => {
    render(
      <ChatMainPane
        {...createProps({
          diagnosticsLinks: {
            runtime: '/runtime-observability?result=error',
            releaseOps: '/release-ops?result=error',
            agent: null,
          },
        })}
      />,
    );

    expect(screen.queryByTestId('chat__stream-error-open-agent')).not.toBeInTheDocument();
  });
});
