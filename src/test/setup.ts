import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    pathname: '/',
    query: {},
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  useParams: () => ({
    workspace: 'ws_default',
    project: 'proj_001',
  }),
  usePathname: () => '/',
}));

// Mock next-intl
const TEST_TRANSLATIONS: Record<string, string> = {
  'composer.editing_message': 'Editing message',
  'composer.cancel': 'Cancel',
  'composer.helper_failed_attachments': 'Remove or retry failed attachments to send.',
  'composer.helper_attachments_preparing': 'Attachments are still preparing…',
  'composer.attachment_status_uploading': 'Uploading…',
  'composer.attachment_status_processing': 'Processing…',
  'composer.attachment_status_failed': 'Failed',
  'composer.retry': 'Retry',
  'composer.remove': 'Remove',
  'composer.attach_files': 'Attach files',
  'composer.placeholder_edit': 'Edit message…',
  'composer.placeholder_compose': 'Message…',
  'composer.stop': 'Stop',
  'composer.save': 'Save',
  'composer.send': 'Send',
  'composer.hotkey_edit': 'Enter to save · Shift+Enter for newline',
  'composer.hotkey_compose': 'Enter to send · Shift+Enter for newline',
  'header.status_generating': 'Generating…',
  'header.status_stopped': 'Stopped',
  'header.status_error': 'Error',
  'header.layout_standard': 'Standard',
  'header.layout_ultrawide': 'Ultrawide',
  'header.switch_to_standard': 'Switch to standard layout',
  'header.switch_to_ultrawide': 'Switch to ultrawide layout',
  'switch_to_standard': 'Switch to standard layout',
  'switch_to_ultrawide': 'Switch to ultrawide layout',
  'layout_standard': 'Standard',
  'layout_ultrawide': 'Ultrawide',
  'header.rename_thread': 'Rename thread',
  'header.default_title': 'Chat',
  'header.select_model': 'Select model',
  'header.models': 'Models',
  'header.no_endpoints': 'No endpoints',
  'header.disabled': 'Disabled',
  'thread_item.untitled': 'Untitled',
  'thread_item.actions': 'Thread actions',
  'thread_item.rename': 'Rename',
  'thread_item.star': 'Star',
  'thread_item.unstar': 'Unstar',
  'thread_item.pin': 'Pin',
  'thread_item.unpin': 'Unpin',
  'thread_item.delete': 'Delete',
  thread_generating: 'Generating',
  'message_list.empty': 'Start a conversation...',
  'message_list.jump_to_latest': 'Jump to latest',
  'message_item.older_branch': 'Older branch',
  'message_item.regenerating': 'Regenerating…',
  'message_item.preview_changes': 'Preview changes',
  'message_item.hide_diff': 'Hide diff',
  'message_item.show_diff': 'Show diff',
  'message_item.original': 'Original',
  'message_item.edited': 'Edited',
  'message_item.edit': 'Edit',
  'message_item.save': 'Save',
  'message_item.cancel': 'Cancel',
  'message_item.regenerate': 'Regenerate',
  'message_item.prev_variant': 'Previous variant',
  'message_item.next_variant': 'Next variant',
  'message_item.copy': 'Copy',
  'streaming_failed': 'Streaming failed',
  'stream_error': 'Stream error',
  'upload_failed': 'Upload failed',
  assistant: 'Assistant',
};

function mockTranslate(
  key: string,
  values?: Record<string, string | number | Date>,
): string {
  const template = TEST_TRANSLATIONS[key];
  if (!template) return key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number | Date>) => mockTranslate(key, values),
  useLocale: () => 'en-US',
}));
