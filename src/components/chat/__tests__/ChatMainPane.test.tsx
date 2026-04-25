import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatMainPane, type ChatMainPaneProps } from '../ChatMainPane';

vi.mock('@/components/chat/ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat__header" />,
}));

const composerMock = vi.fn((props: { disabled?: boolean; streaming?: boolean }) => (
  <div
    data-testid="chat__composer"
    data-disabled={String(Boolean(props.disabled))}
    data-streaming={String(Boolean(props.streaming))}
  />
));

vi.mock('@/components/chat/Composer', () => ({
  Composer: (props: { disabled?: boolean; streaming?: boolean }) => composerMock(props),
}));

const messageListMock = vi.fn((props: { footer?: React.ReactNode }) => (
  <div data-testid="chat__message-list">{props.footer}</div>
));

vi.mock('@/components/chat/MessageList', () => ({
  MessageList: (props: { footer?: React.ReactNode }) => messageListMock(props),
}));

vi.mock('@/components/chat/chat-main-pane/ChatLoadingState', () => ({
  ChatLoadingState: () => <div data-testid="chat__loading-state" />,
}));

vi.mock('@/components/chat/chat-main-pane/StreamingAppendFooter', () => ({
  StreamingAppendFooter: () => <div data-testid="chat__append-footer" />,
}));

const defaultLabels: ChatMainPaneProps['labels'] = {
  loading: 'loading',
  noActiveThreadTitle: 'noActiveThreadTitle',
  noActiveThreadDescription: 'noActiveThreadDescription',
  noActiveThreadHint: 'noActiveThreadHint',
  noEndpointHint: 'noEndpointHint',
  noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
  noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
  noEndpointRecoveryHint: 'noEndpointRecoveryHint',
  streamErrorRecoveryCapacityTitle: 'streamErrorRecoveryCapacityTitle',
  streamErrorRecoveryCapacityDescription: 'streamErrorRecoveryCapacityDescription',
  streamErrorRecoveryUpstreamTitle: 'streamErrorRecoveryUpstreamTitle',
  streamErrorRecoveryUpstreamDescription: 'streamErrorRecoveryUpstreamDescription',
  streamErrorRecoveryMessageLabel: 'streamErrorRecoveryMessageLabel',
  streamErrorRecoverySameThreadHint: 'streamErrorRecoverySameThreadHint',
  streamErrorRecoveryEndpointHint: 'streamErrorRecoveryEndpointHint',
  newThread: 'newThread',
  selectThreadHint: 'selectThreadHint',
  attachmentsDisabledReason: 'attachmentsDisabledReason',
  assistant: 'assistant',
};

const defaultProps: ChatMainPaneProps = {
  currentSessionId: 'session_1',
  activeSession: {
    id: 'session_1',
    project_id: 'proj_1',
    title: 'Session',
    endpoint_id: 'ep_1',
    model: 'gpt-4o',
  } as never,
  endpoints: [],
  externalAgents: [],
  messages: [],
  messagesLoading: false,
  attachments: [],
  activeVariantIndexByGroup: {},
  editingMessageId: null,
  disabled: false,
  activeStreamStatus: 'idle',
  activeStreamingAssistant: null,
  activeStreamErrorCode: null,
  activeStreamErrorMessage: null,
  suppressAutoScroll: false,
  createPending: false,
  createMessagePending: false,
  editMessagePending: false,
  initAttachmentPending: false,
  canUseChat: true,
  canAttachFiles: true,
  composerValue: '',
  fileInputRef: { current: null },
  labels: defaultLabels,
  layoutMode: 'standard',
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
  onAttachFiles: vi.fn(async () => {}),
  onRemoveAttachment: vi.fn(),
  onRetryAttachment: vi.fn(),
  onCancelEdit: vi.fn(),
};

function renderChatMainPane(overrides: Partial<ChatMainPaneProps> = {}) {
  const mergedProps: ChatMainPaneProps = {
    ...defaultProps,
    ...overrides,
    labels: {
      ...defaultLabels,
      ...(overrides.labels ?? {}),
    },
  };
  return render(<ChatMainPane {...mergedProps} />);
}

beforeEach(() => {
  composerMock.mockClear();
  messageListMock.mockClear();
});

