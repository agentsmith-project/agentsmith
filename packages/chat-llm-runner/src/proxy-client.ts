import type {
  AgentServerStartPayload,
  AgentWireApi,
  ChatExecutionContext,
} from '@mbos/agent-runner';

type ExecutionContext = Pick<
  ChatExecutionContext,
  'api_base' | 'workspace_id' | 'project_id' | 'execution_ticket' | 'endpoint_id' | 'model'
> & {
  wire_api?: AgentWireApi;
};

type RequestArgs = {
  messages: AgentServerStartPayload['messages'];
  executionContext: ExecutionContext;
  model?: string;
  signal?: AbortSignal;
};

function stringifyTextPart(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const typed = part as { type?: string; text?: unknown };
      return typed.type === 'text' && typeof typed.text === 'string' ? typed.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function toResponsesContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  const output: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as {
      type?: string;
      text?: unknown;
      image_url?: { url?: unknown };
    };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      output.push({ type: 'input_text', text: typed.text });
      continue;
    }
    if (typed.type === 'image_url' && typeof typed.image_url?.url === 'string') {
      output.push({ type: 'input_image', image_url: typed.image_url.url });
    }
  }
  return output;
}

function normalizeWireApi(wireApi: AgentWireApi | undefined): AgentWireApi {
  if (wireApi === 'responses' || wireApi === 'anthropic_messages') return wireApi;
  return 'chat';
}

function buildProxyRoute(wireApi: AgentWireApi): { provider: 'openai' | 'anthropic'; path: string } {
  if (wireApi === 'responses') {
    return { provider: 'openai', path: 'responses' };
  }
  if (wireApi === 'anthropic_messages') {
    return { provider: 'anthropic', path: 'messages' };
  }
  return { provider: 'openai', path: 'chat/completions' };
}

function toAnthropicContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ type: 'text', text: '' }];
  }
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as { type?: string; text?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      blocks.push({ type: 'text', text: typed.text });
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

function toAnthropicMessages(
  messages: AgentServerStartPayload['messages'],
): { system?: string; messages: Array<Record<string, unknown>> } {
  const anthropicMessages: Array<Record<string, unknown>> = [];
  const systemParts: string[] = [];

  for (const message of messages ?? []) {
    const role = typeof message.role === 'string' ? message.role : 'user';
    if (role === 'system') {
      const text = stringifyTextPart(message.content).trim();
      if (text.length > 0) systemParts.push(text);
      continue;
    }

    anthropicMessages.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: toAnthropicContentBlocks(message.content),
    });
  }

  return {
    ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
    messages: anthropicMessages,
  };
}

function readAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: Array<{ type?: unknown; text?: unknown }> }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('')
    .trim();
}

function readAnthropicUsageTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  const inputTokens = typeof usage?.input_tokens === 'number' && Number.isFinite(usage.input_tokens)
    ? usage.input_tokens
    : 0;
  const outputTokens = typeof usage?.output_tokens === 'number' && Number.isFinite(usage.output_tokens)
    ? usage.output_tokens
    : 0;
  if (inputTokens > 0 || outputTokens > 0) {
    return inputTokens + outputTokens;
  }
  return undefined;
}

export function buildEndpointProxyUrl(executionContext: ExecutionContext): string {
  const apiBase = executionContext.api_base?.trim().replace(/\/+$/, '');
  const workspaceId = executionContext.workspace_id?.trim();
  const projectId = executionContext.project_id?.trim();
  const endpointId = executionContext.endpoint_id?.trim();
  if (!apiBase || !workspaceId || !projectId || !endpointId) {
    throw new Error('chat_runner_execution_context_incomplete');
  }
  const route = buildProxyRoute(normalizeWireApi(executionContext.wire_api));
  return `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}`
    + `/projects/${encodeURIComponent(projectId)}`
    + `/endpoints/${encodeURIComponent(endpointId)}`
    + `/proxy/${route.provider}/${route.path}`;
}

export function buildProxyRequestBody(args: RequestArgs): Record<string, unknown> {
  const wireApi = normalizeWireApi(args.executionContext.wire_api);
  const model = args.model?.trim() || args.executionContext.model?.trim() || undefined;
  if (wireApi === 'responses') {
    return {
      ...(model ? { model } : {}),
      stream: false,
      input: (args.messages ?? []).map((message) => ({
        role: message.role ?? 'user',
        content: toResponsesContent(message.content),
      })),
    };
  }
  if (wireApi === 'anthropic_messages') {
    const anthropicMessages = toAnthropicMessages(args.messages);
    return {
      ...(model ? { model } : {}),
      stream: false,
      max_tokens: 1024,
      ...anthropicMessages,
    };
  }
  return {
    ...(model ? { model } : {}),
    stream: false,
    messages: args.messages ?? [],
  };
}

function readChatCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return stringifyTextPart(content).trim();
}

function readResponsesText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === 'string') return outputText.trim();
  const output = (payload as { output?: Array<{ content?: Array<{ text?: unknown }> }> }).output;
  const parts = output?.flatMap((item) => item.content ?? []).map((item) => (
    typeof item.text === 'string' ? item.text : ''
  )).filter(Boolean) ?? [];
  return parts.join('\n').trim();
}

function readUsageTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as { usage?: { total_tokens?: unknown } }).usage;
  return typeof usage?.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : undefined;
}

export async function requestChatProxyCompletion(args: RequestArgs): Promise<{
  text: string;
  usageTokens?: number;
}> {
  const executionTicket = args.executionContext.execution_ticket?.trim();
  if (!executionTicket) {
    throw new Error('chat_runner_execution_ticket_missing');
  }
  const url = buildEndpointProxyUrl(args.executionContext);
  const body = buildProxyRequestBody(args);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${executionTicket}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const message =
      typeof (parsed as { message?: unknown }).message === 'string'
        ? (parsed as { message: string }).message
        : `chat_runner_upstream_http_${response.status}`;
    throw new Error(message);
  }
  const wireApi = normalizeWireApi(args.executionContext.wire_api);
  return {
    text:
      wireApi === 'responses'
        ? readResponsesText(parsed)
        : (wireApi === 'anthropic_messages' ? readAnthropicText(parsed) : readChatCompletionText(parsed)),
    usageTokens: wireApi === 'anthropic_messages' ? readAnthropicUsageTokens(parsed) : readUsageTokens(parsed),
  };
}
