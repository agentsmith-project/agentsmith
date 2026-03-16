import type { ChatAttachmentRecord } from './resource-models.js';
import {
  appendUniqueByKey,
  getImportedLibraryObjectRef,
  libraryObjectRefKey,
  urlRefKey,
} from './input-ref-resolver.js';

export type ChatLibraryObjectInputRef = {
  kind: 'library_object';
  library_id: string;
  key: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};

export type ChatUrlInputRef = {
  kind: 'url';
  url: string;
  imported_library_id?: string;
  imported_key?: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};

export type ChatMessageInputRef = ChatLibraryObjectInputRef | ChatUrlInputRef;

export function readChatMessageInputs(rawInputs: unknown): ChatMessageInputRef[] | null {
  if (rawInputs == null) return [];
  if (!Array.isArray(rawInputs)) return null;
  const out: ChatMessageInputRef[] = [];
  const seen = new Set<string>();
  for (const item of rawInputs) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (rec.kind === 'library_object') {
      if (typeof rec.library_id !== 'string' || rec.library_id.length === 0) return null;
      if (typeof rec.key !== 'string' || rec.key.length === 0) return null;
      appendUniqueByKey({
        items: out,
        seen,
        key: `library_object:${libraryObjectRefKey({ library_id: rec.library_id, key: rec.key })}`,
        value: {
          kind: 'library_object',
          library_id: rec.library_id,
          key: rec.key,
          name: typeof rec.name === 'string' ? rec.name : undefined,
          content_type: typeof rec.content_type === 'string' ? rec.content_type : undefined,
          size_bytes: typeof rec.size_bytes === 'number' && rec.size_bytes >= 0 ? rec.size_bytes : undefined,
        },
      });
      continue;
    }
    if (rec.kind === 'url') {
      if (typeof rec.url !== 'string' || rec.url.length === 0) return null;
      appendUniqueByKey({
        items: out,
        seen,
        key: urlRefKey({ url: rec.url }),
        value: {
          kind: 'url',
          url: rec.url,
          imported_library_id: typeof rec.imported_library_id === 'string' ? rec.imported_library_id : undefined,
          imported_key: typeof rec.imported_key === 'string' ? rec.imported_key : undefined,
          name: typeof rec.name === 'string' ? rec.name : undefined,
          content_type: typeof rec.content_type === 'string' ? rec.content_type : undefined,
          size_bytes: typeof rec.size_bytes === 'number' && rec.size_bytes >= 0 ? rec.size_bytes : undefined,
        },
      });
      continue;
    }
    return null;
  }
  return out;
}

export function indexChatAttachmentsByLibraryObjectRef(
  attachments: ChatAttachmentRecord[],
): Map<string, ChatAttachmentRecord> {
  const byRef = new Map<string, ChatAttachmentRecord>();
  for (const attachment of attachments) {
    if (attachment.input_ref?.kind === 'library_object') {
      if (attachment.input_ref.library_id && attachment.input_ref.key) {
        byRef.set(libraryObjectRefKey({
          library_id: attachment.input_ref.library_id,
          key: attachment.input_ref.key,
        }), attachment);
      }
    } else if (attachment.input_ref?.kind === 'url') {
      const importedObjectRef = getImportedLibraryObjectRef(attachment.input_ref);
      if (importedObjectRef) {
        byRef.set(
          libraryObjectRefKey(importedObjectRef),
          attachment,
        );
      }
      if (attachment.input_ref.url) {
        byRef.set(urlRefKey({ url: attachment.input_ref.url }), attachment);
      }
    }
  }
  return byRef;
}

export function resolveChatInputsFromAttachmentIndex(
  inputs: ChatMessageInputRef[],
  byRef: Map<string, ChatAttachmentRecord>,
): Array<ChatAttachmentRecord | null> {
  return inputs.map((input) => {
    if (input.kind === 'library_object') {
      return byRef.get(libraryObjectRefKey(input)) ?? null;
    }
    const importedObjectRef = getImportedLibraryObjectRef(input);
    if (importedObjectRef) {
      return byRef.get(libraryObjectRefKey(importedObjectRef)) ?? byRef.get(urlRefKey(input)) ?? null;
    }
    return byRef.get(urlRefKey(input)) ?? null;
  });
}

export function toChatAttachmentSnapshots(attachments: ChatAttachmentRecord[]): Array<{
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  input_ref?: ChatAttachmentRecord['input_ref'];
  source_type?: ChatAttachmentRecord['source_type'];
  file_library_id?: ChatAttachmentRecord['file_library_id'];
  source_object_key?: ChatAttachmentRecord['source_object_key'];
}> {
  return attachments.map((attachment) => ({
    id: attachment.id,
    file_name: attachment.file_name,
    file_type: attachment.file_type,
    file_size: attachment.file_size,
    input_ref: attachment.input_ref,
    source_type: attachment.source_type,
    file_library_id: attachment.file_library_id,
    source_object_key: attachment.source_object_key,
  }));
}