describe('ChatMainPane', () => {
  it('keeps the no-thread surface informational so the header owns the only primary CTA', () => {
    renderChatMainPane({
      currentSessionId: null,
      activeSession: null,
      canAttachFiles: false,
    });

    expect(screen.getByTestId('chat__main-empty-state')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadTitle')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadDescription')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadHint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'newThread' })).not.toBeInTheDocument();
  });

  it('keeps the endpoint recovery state inline as a distinct work shelf', () => {
    renderChatMainPane({
      activeSession: {
        id: 'session_1',
        project_id: 'proj_1',
        title: 'Session',
        endpoint_id: '',
        model: '',
      } as never,
      endpoints: [{ id: 'ep_1', name: 'GPT-4', capabilities: [] } as never],
      canAttachFiles: false,
    });

    expect(screen.getByTestId('chat__main-pane').className).not.toContain('gradient');
    expect(screen.getByTestId('chat__composer-recovery').className).toContain('border-t');
    expect(screen.getByTestId('chat__composer-recovery-shell')).toHaveClass('rounded-xl', 'border', 'shadow-ambient');
    expect(screen.getByText('noEndpointRecoveryTitle')).toBeInTheDocument();
    expect(screen.getByTestId('chat__message-list')).toBeInTheDocument();
  });

  it('does not offer disabled endpoints in the no-endpoint recovery shelf', () => {
    renderChatMainPane({
      activeSession: {
        id: 'session_1',
        project_id: 'proj_1',
        title: 'Session',
        endpoint_id: '',
        model: '',
      } as never,
      endpoints: [
        { id: 'ep_disabled', name: 'Disabled endpoint', status: 'disabled', capabilities: [] } as never,
      ],
      canAttachFiles: false,
    });

    expect(screen.queryByTestId('chat__composer-recovery-endpoint--ep_disabled')).not.toBeInTheDocument();
    expect(screen.getByText('noEndpointRecoveryHint')).toBeInTheDocument();
  });

  it('shows a stable inline recovery shelf for upstream capacity errors while keeping the composer ready', () => {
    renderChatMainPane({
      endpoints: [
        { id: 'ep_1', name: 'Primary endpoint', status: 'active', capabilities: [] } as never,
        { id: 'ep_2', name: 'Backup endpoint', status: 'active', capabilities: [] } as never,
        { id: 'ep_disabled', name: 'Disabled endpoint', status: 'disabled', capabilities: [] } as never,
      ],
      activeStreamStatus: 'error',
      activeStreamErrorCode: 'UPSTREAM_RATE_LIMIT',
      activeStreamErrorMessage: 'Selected model is at capacity. Please retry shortly.',
      composerValue: 'retry this turn',
    });

    expect(screen.getByTestId('chat__composer-recovery')).toBeVisible();
    expect(screen.getByTestId('chat__stream-error-recovery')).toBeVisible();
    expect(screen.getByText('streamErrorRecoveryCapacityTitle')).toBeInTheDocument();
    expect(screen.getByText('streamErrorRecoveryCapacityDescription')).toBeInTheDocument();
    expect(screen.getByText('streamErrorRecoverySameThreadHint')).toBeInTheDocument();
    expect(screen.getByText('streamErrorRecoveryEndpointHint')).toBeInTheDocument();
    expect(screen.getByTestId('chat__stream-error-message')).toHaveTextContent(
      'Selected model is at capacity. Please retry shortly.',
    );
    expect(screen.getByTestId('chat__composer-recovery-endpoint--ep_2')).toBeInTheDocument();
    expect(screen.queryByTestId('chat__composer-recovery-endpoint--ep_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat__composer-recovery-endpoint--ep_disabled')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'false');
  });

  it('keeps attach recovery errors visible without offering recovery actions while backend truth is still active', () => {
    renderChatMainPane({
      endpoints: [
        { id: 'ep_1', name: 'Primary endpoint', status: 'active', capabilities: [] } as never,
        { id: 'ep_2', name: 'Backup endpoint', status: 'active', capabilities: [] } as never,
      ],
      activeStreamStatus: 'streaming',
      activeStreamErrorCode: 'AGENT_UPSTREAM_ERROR',
      activeStreamErrorMessage: 'Provider attach failed',
      disabled: true,
      composerValue: 'retry this turn',
    });

    expect(screen.getByTestId('chat__composer-recovery')).toBeVisible();
    expect(screen.getByTestId('chat__stream-error-recovery')).toBeVisible();
    expect(screen.getByTestId('chat__stream-error-message')).toHaveTextContent('Provider attach failed');
    expect(screen.queryByTestId('chat__composer-recovery-endpoint--ep_2')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'true');
  });

  it('keeps the composer blocked and in streaming mode while recovering', () => {
    renderChatMainPane({
      activeStreamStatus: 'recovering',
      activeStreamingAssistant: {
        messageId: null,
        content: '',
        mode: 'append',
        startedAt: Date.now(),
        lastTokenAt: Date.now(),
      },
      composerValue: 'hello',
    });

    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'true');
  });

  it('keeps the composer blocked without falling back to optimistic streaming while stopping', () => {
    renderChatMainPane({
      activeStreamStatus: 'stopping',
      activeStreamingAssistant: {
        messageId: null,
        content: '',
        mode: 'append',
        startedAt: Date.now(),
        lastTokenAt: Date.now(),
      },
      composerValue: 'hello',
    });

    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'false');
  });

  it('keeps the composer blocked in streaming mode while force stop is terminating', () => {
    renderChatMainPane({
      activeStreamStatus: 'terminating',
      composerValue: 'hello',
    });

    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'true');
  });

  it('keeps the append footer visible until the assistant message is actually in the list', () => {
    renderChatMainPane({
      disabled: true,
      activeStreamStatus: 'streaming',
      activeStreamingAssistant: {
        messageId: 'msg_assistant_1',
        content: 'partial output',
        mode: 'append',
        startedAt: Date.now(),
        lastTokenAt: Date.now(),
      },
    });

    expect(screen.getByTestId('chat__append-footer')).toBeInTheDocument();
  });
});
