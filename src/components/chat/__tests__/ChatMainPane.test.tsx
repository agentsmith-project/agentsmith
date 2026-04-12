import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatMainPane } from '../ChatMainPane';

vi.mock('@/components/chat/ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat__header" />,
}));

vi.mock('@/components/chat/Composer', () => ({
  Composer: () => <div data-testid="chat__composer" />,
}));

vi.mock('@/components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="chat__message-list" />,
}));

vi.mock('@/components/chat/chat-main-pane/ChatEmptyState', () => ({
  ChatEmptyState: () => <div data-testid="chat__empty-state" />,
}));

vi.mock('@/components/chat/chat-main-pane/ChatLoadingState', () => ({
  ChatLoadingState: () => <div data-testid="chat__loading-state" />,
}));

vi.mock('@/components/chat/chat-main-pane/StreamingAppendFooter', () => ({
  StreamingAppendFooter: () => <div data-testid="chat__append-footer" />,
}));

describe('ChatMainPane', () => {
  it('keeps the recovery state inline and drops the local gradient', () => {
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

    expect(screen.getByTestId('chat__main-pane').className).not.toContain('bg-[linear-gradient');
    expect(screen.getByTestId('chat__composer-recovery').className).not.toContain('bg-surface-low');
    expect(screen.getByTestId('chat__composer-recovery').className).not.toContain('border-b');
    expect(screen.getByTestId('chat__composer-recovery').className).not.toContain('rounded-md');
    expect(screen.getByTestId('chat__message-list')).toBeInTheDocument();
  });
});
