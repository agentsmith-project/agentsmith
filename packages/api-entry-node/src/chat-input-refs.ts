import type { ChatAttachmentRecord } from './resource-models.js';

export type ChatLibraryObjectInputRef = {
  kind: 'library_object';
  library_id: string;
  key: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};

export function readChatLibraryObjectInputs(rawInputs: unknown): ChatLibraryObjectInputRef[] | null {
  if (rawInputs == null) return [];
  if (!Array.isArray(rawInputs)) return null;
  const out: ChatLibraryObjectInputRef[] = [];
  const seen = new Set<string>();
  for (const item of rawInputs) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (rec.kind !== 'library_object') return null;
    if (typeof rec.library_id !== 'string' || rec.library_id.length === 0) return null;
    if (typeof rec.key !== 'string' || rec.key.length === 0) return null;
    const dedupe = `${rec.library_id}:${rec.key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      kind: 'library_object',
      library_id: rec.library_id,
      key: rec.key,
      name: typeof rec.name === 'string' ? rec.name : undefined,
      content_type: typeof rec.content_type === 'string' ? rec.content_type : undefined,
      size_bytes: typeof rec.size_bytes === 'number' && rec.size_bytes >= 0 ? rec.size_bytes : undefined,
    });
  }
  return out;
}

export function libraryObjectInputRefKey(input: Pick<ChatLibraryObjectInputRef, 'library_id' | 'key'>): string {
  return `${input.library_id}:${input.key}`;
}

export function indexChatAttachmentsByLibraryObjectRef(
  attachments: ChatAttachmentRecord[],
): Map<string, ChatAttachmentRecord> {
  const byRef = new Map<string, ChatAttachmentRecord>();
  for (const attachment of attachments) {
    if (attachment.input_ref?.kind === 'library_object') {
      byRef.set(libraryObjectInputRefKey(attachment.input_ref), attachment);
    }
  }
  return byRef;
}

export function resolveChatInputsFromAttachmentIndex(
  inputs: ChatLibraryObjectInputRef[],
  byRef: Map<string, ChatAttachmentRecord>,
): Array<ChatAttachmentRecord | null> {
  return inputs.map((input) => byRef.get(libraryObjectInputRefKey(input)) ?? null);
}

export function toChatAttachmentSnapshots(attachments: ChatAttachmentRecord[]): Array<{
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  input_ref?: ChatAttachmentRecord['input_ref'];
  source_type?: ChatAttachmentRecord['source_type'];
  source_library_id?: ChatAttachmentRecord['source_library_id'];
  source_object_key?: ChatAttachmentRecord['source_object_key'];
}> {
  return attachments.map((attachment) => ({
    id: attachment.id,
    file_name: attachment.file_name,
    file_type: attachment.file_type,
    file_size: attachment.file_size,
    input_ref: attachment.input_ref,
    source_type: attachment.source_type,
    source_library_id: attachment.source_library_id,
    source_object_key: attachment.source_object_key,
  }));
}

