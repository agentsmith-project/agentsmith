import type http from 'node:http';

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAiChunk {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: OpenAiToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface AnthropicEvent {
  type?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: {
    output_tokens?: number;
  };
}

function findSseBlockSeparator(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function trimSseBlock(block: string): string {
  return block.endsWith('\r\n\r\n')
    ? block.slice(0, -4)
    : block.endsWith('\n\n')
      ? block.slice(0, -2)
      : block;
}

function parseSseEvent(block: string): { event: string; data: string } | null {
  const normalized = block.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let event = 'message';
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice('data:'.length).trim());
    }
  }
  if (dataParts.length === 0) return null;
  return { event, data: dataParts.join('\n') };
}

function writeSse(res: http.ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeOpenAiChunk(res: http.ServerResponse, payload: OpenAiChunk): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function toOpenAiFinishReason(stopReason: string | null | undefined): 'stop' | 'tool_calls' {
  if (stopReason === 'tool_use') return 'tool_calls';
  return 'stop';
}

function toAnthropicStopReason(reason: string | null | undefined): 'end_turn' | 'tool_use' {
  if (reason === 'tool_calls') return 'tool_use';
  return 'end_turn';
}

export async function pipeAnthropicSseAsOpenAiChat(
  upstreamSseBody: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  requestBody: Record<string, unknown>,
): Promise<void> {
  const reader = upstreamSseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let responseId = `chatcmpl_${Date.now()}`;
  let model = String(requestBody.model ?? '');
  let created = Math.floor(Date.now() / 1000);
  let finishReason: 'stop' | 'tool_calls' = 'stop';
  let promptTokens = 0;
  let completionTokens = 0;

  const emittedToolStart = new Set<number>();

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });

    while (true) {
      const sep = findSseBlockSeparator(buffer);
      if (sep < 0) break;
      const blockRaw = buffer.slice(0, sep + (buffer.startsWith('\r\n', sep) ? 4 : 2));
      buffer = buffer.slice(sep + (blockRaw.endsWith('\r\n\r\n') ? 4 : 2));
      const parsed = parseSseEvent(trimSseBlock(blockRaw));
      if (!parsed) continue;
      if (parsed.data === '[DONE]') continue;
      let payload: AnthropicEvent;
      try {
        payload = JSON.parse(parsed.data) as AnthropicEvent;
      } catch {
        continue;
      }

      if (parsed.event === 'message_start' && payload.message) {
        if (typeof payload.message.id === 'string') responseId = payload.message.id;
        if (typeof payload.message.model === 'string') model = payload.message.model;
        promptTokens = Number(payload.message.usage?.input_tokens ?? 0);
        writeOpenAiChunk(res, {
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        });
        continue;
      }

      if (parsed.event === 'content_block_delta') {
        const idx = typeof payload.index === 'number' ? payload.index : 0;
        if (payload.delta?.type === 'text_delta' && typeof payload.delta.text === 'string') {
          writeOpenAiChunk(res, {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: payload.delta.text }, finish_reason: null }],
          });
          continue;
        }
        if (payload.delta?.type === 'input_json_delta') {
          if (!emittedToolStart.has(idx)) {
            emittedToolStart.add(idx);
            writeOpenAiChunk(res, {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: idx,
                        id: `call_${Date.now()}_${idx}`,
                        function: { name: 'tool', arguments: '' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
          }
          writeOpenAiChunk(res, {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: idx,
                      function: { arguments: payload.delta.partial_json ?? '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        }
      }

      if (parsed.event === 'content_block_start' && payload.content_block?.type === 'tool_use') {
        const idx = typeof payload.index === 'number' ? payload.index : 0;
        emittedToolStart.add(idx);
        writeOpenAiChunk(res, {
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: payload.content_block.id ?? `call_${Date.now()}_${idx}`,
                    function: {
                      name: payload.content_block.name ?? 'tool',
                      arguments: '',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        continue;
      }

      if (parsed.event === 'message_delta') {
        finishReason = toOpenAiFinishReason(payload.delta?.stop_reason);
        completionTokens = Number(payload.usage?.output_tokens ?? completionTokens);
      }
    }
  }

  writeOpenAiChunk(res, {
    id: responseId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

export async function pipeOpenAiChatSseAsAnthropic(
  upstreamSseBody: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  requestBody: Record<string, unknown>,
): Promise<void> {
  const reader = upstreamSseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let messageId = `msg_${Date.now()}`;
  let model = String(requestBody.model ?? '');
  let promptTokens = 0;
  let outputTokens = 0;
  let stopReason: 'end_turn' | 'tool_use' = 'end_turn';

  let textStarted = false;
  let textClosed = false;
  const toolStarted = new Set<number>();
  const toolClosed = new Set<number>();

  writeSse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });

    while (true) {
      const sep = findSseBlockSeparator(buffer);
      if (sep < 0) break;
      const blockRaw = buffer.slice(0, sep + (buffer.startsWith('\r\n', sep) ? 4 : 2));
      buffer = buffer.slice(sep + (blockRaw.endsWith('\r\n\r\n') ? 4 : 2));
      const parsed = parseSseEvent(trimSseBlock(blockRaw));
      if (!parsed) continue;
      if (parsed.data === '[DONE]') continue;
      let payload: OpenAiChunk;
      try {
        payload = JSON.parse(parsed.data) as OpenAiChunk;
      } catch {
        continue;
      }

      if (typeof payload.id === 'string') messageId = payload.id;
      if (typeof payload.model === 'string') model = payload.model;
      const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
      const delta = choice?.delta;

      if (typeof delta?.content === 'string' && delta.content) {
        if (!textStarted) {
          textStarted = true;
          writeSse(res, 'content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          });
        }
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: delta.content,
          },
        });
      }

      const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
      for (const rawToolCall of toolCalls) {
        const idx = typeof rawToolCall.index === 'number' ? rawToolCall.index : 0;
        if (!toolStarted.has(idx)) {
          toolStarted.add(idx);
          writeSse(res, 'content_block_start', {
            type: 'content_block_start',
            index: idx + 1,
            content_block: {
              type: 'tool_use',
              id: rawToolCall.id ?? `call_${Date.now()}_${idx}`,
              name: rawToolCall.function?.name ?? 'tool',
              input: {},
            },
          });
        }
        if (typeof rawToolCall.function?.arguments === 'string' && rawToolCall.function.arguments) {
          writeSse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: idx + 1,
            delta: {
              type: 'input_json_delta',
              partial_json: rawToolCall.function.arguments,
            },
          });
        }
      }

      if (choice?.finish_reason) {
        stopReason = toAnthropicStopReason(choice.finish_reason);
      }

      if (payload.usage) {
        promptTokens = Number(payload.usage.prompt_tokens ?? promptTokens);
        outputTokens = Number(payload.usage.completion_tokens ?? outputTokens);
      }
    }
  }

  if (textStarted && !textClosed) {
    textClosed = true;
    writeSse(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    });
  }
  for (const idx of [...toolStarted].sort((a, b) => a - b)) {
    if (toolClosed.has(idx)) continue;
    toolClosed.add(idx);
    writeSse(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: idx + 1,
    });
  }

  writeSse(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens,
    },
  });
  writeSse(res, 'message_stop', {
    type: 'message_stop',
    message: {
      id: messageId,
      model,
      usage: {
        input_tokens: promptTokens,
        output_tokens: outputTokens,
      },
    },
  });
  res.end();
}

