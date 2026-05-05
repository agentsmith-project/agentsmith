import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_AGENT_WIRE_APIS,
  assertTaskExecutionContext,
  isTaskExecutionContext,
  type AgentEnvelope,
  type TaskExecutionContext,
} from './protocol.js';

describe('agent-runner task execution context guards', () => {
  it('accepts task execution context with task, run, endpoint, model, and workspace metadata', () => {
    const value: TaskExecutionContext = {
      task_id: 'task_1',
      run_id: 'run_1',
      runner_id: 'runner_1',
      runner_session_scope: 'task_execution',
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      endpoint_id: 'ep_1',
      model: 'gpt-5-codex',
      wire_api: 'openai_responses',
      username: 'alice',
      model_limits: {
        context_window: 200000,
        max_output_tokens: 32000,
      },
      model_catalog: {
        input_modalities: ['text'],
        supports_search_tool: false,
        supports_parallel_tool_calls: false,
        apply_patch_tool_type: 'freeform',
      },
      task_inputs: [{ kind: 'library_object', key: 'input.csv' }],
    };

    expect(isTaskExecutionContext(value)).toBe(true);
    expect(assertTaskExecutionContext(value)).toEqual(value);
  });

  it('accepts canonical terminal task execution context subsets', () => {
    const value: TaskExecutionContext = {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      task_id: 'task_1',
      runner_id: 'runner_1',
      runner_session_scope: 'task_execution',
      api_base: 'http://localhost:20000/api/v1',
      execution_ticket: 'exec_1',
    };

    expect(isTaskExecutionContext(value)).toBe(true);
    expect(assertTaskExecutionContext(value)).toEqual(value);
  });

  it('rejects session-only execution contexts', () => {
    const value = {
      session_id: 'session_1',
      workspace_id: 'ws_1',
    };

    expect(isTaskExecutionContext(value)).toBe(false);
    expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
  });

  it('models runner dispatch envelopes with canonical runner_session_id only', () => {
    const envelope: AgentEnvelope = {
      type: 'server.request.start',
      request_id: 'request_1',
      runner_session_id: 'task_1',
      payload: {
        execution_context: {
          task_id: 'task_1',
        },
      },
    };

    expect(envelope.runner_session_id).toBe('task_1');
    expect(envelope).not.toHaveProperty('session_id');
  });

  it('rejects legacy chat and task discriminants', () => {
    for (const value of [
      {
        interaction_kind: 'chat',
        task_id: 'task_1',
      },
      {
        interaction_kind: 'notebook',
        task_id: 'task_1',
      },
      {
        task_id: 'task_1',
        chat: true,
      },
      {
        task_id: 'task_1',
        notebook: true,
      },
      {
        task_id: 'task_1',
        workload: 'chat',
      },
      {
        task_id: 'task_1',
        workload: 'notebook',
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects legacy external agent and session fields even when task_id is present', () => {
    for (const value of [
      {
        task_id: 'task_1',
        external_agent_id: 'agent_legacy',
      },
      {
        task_id: 'task_1',
        externalAgentId: 'agent_legacy',
      },
      {
        task_id: 'task_1',
        session_id: 'session_legacy',
      },
      {
        task_id: 'task_1',
        transport: 'agent_runner',
      },
      {
        task_id: 'task_1',
        internalAgent: true,
      },
      {
        task_id: 'task_1',
        chat_runner: true,
      },
      {
        task_id: 'task_1',
        notebook_runner: true,
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects unsupported runner session scopes', () => {
    const value = {
      task_id: 'task_1',
      runner_id: 'runner_1',
      runner_session_scope: 'legacy_session',
    };

    expect(isTaskExecutionContext(value)).toBe(false);
    expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
  });

  it('allows only canonical runner wire APIs without legacy chat transport aliases', () => {
    expect(SUPPORTED_AGENT_WIRE_APIS).toEqual([
      'openai_chat_completions',
      'openai_responses',
      'anthropic_messages',
    ]);

    for (const wireApi of SUPPORTED_AGENT_WIRE_APIS) {
      const value = {
        task_id: 'task_1',
        run_id: 'run_1',
        wire_api: wireApi,
      };

      expect(isTaskExecutionContext(value)).toBe(true);
      expect(assertTaskExecutionContext(value)).toEqual(value);
    }
  });

  it('rejects execution contexts with unsupported wire_api values', () => {
    for (const value of [
      {
        task_id: 'task_1',
        wire_api: 'anthropic',
      },
      {
        task_id: 'task_1',
        wire_api: 'chat',
      },
      {
        task_id: 'task_1',
        wire_api: 'responses',
      },
      {
        task_id: 'task_1',
        wire_api: 'notebook',
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('does not publish legacy public execution context aliases', () => {
    const protocolSource = readFileSync(
      path.join(process.cwd(), 'packages/agent-runner/src/protocol.ts'),
      'utf8',
    );

    expect(protocolSource).not.toMatch(/\bAgentExecutionContext\b/);
    expect(protocolSource).not.toMatch(/\bChatExecutionContext\b/);
    expect(protocolSource).not.toMatch(/\bNotebookExecutionContext\b/);
    expect(protocolSource).toContain('runner_session_id?: string');
    expect(protocolSource).not.toMatch(/\bsession_id\?:/);
  });
});
