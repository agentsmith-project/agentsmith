import type { Attachment } from '@/lib/api/types';
import type { ChatAttachmentInputRef, InputRef } from '@/lib/types/input-ref';
import type { TaskAttachedInputDetail } from '@/lib/types/task';

export function getInputRefKindLabel(kind: InputRef['kind'] | ChatAttachmentInputRef['kind']): string {
  switch (kind) {
    case 'library_object':
      return 'Library object';
    case 'url':
      return 'URL';
    case 'artifact':
      return 'Artifact';
    default:
      return 'Input';
  }
}

export function getTaskAttachedInputKindLabel(input: TaskAttachedInputDetail): string {
  return getInputRefKindLabel(input.kind);
}

export function getChatAttachmentInputRefLabel(attachment: Attachment): string | null {
  if (attachment.input_ref) {
    return getInputRefKindLabel(attachment.input_ref.kind);
  }
  if (attachment.source_type === 'library_import') {
    return 'Library object';
  }
  if (attachment.source_type === 'local_upload') {
    return 'Local upload';
  }
  return null;
}
