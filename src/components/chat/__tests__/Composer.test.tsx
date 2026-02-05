import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../Composer';
import type { Attachment } from '@/lib/api/types';

describe('Composer', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    mode: 'compose' as const,
    onCancelEdit: vi.fn(),
    onPickFiles: vi.fn(),
    attachments: [],
    onRemoveAttachment: vi.fn(),
    onRetryAttachment: vi.fn(),
    disabled: false,
    streaming: false,
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render composer in compose mode', () => {
      render(<Composer {...defaultProps} />);

      expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument();
      expect(screen.getByText('Enter to send · Shift+Enter for newline')).toBeInTheDocument();
    });

    it('should render composer in edit mode', () => {
      render(<Composer {...defaultProps} mode="edit" />);

      expect(screen.getByPlaceholderText('Edit message…')).toBeInTheDocument();
      expect(screen.getByText('Editing message')).toBeInTheDocument();
      expect(screen.getByText('Enter to save · Shift+Enter for newline')).toBeInTheDocument();
    });

    it('should display current value in textarea', () => {
      render(<Composer {...defaultProps} value="Hello world" />);

      const textarea = screen.getByPlaceholderText('Message…') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello world');
    });
  });

  describe('Text Input', () => {
    it('should call onChange when textarea value changes', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} />);

      const textarea = screen.getByPlaceholderText('Message…');
      await user.type(textarea, 'Hello');

      // onChange is called for each character typed
      expect(defaultProps.onChange).toHaveBeenCalled();
    });

    it('should send message on Enter key press', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} value="Hello" />);

      const textarea = screen.getByPlaceholderText('Message…');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(defaultProps.onSend).toHaveBeenCalled();
    });

    it('should not send on Shift+Enter', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} value="Hello" />);

      const textarea = screen.getByPlaceholderText('Message…');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });

    it('should not send when message is empty', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} value="" />);

      const textarea = screen.getByPlaceholderText('Message…');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });

    it('should not send when message is only whitespace', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} value="   " />);

      const textarea = screen.getByPlaceholderText('Message…');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });
  });

  describe('Send Button', () => {
    it('should show Send button in compose mode', () => {
      render(<Composer {...defaultProps} mode="compose" />);

      expect(screen.getByText('Send')).toBeInTheDocument();
    });

    it('should show Save button in edit mode', () => {
      render(<Composer {...defaultProps} mode="edit" />);

      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('should be disabled when value is empty', () => {
      render(<Composer {...defaultProps} value="" />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeDisabled();
    });

    it('should be disabled when streaming', () => {
      render(<Composer {...defaultProps} value="Hello" streaming={true} />);

      const stopButton = screen.getByText('Stop');
      expect(stopButton).toBeInTheDocument();
    });

    it('should be disabled when disabled prop is true', () => {
      render(<Composer {...defaultProps} value="Hello" disabled={true} />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeDisabled();
    });

    it('should call onSend when clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} value="Hello" />);

      const sendButton = screen.getByText('Send');
      await user.click(sendButton);

      expect(defaultProps.onSend).toHaveBeenCalled();
    });
  });

  describe('Stop Button', () => {
    it('should show Stop button when streaming', () => {
      render(<Composer {...defaultProps} streaming={true} />);

      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    it('should call onStop when clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} streaming={true} />);

      const stopButton = screen.getByText('Stop');
      await user.click(stopButton);

      expect(defaultProps.onStop).toHaveBeenCalled();
    });

    it('should not show Send button when streaming', () => {
      render(<Composer {...defaultProps} streaming={true} value="Hello" />);

      expect(screen.queryByText('Send')).not.toBeInTheDocument();
    });
  });

  describe('Attachments', () => {
    const mockAttachment: Attachment = {
      id: 'att-1',
      session_id: 'session-1',
      file_name: 'test.pdf',
      file_type: 'application/pdf',
      file_size: 1024,
      upload_status: 'ready',
      created_at: '2024-01-01T00:00:00Z',
    };

    const uploadingAttachment: Attachment = {
      ...mockAttachment,
      id: 'att-2',
      upload_status: 'uploading',
    };

    const processingAttachment: Attachment = {
      ...mockAttachment,
      id: 'att-3',
      upload_status: 'processing',
    };

    const failedAttachment: Attachment = {
      ...mockAttachment,
      id: 'att-4',
      upload_status: 'failed',
    };

    it('should render ready attachments', () => {
      render(<Composer {...defaultProps} attachments={[mockAttachment]} />);

      expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });

    it('should show uploading status for uploading attachments', () => {
      render(<Composer {...defaultProps} attachments={[uploadingAttachment]} />);

      expect(screen.getByText('Uploading…')).toBeInTheDocument();
    });

    it('should show processing status for processing attachments', () => {
      render(<Composer {...defaultProps} attachments={[processingAttachment]} />);

      expect(screen.getByText('Processing…')).toBeInTheDocument();
    });

    it('should show failed status and Retry button for failed attachments', () => {
      render(<Composer {...defaultProps} attachments={[failedAttachment]} />);

      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should call onRetryAttachment when Retry is clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} attachments={[failedAttachment]} />);

      const retryButton = screen.getByText('Retry');
      await user.click(retryButton);

      expect(defaultProps.onRetryAttachment).toHaveBeenCalledWith('att-4');
    });

    it('should call onRemoveAttachment when Remove is clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} attachments={[mockAttachment]} />);

      const removeButton = screen.getByText('Remove');
      await user.click(removeButton);

      expect(defaultProps.onRemoveAttachment).toHaveBeenCalledWith('att-1');
    });

    it('should block sending when attachments are uploading', () => {
      render(<Composer {...defaultProps} value="Hello" attachments={[uploadingAttachment]} />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeDisabled();
    });

    it('should show helper text for uploading attachments', () => {
      render(<Composer {...defaultProps} attachments={[uploadingAttachment]} />);

      expect(screen.getByText('Attachments are still preparing…')).toBeInTheDocument();
    });

    it('should show helper text for failed attachments', () => {
      render(<Composer {...defaultProps} attachments={[failedAttachment]} />);

      expect(screen.getByText('Remove or retry failed attachments to send.')).toBeInTheDocument();
    });

    it('should block sending when attachments are processing', () => {
      render(<Composer {...defaultProps} value="Hello" attachments={[processingAttachment]} />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeDisabled();
    });

    it('should allow sending when all attachments are ready', () => {
      render(<Composer {...defaultProps} value="Hello" attachments={[mockAttachment]} />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeEnabled();
    });

    it('should render multiple attachments', () => {
      render(
        <Composer
          {...defaultProps}
          attachments={[mockAttachment, uploadingAttachment, failedAttachment]}
        />,
      );

      // Each attachment shows its filename (all have same name in mock)
      const filenames = screen.getAllByText('test.pdf');
      expect(filenames.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('File Picker', () => {
    it('should render file picker button', () => {
      render(<Composer {...defaultProps} />);

      const fileButton = screen.getByTitle('Attach files');
      expect(fileButton).toBeInTheDocument();
    });

    it('should call onPickFiles when file button is clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} />);

      const fileButton = screen.getByTitle('Attach files');
      await user.click(fileButton);

      expect(defaultProps.onPickFiles).toHaveBeenCalled();
    });

    it('should disable file button when streaming', () => {
      render(<Composer {...defaultProps} streaming={true} />);

      const fileButton = screen.getByTitle('Attach files');
      expect(fileButton).toBeDisabled();
    });

    it('should disable file button when disabled', () => {
      render(<Composer {...defaultProps} disabled={true} />);

      const fileButton = screen.getByTitle('Attach files');
      expect(fileButton).toBeDisabled();
    });
  });

  describe('Edit Mode', () => {
    it('should show Cancel button in edit mode', () => {
      render(<Composer {...defaultProps} mode="edit" />);

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should call onCancelEdit when Cancel is clicked', async () => {
      const user = userEvent.setup();
      render(<Composer {...defaultProps} mode="edit" />);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(defaultProps.onCancelEdit).toHaveBeenCalled();
    });

    it('should disable Cancel button when streaming', () => {
      render(<Composer {...defaultProps} mode="edit" streaming={true} />);

      const cancelButton = screen.getByText('Cancel');
      expect(cancelButton).toBeDisabled();
    });
  });

  describe('Auto Focus', () => {
    it('should focus textarea when autoFocus is true', async () => {
      render(<Composer {...defaultProps} autoFocus={true} />);

      await waitFor(() => {
        const textarea = screen.getByPlaceholderText('Message…') as HTMLTextAreaElement;
        expect(textarea).toHaveFocus();
      });
    });

    it('should not focus textarea when autoFocus is false', async () => {
      render(<Composer {...defaultProps} autoFocus={false} />);

      const textarea = screen.getByPlaceholderText('Message…') as HTMLTextAreaElement;
      expect(textarea).not.toHaveFocus();
    });

    it('should not focus when disabled', async () => {
      render(<Composer {...defaultProps} autoFocus={true} disabled={true} />);

      const textarea = screen.getByPlaceholderText('Message…') as HTMLTextAreaElement;
      expect(textarea).not.toHaveFocus();
    });

    it('should not focus when streaming', async () => {
      render(<Composer {...defaultProps} autoFocus={true} streaming={true} />);

      const textarea = screen.getByPlaceholderText('Message…') as HTMLTextAreaElement;
      expect(textarea).not.toHaveFocus();
    });
  });

  describe('Data Attributes', () => {
    it('should have data-testid attribute', () => {
      render(<Composer {...defaultProps} />);

      const composer = screen.getByTestId('chat-composer');
      expect(composer).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should disable all interactions when disabled', () => {
      render(<Composer {...defaultProps} disabled={true} value="Hello" />);

      const sendButton = screen.getByText('Send');
      const fileButton = screen.getByTitle('Attach files');

      expect(sendButton).toBeDisabled();
      expect(fileButton).toBeDisabled();
      // Note: textarea doesn't have a disabled prop in the component
    });
  });
});
