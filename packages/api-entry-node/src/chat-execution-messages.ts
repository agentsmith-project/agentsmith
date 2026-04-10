import { Readable } from 'node:stream';
import { resolveImageMimeType, toImageDataUrl } from './chat-image-utils.js';
import type { ChatAttachmentRecord } from './resource-models.js';

type AttachmentSnapshot = {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
};

type ChatMessageInput = {
  id: string;
  role: string;
  content: string;
  attachment_snapshots?: AttachmentSnapshot[];
};

type DownloadFileLibraryObject = (args: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  key: string;
}) => Promise<{ body: ReadableStream<Uint8Array> }>;

function toDataUrl(attachment: ChatAttachmentRecord, mimeType: string | null): string | null {
  return toImageDataUrl(attachment.content_base64, mimeType);
}

async function toDataUrlFromAttachmentOrFileLibraryObject(
  downloadFileLibraryObject: DownloadFileLibraryObject,
  route: { workspaceId: string; projectId: string },
  attachment: ChatAttachmentRecord,
  mimeType: string | null,
): Promise<string | null> {
  const inline = toDataUrl(attachment, mimeType);
  if (inline) return inline;
  if (!mimeType || !attachment.file_library_id || !attachment.source_object_key) return null;
  try {
    const downloaded = await downloadFileLibraryObject({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: attachment.file_library_id,
      key: attachment.source_object_key,
    });
    const nodeStream = Readable.fromWeb(downloaded.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    const chunks: Buffer[] = [];
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return `data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch {
    return null;
  }
}

function buildHistoricalAttachmentText(
  snapshot: AttachmentSnapshot,
  kind: 'image' | 'file',
): { type: 'text'; text: string } {
  const prefix = kind === 'image' ? '[attached_image]' : '[attached_file]';
  return {
    type: 'text',
    text: `${prefix} ${snapshot.file_name} (${snapshot.file_type}, ${snapshot.file_size}B)`,
  };
}

export async function buildChatExecutionMessages(args: {
  downloadFileLibraryObject: DownloadFileLibraryObject;
  route: { workspaceId: string; projectId: string; sessionId: string };
  messages: ChatMessageInput[];
  attachmentById: Map<string, ChatAttachmentRecord>;
  currentUserMessageId: string;
}): Promise<{
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  missingCurrentImageDataUrl: boolean;
}> {
  let missingCurrentImageDataUrl = false;
  const upstreamMessages = await Promise.all(args.messages.map(async (item) => {
    if (item.role !== 'user' || !item.attachment_snapshots || item.attachment_snapshots.length === 0) {
      return { role: item.role, content: item.content };
    }
    const allowInlineImages = item.id === args.currentUserMessageId;
    const parts: Array<Record<string, unknown>> = [];
    if (item.content.trim().length > 0) {
      parts.push({ type: 'text', text: item.content });
    }
    for (const snapshot of item.attachment_snapshots) {
      const attachment = args.attachmentById.get(snapshot.id);
      const imageMimeType = resolveImageMimeType(snapshot.file_type, snapshot.file_name);
      if (!imageMimeType) {
        parts.push(buildHistoricalAttachmentText(snapshot, 'file'));
        continue;
      }
      if (!allowInlineImages) {
        parts.push(buildHistoricalAttachmentText(snapshot, 'image'));
        continue;
      }
      const dataUrl = attachment
        ? await toDataUrlFromAttachmentOrFileLibraryObject(
            args.downloadFileLibraryObject,
            { workspaceId: args.route.workspaceId, projectId: args.route.projectId },
            attachment,
            imageMimeType,
          )
        : null;
      if (dataUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: dataUrl },
        });
      } else {
        missingCurrentImageDataUrl = true;
      }
    }
    if (parts.length === 0) {
      return { role: item.role, content: item.content };
    }
    return { role: item.role, content: parts };
  }));

  return {
    messages: upstreamMessages,
    missingCurrentImageDataUrl,
  };
}
