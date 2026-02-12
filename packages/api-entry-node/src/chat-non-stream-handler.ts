import type http from 'node:http';
import { Buffer } from 'node:buffer';
import type { ChatRoute } from './chat-route-match.js';
import { resolveImageMimeType, toImageDataUrl } from './chat-image-utils.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { parsePagination } from './pagination.js';
import {
  ACTIVE_CHAT_STREAMS,
  STREAM_REGISTRY_TTL_SECONDS,
  listActiveSessionStreams,
  readSessionStreamState,
  readStreamRegistry,
  stopActiveSessionStreams,
  writeSessionStreamState,
  writeStreamRegistry,
} from './chat-stream-runtime.js';

interface ChatNonStreamHandlerArgs {
  route: ChatRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  requestUrl: URL;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE_BYTES = 60 * 1024 * 1024;

function endpointSupportsMultimodal(endpoint: { capabilities?: Array<{ type: string; enabled: boolean }> }): boolean {
  return (
    endpoint.capabilities?.some(
      (capability) => capability.type === 'multimodal_completion' && capability.enabled,
    ) ?? false
  );
}

function validateAttachmentPayload(raw: {
  file_name?: string;
  file_type?: string;
  file_size?: number;
  content_base64?: string;
}): string | null {
  if (!raw.file_name || !raw.file_type || typeof raw.file_size !== 'number' || raw.file_size < 0) {
    return 'attachment_fields_required';
  }
  if (raw.file_size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    return 'chat_attachment_file_too_large';
  }
  if (raw.content_base64) {
    try {
      const size = Buffer.byteLength(raw.content_base64, 'base64');
      if (size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
        return 'chat_attachment_file_too_large';
      }
    } catch {
      return 'attachment_content_base64_invalid';
    }
  }
  return null;
}

export async function handleChatNonStreamRoute(args: ChatNonStreamHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, requestUrl, json, readBody } = args;

  if (route.kind === 'chatMessagesStream') {
    return false;
  }

  if (route.kind === 'chatSessions' && method === 'GET') {
    const { page, pageSize, offset } = parsePagination(requestUrl.searchParams, {
      page: 1,
      pageSize: 100,
      maxPageSize: 500,
    });
    const items = await deps.chatResourceService.listSessions(route.workspaceId, route.projectId);
    const pageItems = items.slice(offset, offset + pageSize);
    const itemsWithRuntime = await Promise.all(
      pageItems.map(async (item) => ({
        ...item,
        runtime_status: await readSessionStreamState(
          deps.cache,
          route.workspaceId,
          route.projectId,
          item.id,
        ) ?? undefined,
      })),
    );
    json(res, 200, {
      items: itemsWithRuntime,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: offset + itemsWithRuntime.length < items.length,
    });
    return true;
  }

