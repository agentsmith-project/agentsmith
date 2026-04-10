import { describe, expect, it } from 'vitest';
import {
  assertChatExecutionContext,
  assertNotebookExecutionContext,
  isChatExecutionContext,
  isNotebookExecutionContext,
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
    const value = {
      interaction_kind: 'notebook',
      task_id: 'task_1',
      session_id: 'sess_1',
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
});
