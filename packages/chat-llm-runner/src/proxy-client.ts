import type { AgentServerStartPayload, ChatExecutionContext } from '@mbos/agent-runner';

type ExecutionContext = ChatExecutionContext & {
  wire_api?: 'chat' | 'responses';
  model?: string;
};

type RequestArgs = {
  messages: AgentServerStartPayload['messages'];
  executionContext: ExecutionContext;
  model?: string;
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

function buildProxyPath(wireApi: 'chat' | 'responses'): string {
  return wireApi === 'responses' ? 'responses' : 'chat/completions';
}

export function buildEndpointProxyUrl(executionContext: ExecutionContext): string {
  const apiBase = executionContext.api_base?.trim().replace(/\/+$/, '');
  const workspaceId = executionContext.workspace_id?.trim();
  const projectId = executionContext.project_id?.trim();
  const endpointId = executionContext.endpoint_id?.trim();
  if (!apiBase || !workspaceId || !projectId || !endpointId) {
    throw new Error('chat_runner_execution_context_incomplete');
  }
  return `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}`
    + `/projects/${encodeURIComponent(projectId)}`
    + `/endpoints/${encodeURIComponent(endpointId)}`
    + `/proxy/openai/${buildProxyPath(executionContext.wire_api === 'responses' ? 'responses' : 'chat')}`;
}

export function buildProxyRequestBody(args: RequestArgs): Record<string, unknown> {
  const wireApi = args.executionContext.wire_api === 'responses' ? 'responses' : 'chat';
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
  const wireApi = args.executionContext.wire_api === 'responses' ? 'responses' : 'chat';
  return {
    text: wireApi === 'responses' ? readResponsesText(parsed) : readChatCompletionText(parsed),
    usageTokens: readUsageTokens(parsed),
  };
}
