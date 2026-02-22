import type http from 'node:http';

interface ChatStreamChoiceDeltaToolCall {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatStreamChunk {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: ChatStreamChoiceDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ResponsesToolCallStreamState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  argumentsText: string;
  added: boolean;
  done: boolean;
}

function findSseBlockSeparator(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

export async function pipeTranslatedChatSseAsResponses(
  upstreamSseBody: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  requestBody: Record<string, unknown>,
  context?: {
    upstreamUrl?: string;
    fallbackMode?: boolean;
    debug?: (message: string, extra?: Record<string, unknown>) => void;
  },
): Promise<void> {
  const debug = context?.debug;
  const reader = upstreamSseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let sequence = 1;
  let responseId = `resp_${Date.now()}`;
  let model = String(requestBody.model ?? '');
  let createdAt = Math.floor(Date.now() / 1000);
  let usage: ChatStreamChunk['usage'];

  let started = false;
  let assistantMessageStarted = false;
  let assistantMessageDone = false;
  const assistantMessageId = `msg_${Date.now()}`;
  const assistantOutputIndex = 0;
  let assistantText = '';
  let terminalSeen = false;
  let doneSeen = false;
  let sseBlockCount = 0;
  let chatChunkCount = 0;
  let textDeltaCount = 0;
  let toolArgumentDeltaCount = 0;
  let terminalReason = 'upstream_eof';

  const toolStates = new Map<number, ResponsesToolCallStreamState>();

  const emit = (type: string, payload: Record<string, unknown>) => {
    const eventPayload = { type, ...payload, sequence_number: sequence++ };
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  };

  const ensureStarted = () => {
    if (started) return;
    started = true;
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
  };

  const ensureAssistantMessageStarted = () => {
    if (assistantMessageStarted) return;
    ensureStarted();
    assistantMessageStarted = true;
    emit('response.output_item.added', {
      output_index: assistantOutputIndex,
      item: {
        id: assistantMessageId,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    });
    emit('response.content_part.added', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    });
  };

  const emitAssistantTextDelta = (delta: string) => {
    if (!delta) return;
    ensureAssistantMessageStarted();
    assistantText += delta;
    textDeltaCount += 1;
    emit('response.output_text.delta', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      delta,
    });
  };

  const getToolState = (index: number): ResponsesToolCallStreamState => {
    const existing = toolStates.get(index);
    if (existing) return existing;
    const state: ResponsesToolCallStreamState = {
      outputIndex: index + 1,
      itemId: `fc_${Date.now()}_${index}`,
      callId: `call_${Date.now()}_${index}`,
      name: '',
      argumentsText: '',
      added: false,
      done: false,
    };
    toolStates.set(index, state);
    return state;
  };

  const emitToolStateAddedIfNeeded = (state: ResponsesToolCallStreamState) => {
    if (state.added) return;
    ensureStarted();
    state.added = true;
    emit('response.output_item.added', {
      output_index: state.outputIndex,
      item: {
        id: state.itemId,
        type: 'function_call',
        status: 'in_progress',
        call_id: state.callId,
        name: state.name,
        arguments: state.argumentsText,
      },
    });
  };

  const emitToolCallDeltas = (toolCalls: ChatStreamChoiceDeltaToolCall[]) => {
    for (const toolCall of toolCalls) {
      const idx = typeof toolCall.index === 'number' ? toolCall.index : 0;
      const state = getToolState(idx);
      if (typeof toolCall.id === 'string' && toolCall.id) {
        state.callId = toolCall.id;
      }
      if (typeof toolCall.function?.name === 'string' && toolCall.function.name) {
        state.name = toolCall.function.name;
      }
      emitToolStateAddedIfNeeded(state);
      if (typeof toolCall.function?.arguments === 'string' && toolCall.function.arguments) {
        state.argumentsText += toolCall.function.arguments;
        toolArgumentDeltaCount += 1;
        emit('response.function_call_arguments.delta', {
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: toolCall.function.arguments,
        });
      }
    }
  };

  const finalizeAssistantMessage = () => {
    if (!assistantMessageStarted || assistantMessageDone) return;
    assistantMessageDone = true;
    emit('response.output_text.done', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      text: assistantText,
    });
    emit('response.content_part.done', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: assistantText,
        annotations: [],
      },
    });
    emit('response.output_item.done', {
      output_index: assistantOutputIndex,
      item: {
        id: assistantMessageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: assistantText,
            annotations: [],
          },
        ],
      },
    });
  };

  const finalizeToolCalls = () => {
    for (const state of [...toolStates.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      if (!state.added || state.done) continue;
      state.done = true;
      emit('response.function_call_arguments.done', {
        item_id: state.itemId,
        output_index: state.outputIndex,
        arguments: state.argumentsText || '{}',
      });
      emit('response.output_item.done', {
        output_index: state.outputIndex,
        item: {
          id: state.itemId,
          type: 'function_call',
          status: 'completed',
          call_id: state.callId,
          name: state.name,
          arguments: state.argumentsText || '{}',
        },
      });
    }
  };

  const buildCompletedOutput = (): Array<Record<string, unknown>> => {
    const output: Array<Record<string, unknown>> = [];
    if (assistantMessageStarted) {
      output.push({
        id: assistantMessageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: assistantText,
            annotations: [],
          },
        ],
      });
    }
    for (const state of [...toolStates.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      output.push({
        id: state.itemId,
        type: 'function_call',
        status: 'completed',
        call_id: state.callId,
        name: state.name,
        arguments: state.argumentsText || '{}',
      });
    }
    return output;
  };

  const finalizeResponse = () => {
    ensureStarted();
    finalizeAssistantMessage();
    finalizeToolCalls();
    emit('response.completed', {
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: null,
        model,
        output: buildCompletedOutput(),
        output_text: assistantText,
        usage:
          usage
            ? {
                input_tokens: Number(usage.prompt_tokens ?? 0),
                output_tokens: Number(usage.completion_tokens ?? 0),
                total_tokens: Number(usage.total_tokens ?? 0),
              }
            : undefined,
      },
    });
  };

  const finalizeResponseWithError = (message: string) => {
    ensureStarted();
    finalizeAssistantMessage();
    finalizeToolCalls();
    emit('response.completed', {
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        error: {
          code: 'UPSTREAM_STREAM_ERROR',
          message,
        },
        incomplete_details: null,
        instructions: null,
        model,
        output: buildCompletedOutput(),
        output_text: assistantText,
        usage:
          usage
            ? {
                input_tokens: Number(usage.prompt_tokens ?? 0),
                output_tokens: Number(usage.completion_tokens ?? 0),
                total_tokens: Number(usage.total_tokens ?? 0),
              }
            : undefined,
      },
    });
  };

  const processSseBlock = (block: string) => {
    sseBlockCount += 1;
    const dataLines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) return;
    const rawData = dataLines.join('\n');
    if (!rawData || rawData === '[DONE]') {
      terminalSeen = true;
      doneSeen = rawData === '[DONE]';
      terminalReason = doneSeen ? 'done_sentinel' : 'empty_data';
      return;
    }
    if (rawData.startsWith('{') && rawData.includes('\"error\"')) {
      const maybeError = JSON.parse(rawData) as { error?: { message?: string } };
      terminalSeen = true;
      terminalReason = 'upstream_error_payload';
      finalizeResponseWithError(maybeError.error?.message ?? rawData);
      return;
    }
    const chunk = JSON.parse(rawData) as ChatStreamChunk;
    chatChunkCount += 1;
    if (typeof chunk.id === 'string' && chunk.id) responseId = chunk.id;
    if (typeof chunk.model === 'string' && chunk.model) model = chunk.model;
    if (typeof chunk.created === 'number') createdAt = chunk.created;
    if (chunk.usage) usage = chunk.usage;

    const firstChoice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (typeof firstChoice?.delta?.content === 'string') {
      emitAssistantTextDelta(firstChoice.delta.content);
    }
    if (Array.isArray(firstChoice?.delta?.tool_calls) && firstChoice.delta.tool_calls.length > 0) {
      emitToolCallDeltas(firstChoice.delta.tool_calls);
    }
    if (typeof firstChoice?.finish_reason === 'string' && firstChoice.finish_reason) {
      terminalSeen = true;
      terminalReason = `finish_reason:${firstChoice.finish_reason}`;
    }
  };

  try {
    debug?.('stream_translate_start', {
      upstream_url: context?.upstreamUrl ?? null,
      model: typeof requestBody.model === 'string' ? requestBody.model : null,
      fallback_mode: context?.fallbackMode === true,
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = findSseBlockSeparator(buffer);
      while (splitIndex >= 0) {
        const block = buffer.slice(0, splitIndex);
        const sepLen = buffer.startsWith('\r\n\r\n', splitIndex) ? 4 : 2;
        buffer = buffer.slice(splitIndex + sepLen);
        if (block.trim()) processSseBlock(block);
        splitIndex = findSseBlockSeparator(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processSseBlock(buffer);
    if (!terminalSeen) {
      terminalSeen = true;
      terminalReason = 'upstream_eof_no_terminal';
    }
    if (!res.writableEnded) {
      finalizeResponse();
    }
    debug?.('stream_translate_done', {
      model,
      sse_block_count: sseBlockCount,
      chat_chunk_count: chatChunkCount,
      text_delta_count: textDeltaCount,
      tool_argument_delta_count: toolArgumentDeltaCount,
      assistant_text_chars: assistantText.length,
      tool_call_count: toolStates.size,
      terminal_seen: terminalSeen,
      done_seen: doneSeen,
      terminal_reason: terminalReason,
    });
    res.end();
  } catch (error) {
    debug?.('stream_translate_error', {
      message: error instanceof Error ? error.message : String(error),
      sse_block_count: sseBlockCount,
      chat_chunk_count: chatChunkCount,
      terminal_reason: terminalReason,
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