  if (route.kind === 'chatSessions' && method === 'POST') {
    const raw = (await readBody(req)) as {
      title?: string;
      model?: string;
      endpoint_id?: string;
    };
    const endpoints = await deps.endpointResourceService.listEndpoints(route.workspaceId, route.projectId);
    const chosenEndpoint =
      (raw.endpoint_id
        ? endpoints.find((item) => item.id === raw.endpoint_id)
        : endpoints.find((item) => item.status === 'active')) ?? null;
    if (!chosenEndpoint) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'active_endpoint_required' });
      return true;
    }
    const created = await deps.chatResourceService.createSession({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      title: raw.title,
      model: raw.model ?? chosenEndpoint.openai_model,
      endpointId: chosenEndpoint.id,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'GET') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const runtimeStatus = await readSessionStreamState(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    json(res, 200, {
      ...session,
      runtime_status: runtimeStatus ?? undefined,
    });
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'PATCH') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    const updated = await deps.chatResourceService.updateSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      raw,
    );
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'DELETE') {
    await stopActiveSessionStreams(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const deleted = await deps.chatResourceService.deleteSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'chatSessionStop' && method === 'POST') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const stopped = await stopActiveSessionStreams(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    json(res, 202, {
      success: true,
      session_id: route.sessionId,
      state: stopped > 0 ? 'stopping' : 'not_found_or_finished',
    });
    return true;
  }

  if (route.kind === 'chatSessionStreams' && method === 'GET') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const items = listActiveSessionStreams(route.workspaceId, route.projectId, route.sessionId)
      .map((item) => ({
        stream_id: item.streamId,
        status: item.status,
        started_at: item.startedAt,
      }));
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'chatMessages' && method === 'GET') {
    const { page, pageSize, offset } = parsePagination(requestUrl.searchParams, {
      page: 1,
      pageSize: 200,
      maxPageSize: 500,
    });
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const items = await deps.chatResourceService.listMessages(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const pageItems = items.slice(offset, offset + pageSize);
    json(res, 200, {
      items: pageItems,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: offset + pageItems.length < items.length,
    });
    return true;
  }

  if (route.kind === 'chatMessages' && method === 'POST') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const raw = (await readBody(req)) as {
      role?: 'user';
      content?: string;
      parent_id?: string | null;
      attachments?: string[];
    };
    if (raw.role !== 'user' || !raw.content?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_message_content_required' });
      return true;
    }
    const parentId = raw.parent_id ?? null;
    if (parentId) {
      const parent = await deps.chatResourceService.getMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        parentId,
      );
      if (!parent) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_parent_message_not_found' });
        return true;
      }
    }
    const attachmentIds = Array.isArray(raw.attachments) ? raw.attachments.filter(Boolean) : [];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const attachmentSnapshots = [];
    if (attachmentIds.length > 0) {
      const endpoint = await deps.endpointResourceService.getEndpoint(
        route.workspaceId,
        route.projectId,
        session.endpoint_id,
      );
      if (!endpoint || !endpointSupportsMultimodal(endpoint)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_not_multimodal' });
        return true;
      }
      const attachments = await deps.chatResourceService.listAttachmentsByIds(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        attachmentIds,
      );
      if (attachments.length !== attachmentIds.length) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_found' });
        return true;
      }
      const totalSize = attachments.reduce((acc, item) => acc + item.file_size, 0);
      if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE_BYTES) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
        return true;
      }
      const notReady = attachments.find((item) => item.upload_status !== 'ready');
      if (notReady) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_ready' });
        return true;
      }
      for (const attachment of attachments) {
        attachmentSnapshots.push({
          id: attachment.id,
          file_name: attachment.file_name,
          file_type: attachment.file_type,
          file_size: attachment.file_size,
          source_type: attachment.source_type,
          source_library_id: attachment.source_library_id,
          source_object_key: attachment.source_object_key,
        });
      }
    }

    const created = await deps.chatResourceService.createMessage({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      role: 'user',
      content: raw.content,
      parentId,
      attachmentSnapshots: attachmentSnapshots.length > 0 ? attachmentSnapshots : undefined,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'chatMessageItem' && method === 'PATCH') {
    const raw = (await readBody(req)) as { content?: string };
    if (!raw.content?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_message_content_required' });
      return true;
    }
    const revised = await deps.chatResourceService.updateMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.messageId,
      raw.content,
    );
    if (!revised) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_message_not_found' });
      return true;
    }
    json(res, 200, revised);
    return true;
  }

  if (route.kind === 'chatRegenerate' && method === 'POST') {
    json(res, 200, { stream_id: `stream_${Date.now()}` });
    return true;
  }

  if (route.kind === 'chatAttachments' && method === 'GET') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const items = await deps.chatResourceService.listAttachments(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'chatAttachmentInit' && method === 'POST') {
    const session = await deps.chatResourceService.getSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const raw = (await readBody(req)) as {
      file_name?: string;
      file_type?: string;
      file_size?: number;
      content_base64?: string;
      source_type?: 'local_upload' | 'library_import';
      source_library_id?: string;
      source_object_key?: string;
    };
    const validationError = validateAttachmentPayload(raw);
    if (validationError) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: validationError });
      return true;
    }
    const existing = await deps.chatResourceService.listAttachments(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (existing.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const totalSize = existing.reduce((acc, item) => acc + item.file_size, 0) + (raw.file_size ?? 0);
    if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE_BYTES) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const attachment = await deps.chatResourceService.initAttachment({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      fileName: raw.file_name,
      fileType: raw.file_type,
      fileSize: raw.file_size,
      sourceType: raw.source_type,
      sourceLibraryId: raw.source_library_id,
      sourceObjectKey: raw.source_object_key,
      contentBase64: raw.content_base64,
      previewUrl: toImageDataUrl(
        raw.content_base64,
        resolveImageMimeType(raw.file_type, raw.file_name),
      ) ?? undefined,
    });
    json(res, 200, { attachment });
    return true;
  }

  if (route.kind === 'chatAttachmentComplete' && method === 'POST') {
    const attachment = await deps.chatResourceService.completeAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!attachment) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, attachment);
    return true;
  }

  if (route.kind === 'chatAttachmentItem' && method === 'DELETE') {
    const deleted = await deps.chatResourceService.deleteAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'chatAttachmentRetry' && method === 'POST') {
    const attachment = await deps.chatResourceService.completeAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!attachment) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, attachment);
    return true;
  }

  if (route.kind === 'chatMessagesStreamStop' && method === 'POST') {
    const running = ACTIVE_CHAT_STREAMS.get(route.streamId);
    const registry = await readStreamRegistry(deps.cache, route.streamId);
    const canStop =
      running
        ? running.workspaceId === route.workspaceId &&
          running.projectId === route.projectId &&
          running.sessionId === route.sessionId
        : registry
          ? registry.workspaceId === route.workspaceId &&
            registry.projectId === route.projectId &&
            registry.sessionId === route.sessionId
          : false;
    if (!canStop) {
      json(res, 202, { success: true, stream_id: route.streamId, state: 'not_found_or_finished' });
      return true;
    }
    await writeStreamRegistry(
      deps.cache,
      {
        streamId: route.streamId,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        status: 'stopping',
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_TTL_SECONDS,
    );
    await writeSessionStreamState(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
      'stopping',
      STREAM_REGISTRY_TTL_SECONDS,
    );
    if (running) {
      running.status = 'stopping';
      running.stopReason = 'user_stop';
      running.abortController.abort();
    }
    json(res, 202, { success: true, stream_id: route.streamId, state: 'stopping' });
    return true;
  }

  return false;
}
