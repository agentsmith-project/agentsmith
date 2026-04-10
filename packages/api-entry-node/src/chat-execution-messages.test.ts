import { describe, expect, it, vi } from 'vitest';
import { buildChatExecutionMessages } from './chat-execution-messages.js';
import type { ChatAttachmentRecord } from './resource-models.js';

function buildAttachment(overrides: Partial<ChatAttachmentRecord> = {}): ChatAttachmentRecord {
  return {
    id: overrides.id ?? 'att_1',
    workspace_id: overrides.workspace_id ?? 'ws_1',
    project_id: overrides.project_id ?? 'proj_1',
    session_id: overrides.session_id ?? 'session_1',
    file_name: overrides.file_name ?? 'image.png',
    file_type: overrides.file_type ?? 'image/png',
    file_size: overrides.file_size ?? 12,
    upload_status: overrides.upload_status ?? 'ready',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    content_base64: overrides.content_base64,
    file_library_id: overrides.file_library_id,
    source_object_key: overrides.source_object_key,
  };
}

describe('buildChatExecutionMessages', () => {
  it('inlines the current user image but degrades historical images to text placeholders', async () => {
    const historicalAttachment = buildAttachment({
      id: 'att_history',
      content_base64: Buffer.from('history').toString('base64'),
    });
    const currentAttachment = buildAttachment({
      id: 'att_current',
      content_base64: Buffer.from('current').toString('base64'),
    });

    const result = await buildChatExecutionMessages({
      downloadFileLibraryObject: vi.fn(),
      route: { workspaceId: 'ws_1', projectId: 'proj_1', sessionId: 'session_1' },
      currentUserMessageId: 'msg_current',
      attachmentById: new Map([
        [historicalAttachment.id, historicalAttachment],
        [currentAttachment.id, currentAttachment],
      ]),
      messages: [
        {
          id: 'msg_history',
          role: 'user',
          content: 'old image',
          attachment_snapshots: [
            {
              id: historicalAttachment.id,
              file_name: historicalAttachment.file_name,
              file_type: historicalAttachment.file_type,
              file_size: historicalAttachment.file_size,
            },
          ],
        },
        {
          id: 'msg_current',
          role: 'user',
          content: 'new image',
          attachment_snapshots: [
            {
              id: currentAttachment.id,
              file_name: currentAttachment.file_name,
              file_type: currentAttachment.file_type,
              file_size: currentAttachment.file_size,
            },
          ],
        },
      ],
    });

    expect(result.missingCurrentImageDataUrl).toBe(false);
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'old image' },
        { type: 'text', text: '[attached_image] image.png (image/png, 12B)' },
      ],
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'new image' },
        {
          type: 'image_url',
          image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        },
      ],
    });
  });

  it('marks missingCurrentImageDataUrl when the current image cannot be resolved', async () => {
    const missingAttachment = buildAttachment({
      id: 'att_missing',
      content_base64: undefined,
    });

    const result = await buildChatExecutionMessages({
      downloadFileLibraryObject: vi.fn(),
      route: { workspaceId: 'ws_1', projectId: 'proj_1', sessionId: 'session_1' },
      currentUserMessageId: 'msg_current',
      attachmentById: new Map([[missingAttachment.id, missingAttachment]]),
      messages: [
        {
          id: 'msg_current',
          role: 'user',
          content: 'broken image',
          attachment_snapshots: [
            {
              id: missingAttachment.id,
              file_name: missingAttachment.file_name,
              file_type: missingAttachment.file_type,
              file_size: missingAttachment.file_size,
            },
          ],
        },
      ],
    });

    expect(result.missingCurrentImageDataUrl).toBe(true);
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'broken image' }],
    });
  });
});
