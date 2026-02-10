import { API_BASE, ApiError, type ApiResponse } from '@/lib/api/client';

export type ChatStreamEvent =
  | {
      event: 'meta';
      data: {
        stream_id: string;
        session_id: string;
        model: string;
        endpoint_id: string;
        assistant_message_id?: string;
        parent_message_id?: string | null;
        variant_group_id?: string;
        variant_index?: number;
      };
    }
  | { event: 'delta'; data: { message_id: string; variant_group_id?: string; variant_index?: number; delta: string } }
  | {
      event: 'done';
      data: {
        message_id: string;
        finish_reason?: string | null;
        tokens?: number;
        message_status?: 'completed' | 'stopped' | 'failed';
      };
    }
  | { event: 'error'; data: { error_code: string; message: string; request_id?: string } };

function parseSseChunk(buffer: string) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of buffer.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  const rawData = dataLines.join('\n');
  return { event, rawData };
}

export async function* streamSseJson(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: unknown }> {
  if (!response.ok) {
    let body: ApiResponse<unknown> | null = null;
    try {
      body = (await response.json()) as ApiResponse<unknown>;
    } catch {
      // ignore
    }
    const bodyRecord = body as Record<string, unknown> | null;
    const fallbackCode = bodyRecord && typeof bodyRecord.code === 'string'
      ? bodyRecord.code
      : null;
    const errorCode = typeof body?.error_code === 'string'
      ? body.error_code
      : fallbackCode;
    if (errorCode) {
      throw new ApiError(errorCode, body?.message || 'Request failed', body?.request_id);
    }
    throw new Error(`Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) return;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const sepIndex = buffer.indexOf('\n\n');
      if (sepIndex === -1) break;
      const chunk = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const { event, rawData } = parseSseChunk(chunk);
      if (!rawData) continue;

      let data: unknown = rawData;
      try {
        data = JSON.parse(rawData);
      } catch {
        // keep raw
      }
      yield { event, data };
    }
  }
}

export async function postChatStream(
  args: {
    token?: string | null;
    workspaceId: string;
    projectId: string;
    sessionId: string;
    body: unknown;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const { token, workspaceId, projectId, sessionId, body, signal } = args;

  return fetch(`${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function getChatStreamAttach(args: {
  token?: string | null;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { token, workspaceId, projectId, sessionId, streamId, signal } = args;
  return fetch(
    `${API_BASE}/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/streams/${streamId}`,
    {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    },
  );
}
