import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatMainPane } from '../ChatMainPane';

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

beforeEach(() => {
  composerMock.mockClear();
  messageListMock.mockClear();
});

describe('ChatMainPane', () => {
  it('keeps the no-thread surface informational so the header owns the only primary CTA', () => {
    render(
      <ChatMainPane
        currentSessionId={null}
        activeSession={null}
        endpoints={[]}
        messages={[]}
        messagesLoading={false}
        attachments={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        disabled={false}
        activeStreamStatus="idle"
        activeStreamingAssistant={null}
        suppressAutoScroll={false}
        createPending={false}
        createMessagePending={false}
        editMessagePending={false}
        initAttachmentPending={false}
        canUseChat
        canAttachFiles={false}
        composerValue=""
        fileInputRef={{ current: null }}
        labels={{
          loading: 'loading',
          noActiveThreadTitle: 'noActiveThreadTitle',
          noActiveThreadDescription: 'noActiveThreadDescription',
          noActiveThreadHint: 'noActiveThreadHint',
          noEndpointHint: 'noEndpointHint',
          noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
          noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
          noEndpointRecoveryHint: 'noEndpointRecoveryHint',
          newThread: 'newThread',
          selectThreadHint: 'selectThreadHint',
          attachmentsDisabledReason: 'attachmentsDisabledReason',
          assistant: 'assistant',
        }}
        layoutMode="standard"
        onCreateThread={vi.fn()}
        onRenameActiveSession={vi.fn()}
        onSelectActiveEndpoint={vi.fn()}
        onSelectExternalAgent={vi.fn()}
        onSelectVariant={vi.fn()}
        onEditMessage={vi.fn()}
        onEditCommit={vi.fn()}
        onRegenerate={vi.fn()}
        onComposerChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFromLibrary={vi.fn()}
        onPickUrl={vi.fn()}
        onFilePicked={vi.fn()}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat__main-empty-state')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadTitle')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadDescription')).toBeInTheDocument();
    expect(screen.getByText('noActiveThreadHint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'newThread' })).not.toBeInTheDocument();
  });

  it('keeps the recovery state inline as a distinct work shelf', () => {
    render(
      <ChatMainPane
        currentSessionId="session_1"
        activeSession={{ id: 'session_1', project_id: 'proj_1', title: 'Session', endpoint_id: '', model: '' } as never}
        endpoints={[{ id: 'ep_1', name: 'GPT-4', capabilities: [] } as never]}
        messages={[]}
        messagesLoading={false}
        attachments={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        disabled={false}
        activeStreamStatus="idle"
        activeStreamingAssistant={null}
        suppressAutoScroll={false}
        createPending={false}
        createMessagePending={false}
        editMessagePending={false}
        initAttachmentPending={false}
        canUseChat
        canAttachFiles={false}
        composerValue=""
        fileInputRef={{ current: null }}
        labels={{
          loading: 'loading',
          noActiveThreadTitle: 'noActiveThreadTitle',
          noActiveThreadDescription: 'noActiveThreadDescription',
          noActiveThreadHint: 'noActiveThreadHint',
          noEndpointHint: 'noEndpointHint',
          noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
          noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
          noEndpointRecoveryHint: 'noEndpointRecoveryHint',
          newThread: 'newThread',
          selectThreadHint: 'selectThreadHint',
          attachmentsDisabledReason: 'attachmentsDisabledReason',
          assistant: 'assistant',
        }}
        layoutMode="standard"
        onCreateThread={vi.fn()}
        onRenameActiveSession={vi.fn()}
        onSelectActiveEndpoint={vi.fn()}
        onSelectExternalAgent={vi.fn()}
        onSelectVariant={vi.fn()}
        onEditMessage={vi.fn()}
        onEditCommit={vi.fn()}
        onRegenerate={vi.fn()}
        onComposerChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFromLibrary={vi.fn()}
        onPickUrl={vi.fn()}
        onFilePicked={vi.fn()}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat__main-pane').className).not.toContain('gradient');
    expect(screen.getByTestId('chat__composer-recovery').className).toContain('border-t');
    expect(screen.getByTestId('chat__composer-recovery-shell')).toHaveClass('rounded-xl', 'border', 'shadow-ambient');
    expect(screen.getByTestId('chat__message-list')).toBeInTheDocument();
  });

  it('keeps the composer blocked and in streaming mode while recovering', () => {
    render(
      <ChatMainPane
        currentSessionId="session_1"
        activeSession={{ id: 'session_1', project_id: 'proj_1', title: 'Session', endpoint_id: 'ep_1', model: 'gpt-4o' } as never}
        endpoints={[]}
        messages={[]}
        messagesLoading={false}
        attachments={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        disabled={false}
        activeStreamStatus="recovering"
        activeStreamingAssistant={{
          messageId: null,
          content: '',
          mode: 'append',
          startedAt: Date.now(),
          lastTokenAt: Date.now(),
        }}
        suppressAutoScroll={false}
        createPending={false}
        createMessagePending={false}
        editMessagePending={false}
        initAttachmentPending={false}
        canUseChat
        canAttachFiles
        composerValue="hello"
        fileInputRef={{ current: null }}
        labels={{
          loading: 'loading',
          noActiveThreadTitle: 'noActiveThreadTitle',
          noActiveThreadDescription: 'noActiveThreadDescription',
          noActiveThreadHint: 'noActiveThreadHint',
          noEndpointHint: 'noEndpointHint',
          noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
          noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
          noEndpointRecoveryHint: 'noEndpointRecoveryHint',
          newThread: 'newThread',
          selectThreadHint: 'selectThreadHint',
          attachmentsDisabledReason: 'attachmentsDisabledReason',
          assistant: 'assistant',
        }}
        layoutMode="standard"
        onCreateThread={vi.fn()}
        onRenameActiveSession={vi.fn()}
        onSelectActiveEndpoint={vi.fn()}
        onSelectExternalAgent={vi.fn()}
        onSelectVariant={vi.fn()}
        onEditMessage={vi.fn()}
        onEditCommit={vi.fn()}
        onRegenerate={vi.fn()}
        onComposerChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFromLibrary={vi.fn()}
        onPickUrl={vi.fn()}
        onFilePicked={vi.fn()}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'true');
  });

  it('keeps the composer blocked without falling back to optimistic streaming while stopping', () => {
    render(
      <ChatMainPane
        currentSessionId="session_1"
        activeSession={{ id: 'session_1', project_id: 'proj_1', title: 'Session', endpoint_id: 'ep_1', model: 'gpt-4o' } as never}
        endpoints={[]}
        messages={[]}
        messagesLoading={false}
        attachments={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        disabled={false}
        activeStreamStatus="stopping"
        activeStreamingAssistant={{
          messageId: null,
          content: '',
          mode: 'append',
          startedAt: Date.now(),
          lastTokenAt: Date.now(),
        }}
        suppressAutoScroll={false}
        createPending={false}
        createMessagePending={false}
        editMessagePending={false}
        initAttachmentPending={false}
        canUseChat
        canAttachFiles
        composerValue="hello"
        fileInputRef={{ current: null }}
        labels={{
          loading: 'loading',
          noActiveThreadTitle: 'noActiveThreadTitle',
          noActiveThreadDescription: 'noActiveThreadDescription',
          noActiveThreadHint: 'noActiveThreadHint',
          noEndpointHint: 'noEndpointHint',
          noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
          noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
          noEndpointRecoveryHint: 'noEndpointRecoveryHint',
          newThread: 'newThread',
          selectThreadHint: 'selectThreadHint',
          attachmentsDisabledReason: 'attachmentsDisabledReason',
          assistant: 'assistant',
        }}
        layoutMode="standard"
        onCreateThread={vi.fn()}
        onRenameActiveSession={vi.fn()}
        onSelectActiveEndpoint={vi.fn()}
        onSelectExternalAgent={vi.fn()}
        onSelectVariant={vi.fn()}
        onEditMessage={vi.fn()}
        onEditCommit={vi.fn()}
        onRegenerate={vi.fn()}
        onComposerChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFromLibrary={vi.fn()}
        onPickUrl={vi.fn()}
        onFilePicked={vi.fn()}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat__composer')).toHaveAttribute('data-streaming', 'false');
  });

  it('keeps the append footer visible until the assistant message is actually in the list', () => {
    render(
      <ChatMainPane
        currentSessionId="session_1"
        activeSession={{ id: 'session_1', project_id: 'proj_1', title: 'Session', endpoint_id: 'ep_1', model: 'gpt-4o' } as never}
        endpoints={[]}
        messages={[]}
        messagesLoading={false}
        attachments={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        disabled={true}
        activeStreamStatus="streaming"
        activeStreamingAssistant={{
          messageId: 'msg_assistant_1',
          content: 'partial output',
          mode: 'append',
          startedAt: Date.now(),
          lastTokenAt: Date.now(),
        }}
        suppressAutoScroll={false}
        createPending={false}
        createMessagePending={false}
        editMessagePending={false}
        initAttachmentPending={false}
        canUseChat
        canAttachFiles
        composerValue=""
        fileInputRef={{ current: null }}
        labels={{
          loading: 'loading',
          noActiveThreadTitle: 'noActiveThreadTitle',
          noActiveThreadDescription: 'noActiveThreadDescription',
          noActiveThreadHint: 'noActiveThreadHint',
          noEndpointHint: 'noEndpointHint',
          noEndpointRecoveryTitle: 'noEndpointRecoveryTitle',
          noEndpointRecoveryDescription: 'noEndpointRecoveryDescription',
          noEndpointRecoveryHint: 'noEndpointRecoveryHint',
          newThread: 'newThread',
          selectThreadHint: 'selectThreadHint',
          attachmentsDisabledReason: 'attachmentsDisabledReason',
          assistant: 'assistant',
        }}
        layoutMode="standard"
        onCreateThread={vi.fn()}
        onRenameActiveSession={vi.fn()}
        onSelectActiveEndpoint={vi.fn()}
        onSelectExternalAgent={vi.fn()}
        onSelectVariant={vi.fn()}
        onEditMessage={vi.fn()}
        onEditCommit={vi.fn()}
        onRegenerate={vi.fn()}
        onComposerChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPickFiles={vi.fn()}
        onPickFromLibrary={vi.fn()}
        onPickUrl={vi.fn()}
        onFilePicked={vi.fn()}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onRetryAttachment={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat__append-footer')).toBeInTheDocument();
  });
});