export async function pipeAnthropicSseAsResponses(
  upstreamSseBody: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  requestBody: Record<string, unknown>,
): Promise<void> {
  const reader = upstreamSseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let sequence = 1;
  let responseId = `resp_${Date.now()}`;
  let model = String(requestBody.model ?? '');
  const createdAt = Math.floor(Date.now() / 1000);
  let inputTokens = 0;
  let outputTokens = 0;

  let textItemId = `msg_${Date.now()}`;
  let textItemStarted = false;
  let text = '';
  const toolArgs = new Map<number, { itemId: string; callId: string; name: string; args: string; started: boolean }>();

  const emit = (type: string, payload: Record<string, unknown>) => {
    writeSse(res, type, { type, ...payload, sequence_number: sequence++ });
  };

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });

    while (true) {
      const sep = findSseBlockSeparator(buffer);
      if (sep < 0) break;
      const blockRaw = buffer.slice(0, sep + (buffer.startsWith('\r\n', sep) ? 4 : 2));
      buffer = buffer.slice(sep + (blockRaw.endsWith('\r\n\r\n') ? 4 : 2));
      const parsed = parseSseEvent(trimSseBlock(blockRaw));
      if (!parsed || parsed.data === '[DONE]') continue;
      let payload: AnthropicEvent;
      try {
        payload = JSON.parse(parsed.data) as AnthropicEvent;
      } catch {
        continue;
      }

      if (parsed.event === 'message_start') {
        if (typeof payload.message?.id === 'string') responseId = payload.message.id;
        if (typeof payload.message?.model === 'string') model = payload.message.model;
        inputTokens = Number(payload.message?.usage?.input_tokens ?? 0);
        const inProgressResponse = {
          id: responseId,
          object: 'response',
          created_at: createdAt,
          status: 'in_progress',
          error: null,
          incomplete_details: null,
          instructions: null,
          model,
          output: [],
          output_text: '',
          usage: null,
        };
        emit('response.created', { response: inProgressResponse });
        emit('response.in_progress', { response: inProgressResponse });
        continue;
      }

      if (parsed.event === 'content_block_start' && payload.content_block?.type === 'text') {
        textItemStarted = true;
        textItemId = `msg_${Date.now()}`;
        emit('response.output_item.added', {
          output_index: 0,
          item: {
            id: textItemId,
            type: 'message',
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
        });
        emit('response.content_part.added', {
          item_id: textItemId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
        continue;
      }

      if (parsed.event === 'content_block_delta' && payload.delta?.type === 'text_delta') {
        const deltaText = payload.delta.text ?? '';
        if (deltaText) {
          text += deltaText;
          emit('response.output_text.delta', {
            item_id: textItemId,
            output_index: 0,
            content_index: 0,
            delta: deltaText,
          });
        }
        continue;
      }

      if (parsed.event === 'content_block_start' && payload.content_block?.type === 'tool_use') {
        const idx = typeof payload.index === 'number' ? payload.index : 1;
        const state = {
          itemId: `fc_${Date.now()}_${idx}`,
          callId: payload.content_block.id ?? `call_${Date.now()}_${idx}`,
          name: payload.content_block.name ?? 'tool',
          args: '',
          started: true,
        };
        toolArgs.set(idx, state);
        emit('response.output_item.added', {
          output_index: idx,
          item: {
            id: state.itemId,
            type: 'function_call',
            status: 'in_progress',
            call_id: state.callId,
            name: state.name,
            arguments: '',
          },
        });
        continue;
      }

      if (parsed.event === 'content_block_delta' && payload.delta?.type === 'input_json_delta') {
        const idx = typeof payload.index === 'number' ? payload.index : 1;
        const state = toolArgs.get(idx);
        if (!state) continue;
        const chunk = payload.delta.partial_json ?? '';
        state.args += chunk;
        emit('response.function_call_arguments.delta', {
          item_id: state.itemId,
          output_index: idx,
          delta: chunk,
        });
        continue;
      }

      if (parsed.event === 'message_delta') {
        outputTokens = Number(payload.usage?.output_tokens ?? outputTokens);
      }
    }
  }

  if (textItemStarted) {
    emit('response.output_text.done', {
      item_id: textItemId,
      output_index: 0,
      content_index: 0,
      text,
    });
    emit('response.content_part.done', {
      item_id: textItemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text, annotations: [] },
    });
    emit('response.output_item.done', {
      output_index: 0,
      item: {
        id: textItemId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    });
  }

  const outputItems: Array<Record<string, unknown>> = [];
  if (textItemStarted) {
    outputItems.push({
      id: textItemId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }
  for (const [idx, state] of [...toolArgs.entries()].sort((a, b) => a[0] - b[0])) {
    emit('response.function_call_arguments.done', {
      item_id: state.itemId,
      output_index: idx,
      arguments: state.args || '{}',
    });
    emit('response.output_item.done', {
      output_index: idx,
      item: {
        id: state.itemId,
        type: 'function_call',
        status: 'completed',
        call_id: state.callId,
        name: state.name,
        arguments: state.args || '{}',
      },
    });
    outputItems.push({
      id: state.itemId,
      type: 'function_call',
      status: 'completed',
      call_id: state.callId,
      name: state.name,
      arguments: state.args || '{}',
    });
  }

  const completed = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    model,
    output: outputItems,
    output_text: text,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
  emit('response.completed', { response: completed });
  res.write('data: [DONE]\n\n');
  res.end();
}
