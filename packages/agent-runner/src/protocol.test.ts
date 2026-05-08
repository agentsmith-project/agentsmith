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
  const requiredTaskPaths = {
    task_home_path: '/home/task_1',
    workspace_path: '/home/task_1/workspace',
    artifacts_path: '/home/task_1/workspace/.artifacts',
  };

  it('accepts task execution context with task, run, endpoint, model, and workspace metadata', () => {
    const value: TaskExecutionContext = {
      task_id: 'task_1',
      ...requiredTaskPaths,
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

  it('accepts request-scoped resource proxy and agent task model snapshots', () => {
    const value = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      run_id: 'run_1',
      endpoint_id: 'ep_fresh',
      model: 'gpt-fresh',
      wire_api: 'openai_responses',
      agent_task_model: {
        endpoint_id: 'ep_fresh',
        resolved_model: 'gpt-fresh',
        upstream_protocol: 'openai_responses',
        setting_revision: 'set_fresh',
        resolved_at: '2026-05-07T00:00:00.000Z',
      },
      resource_proxy: {
        base_url: 'http://api.local/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      },
    };

    expect(isTaskExecutionContext(value)).toBe(true);
    expect(assertTaskExecutionContext(value)).toEqual(value);
  });

  it('rejects malformed request-scoped resource proxy and model snapshots', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        resource_proxy: {},
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        resource_proxy: { base_url: '' },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        agent_task_model: {
          endpoint_id: 'ep_1',
          resolved_model: 'gpt-1',
          upstream_protocol: 'legacy_chat',
          setting_revision: 'set_1',
        },
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('accepts canonical terminal task execution context subsets', () => {
    const value: TaskExecutionContext = {
      workspace_id: 'ws_1',
      project_id: 'proj_1',
      task_id: 'task_1',
      ...requiredTaskPaths,
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

  it('requires canonical task home, workspace, and artifact path fields', () => {
    for (const value of [
      {
        task_id: 'task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/workspace/.artifacts',
      },
      {
        task_id: 'task_1',
        task_home_path: '/home/task_1',
        artifacts_path: '/home/task_1/workspace/.artifacts',
      },
      {
        task_id: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
      },
      {
        task_id: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/files',
        artifacts_path: '/home/task_1/files/.artifacts',
      },
      {
        task_id: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/.artifacts',
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects legacy container_workspace_path even when canonical path fields are present', () => {
    const value = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      container_workspace_path: '/workspace/task_1',
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
          ...requiredTaskPaths,
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
        ...requiredTaskPaths,
      },
      {
        interaction_kind: 'notebook',
        task_id: 'task_1',
        ...requiredTaskPaths,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        chat: true,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        notebook: true,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        workload: 'chat',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
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
        ...requiredTaskPaths,
        external_agent_id: 'agent_legacy',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        externalAgentId: 'agent_legacy',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        session_id: 'session_legacy',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        transport: 'agent_runner',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        internalAgent: true,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        chat_runner: true,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
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
      ...requiredTaskPaths,
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
        ...requiredTaskPaths,
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
        ...requiredTaskPaths,
        wire_api: 'anthropic',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        wire_api: 'chat',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        wire_api: 'responses',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
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

  it('does not publish resource_proxy on server.hello payloads', () => {
    const protocolSource = readFileSync(
      path.join(process.cwd(), 'packages/agent-runner/src/protocol.ts'),
      'utf8',
    );
    const helloPayloadStart = protocolSource.indexOf('export type AgentServerHelloPayload');
    const nextTypeStart = protocolSource.indexOf('export type AgentEnvelope', helloPayloadStart);
    const helloPayloadSource = protocolSource.slice(helloPayloadStart, nextTypeStart);

    expect(helloPayloadSource).not.toContain('resource_proxy');
  });
});
