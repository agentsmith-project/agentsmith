import { describe, expect, it } from 'vitest';
import {
  assertChatExecutionContext,
  assertNotebookExecutionContext,
  isChatExecutionContext,
  isNotebookExecutionContext,
  type NotebookExecutionContext,
} from './protocol.js';

describe('agent-runner protocol execution context guards', () => {
  it('accepts chat execution context with session_id and no task_id', () => {
    const value = {
      interaction_kind: 'chat',
      session_id: 'sess_1',
      workspace_id: 'ws_1',
    };

    expect(isChatExecutionContext(value)).toBe(true);
    expect(assertChatExecutionContext(value)).toEqual(value);
  });

  it('rejects chat execution context when task_id is present', () => {
    const value = {
      interaction_kind: 'chat',
      session_id: 'sess_1',
      task_id: 'task_1',
    };

    expect(isChatExecutionContext(value)).toBe(false);
    expect(() => assertChatExecutionContext(value)).toThrowError('chat_execution_context_invalid');
  });

  it('accepts notebook execution context with task_id', () => {
    const value: NotebookExecutionContext = {
      interaction_kind: 'notebook',
      task_id: 'task_1',
      session_id: 'sess_1',
      model_catalog: {
        input_modalities: ['text'],
        supports_search_tool: false,
        supports_parallel_tool_calls: false,
      },
    };

    expect(isNotebookExecutionContext(value)).toBe(true);
    expect(assertNotebookExecutionContext(value)).toEqual(value);
  });

  it('rejects notebook execution context without task_id', () => {
    expect(isNotebookExecutionContext({
      interaction_kind: 'notebook',
      session_id: 'sess_1',
    })).toBe(false);
    expect(() => assertNotebookExecutionContext({
      interaction_kind: 'notebook',
      session_id: 'sess_1',
    })).toThrowError('notebook_execution_context_invalid');
  });

  it('accepts anthropic_messages as a valid wire_api', () => {
    const value = {
      interaction_kind: 'chat',
      session_id: 'sess_1',
      wire_api: 'anthropic_messages',
    };

    expect(isChatExecutionContext(value)).toBe(true);
    expect(assertChatExecutionContext(value)).toEqual(value);
  });

  it('rejects execution contexts with unsupported wire_api values', () => {
    const value = {
      interaction_kind: 'chat',
      session_id: 'sess_1',
      wire_api: 'anthropic',
    };

    expect(isChatExecutionContext(value)).toBe(false);
    expect(() => assertChatExecutionContext(value)).toThrowError('chat_execution_context_invalid');
  });
});
