import { describe, expect, it } from 'vitest';
import {
  indexChatAttachmentsByLibraryObjectRef,
  readChatMessageInputs,
  resolveChatInputsFromAttachmentIndex,
  toChatAttachmentSnapshots,
} from './chat-input-refs.js';
import type { ChatAttachmentRecord } from './resource-models.js';

describe('chat-input-refs', () => {
  it('parses and deduplicates chat input refs (library_object + url)', () => {
    const parsed = readChatMessageInputs([
      { kind: 'library_object', library_id: 'lib_1', key: 'a.txt', name: 'A' },
      { kind: 'library_object', library_id: 'lib_1', key: 'a.txt', name: 'A duplicate' },
      { kind: 'library_object', library_id: 'lib_1', key: 'b.txt' },
      { kind: 'url', url: 'https://example.com/a' },
      { kind: 'url', url: 'https://example.com/a', name: 'dup' },
    ]);
    expect(parsed).toEqual([
      { kind: 'library_object', library_id: 'lib_1', key: 'a.txt', name: 'A' },
      { kind: 'library_object', library_id: 'lib_1', key: 'b.txt' },
      { kind: 'url', url: 'https://example.com/a' },
    ]);
  });

  it('indexes attachments and resolves inputs in-order', () => {
    const attachments: ChatAttachmentRecord[] = [
      {
        id: 'att_1',
        workspace_id: 'ws',
        project_id: 'prj',
        session_id: 'sess',
        file_name: 'a.txt',
        file_type: 'text/plain',
        file_size: 1,
        upload_status: 'ready',
        created_at: '2026-01-01T00:00:00.000Z',
        input_ref: { kind: 'library_object', library_id: 'lib', key: 'a.txt' },
      },
      {
        id: 'att_2',
        workspace_id: 'ws',
        project_id: 'prj',
        session_id: 'sess',
        file_name: 'b.txt',
        file_type: 'text/plain',
        file_size: 2,
        upload_status: 'ready',
        created_at: '2026-01-01T00:00:00.000Z',
        input_ref: { kind: 'library_object', library_id: 'lib', key: 'b.txt' },
      },
      {
        id: 'att_3',
        workspace_id: 'ws',
        project_id: 'prj',
        session_id: 'sess',
        file_name: 'url.txt',
        file_type: 'text/plain',
        file_size: 3,
        upload_status: 'ready',
        created_at: '2026-01-01T00:00:00.000Z',
        input_ref: {
          kind: 'url',
          url: 'https://example.com/a',
          imported_library_id: 'lib',
          imported_key: 'url.txt',
        },
      },
    ];
    const byRef = indexChatAttachmentsByLibraryObjectRef(attachments);
    const resolved = resolveChatInputsFromAttachmentIndex(
      [
        { kind: 'library_object', library_id: 'lib', key: 'b.txt' },
        { kind: 'url', url: 'https://example.com/a', imported_library_id: 'lib', imported_key: 'url.txt' },
        { kind: 'library_object', library_id: 'lib', key: 'a.txt' },
        { kind: 'url', url: 'https://example.com/unknown' },
      ],
      byRef,
    );
    expect(resolved.map((item) => item?.id ?? null)).toEqual(['att_2', 'att_3', 'att_1', null]);
  });

  it('maps attachments to message attachment snapshots', () => {
    const snapshots = toChatAttachmentSnapshots([
      {
        id: 'att_1',
        workspace_id: 'ws',
        project_id: 'prj',
        session_id: 'sess',
        file_name: 'a.txt',
        file_type: 'text/plain',
        file_size: 1,
        upload_status: 'ready',
        created_at: '2026-01-01T00:00:00.000Z',
        input_ref: { kind: 'library_object', library_id: 'lib', key: 'a.txt' },
        source_type: 'library_import',
        file_library_id: 'lib',
        source_object_key: 'a.txt',
      },
    ]);
    expect(snapshots).toEqual([
      {
        id: 'att_1',
        file_name: 'a.txt',
        file_type: 'text/plain',
        file_size: 1,
        input_ref: { kind: 'library_object', library_id: 'lib', key: 'a.txt' },
        source_type: 'library_import',
        file_library_id: 'lib',
        source_object_key: 'a.txt',
      },
    ]);
  });
});
