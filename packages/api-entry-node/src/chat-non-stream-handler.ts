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

type ChatLibraryObjectInputRef = {
  kind: 'library_object';
  library_id: string;
  key: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};

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
  input_ref?: {
    kind?: string;
    library_id?: string;
    key?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
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
  if (raw.input_ref !== undefined) {
    if (
      typeof raw.input_ref !== 'object'
      || raw.input_ref === null
      || raw.input_ref.kind !== 'library_object'
      || typeof raw.input_ref.library_id !== 'string'
      || raw.input_ref.library_id.length === 0
      || typeof raw.input_ref.key !== 'string'
      || raw.input_ref.key.length === 0
    ) {
      return 'attachment_input_ref_invalid';
    }
  }
  return null;
}

function readChatLibraryObjectInputs(rawInputs: unknown): ChatLibraryObjectInputRef[] | null {
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

async function resolveChatInputAttachments(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  inputs: ChatLibraryObjectInputRef[],
) {
  if (inputs.length === 0) return [];
  const attachments = await deps.chatResourceService.listAttachments(workspaceId, projectId, sessionId);
  const byRef = new Map<string, (typeof attachments)[number]>();
  for (const attachment of attachments) {
    if (attachment.input_ref?.kind === 'library_object') {
      byRef.set(`${attachment.input_ref.library_id}:${attachment.input_ref.key}`, attachment);
    }
  }
  const resolved = inputs.map((input) => byRef.get(`${input.library_id}:${input.key}`) ?? null);
  return resolved;
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
      external_agent_id?: string;
    };
    const externalAgentId = typeof raw.external_agent_id === 'string' ? raw.external_agent_id : undefined;
    if (externalAgentId) {
      const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, externalAgentId);
      if (!agent || agent.mode !== 'external' || agent.status !== 'enabled') {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'external_agent_unavailable' });
        return true;
      }
      const created = await deps.chatResourceService.createSession({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        title: raw.title,
        model: raw.model ?? 'external-agent',
        endpointId: raw.endpoint_id ?? '',
        externalAgentId,
      });
      json(res, 201, created);
      return true;
    }
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
    const patch = { ...raw };
    if (typeof raw.external_agent_id === 'string' && raw.external_agent_id.length > 0) {
      const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, raw.external_agent_id);
      if (!agent || agent.mode !== 'external' || agent.status !== 'enabled') {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'external_agent_unavailable' });
        return true;
      }
    }
    const updated = await deps.chatResourceService.updateSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      patch,
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
      inputs?: unknown;
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
    const inputRefs = readChatLibraryObjectInputs(raw.inputs);
    if (inputRefs === null) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_input_refs_invalid' });
      return true;
    }
    if (inputRefs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const attachmentSnapshots = [];
    if (inputRefs.length > 0) {
      if (session.external_agent_id) {
        const agent = await deps.agentResourceService.getAgent(
          route.workspaceId,
          route.projectId,
          session.external_agent_id,
        );
        if (!agent || !agent.capabilities?.multimodal_completion) {
          json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'external_agent_not_multimodal' });
          return true;
        }
      } else {
        const endpoint = await deps.endpointResourceService.getEndpoint(
          route.workspaceId,
          route.projectId,
          session.endpoint_id,
        );
        if (!endpoint || !endpointSupportsMultimodal(endpoint)) {
          json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_not_multimodal' });
          return true;
        }
      }
      const resolved = await resolveChatInputAttachments(
        deps,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        inputRefs,
      );
      if (resolved.some((item) => !item)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_found' });
        return true;
      }
      const attachments = resolved as NonNullable<(typeof resolved)[number]>[];
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
          input_ref: attachment.input_ref,
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
      input_ref?: {
        kind?: string;
        library_id?: string;
        key?: string;
        name?: string;
        content_type?: string;
        size_bytes?: number;
      };
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
    const inputRef =
      raw.input_ref && raw.input_ref.kind === 'library_object'
        ? {
            kind: 'library_object' as const,
            library_id: raw.input_ref.library_id!,
            key: raw.input_ref.key!,
            name: typeof raw.input_ref.name === 'string' ? raw.input_ref.name : undefined,
            content_type: typeof raw.input_ref.content_type === 'string' ? raw.input_ref.content_type : undefined,
            size_bytes:
              typeof raw.input_ref.size_bytes === 'number' && raw.input_ref.size_bytes >= 0
                ? raw.input_ref.size_bytes
                : undefined,
          }
        : undefined;
    const attachment = await deps.chatResourceService.initAttachment({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      fileName: raw.file_name!,
      fileType: raw.file_type!,
      fileSize: raw.file_size!,
      inputRef,
      sourceType: inputRef ? 'library_import' : raw.source_type,
      sourceLibraryId: inputRef ? inputRef.library_id : raw.source_library_id,
      sourceObjectKey: inputRef ? inputRef.key : raw.source_object_key,
      contentBase64: raw.content_base64,
      previewUrl: toImageDataUrl(
        raw.content_base64,
        resolveImageMimeType(raw.file_type!, raw.file_name!),
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
