import { describe, expect, it } from 'vitest';
import {
  PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
} from './contract-schema.js';
import {
  SUPPORTED_AGENT_WIRE_APIS,
  assertTaskExecutionContext,
  isTaskExecutionContext,
  type AgentEnvelope,
  type AgentServerHelloPayload,
  type AgentServerStartPayload,
  type TaskExecutionContext,
} from './protocol.js';

describe('agent-runner task execution context guards', () => {
  const requiredTaskPaths = {
    workspace_file_library_id: 'flib_1',
    workspace_binding_mode: 'file_library',
    runtime_profile: 'managed',
    task_home_segment: 'task_1',
    task_home_path: '/home/task_1',
    workspace_path: '/home/task_1/workspace',
    artifacts_path: '/home/task_1/workspace/.artifacts',
    library_root_path: '.',
  } as const;

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

  it('accepts request-scoped projected dependencies in the runner env projection shape', () => {
    const value: TaskExecutionContext = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      projected_dependencies: PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    };

    expect(isTaskExecutionContext(value)).toBe(true);
    expect(assertTaskExecutionContext(value)).toEqual(value);
  });

  it('accepts string projected dependency payloads', () => {
    const value: TaskExecutionContext = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      projected_dependencies: {
        dependencies: {
          'opaque-helper-env': 'PROJECTED_HELPER_ENV_JSON',
        },
      },
    };

    expect(isTaskExecutionContext(value)).toBe(true);
    expect(assertTaskExecutionContext(value)).toEqual(value);
  });

  it('rejects whitespace-only string projected dependency payloads', () => {
    const value = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      projected_dependencies: {
        dependencies: {
          'opaque-helper-env': '   ',
        },
      },
    };

    expect(isTaskExecutionContext(value)).toBe(false);
    expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
  });

  it('rejects disabled product-semantic keys in projected dependency fields', () => {
    for (const field of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
      const value = {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {
            'jira-auth': {
              fields: {
                token: 'projected_jira_token',
                [field]: 'disabled_product_semantic',
              },
            },
          },
        },
      };

      expect(isTaskExecutionContext(value), field).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects malformed request-scoped projected dependencies', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {},
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {
            'jira-auth': {
              fields: {
                token: 'projected_jira_token',
              },
            },
          },
          writable_scopes: ['project'],
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {
            'jira-auth': {
              fields: {},
            },
          },
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {
            'jira-auth': {
              fields: {
                token: 42,
              },
            },
          },
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        projected_dependencies: {
          dependencies: {
            'jira-auth': {
              fields: {
                token: 'projected_jira_token',
              },
              credential_files: ['legacy-secret'],
            },
          },
        },
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
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

  it('rejects nested execution context fields not present in the closed schema', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        resource_proxy: {
          base_url: 'http://api.local/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_1/proxy/openai',
          user_bearer_token: 'bearer_should_never_enter_context',
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        agent_task_model: {
          endpoint_id: 'ep_1',
          resolved_model: 'gpt-1',
          setting_revision: 'set_1',
          resolved_at: '2026-05-07T00:00:00.000Z',
          credential_files: [
            {
              relative_path: '.config/legacy-secret',
              content: 'secret',
            },
          ],
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_limits: {
          context_window: 200000,
          max_output_tokens: 32000,
          extra_limit: 1,
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_catalog: {
          input_modalities: ['text'],
          supports_search_tool: false,
          extra_capability: true,
        },
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects execution context model metadata with schema-invalid types and integer bounds', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_context_window: 0,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_auto_compact_token_limit: 1.5,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_limits: {
          context_window: 0,
          max_output_tokens: 32000,
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_limits: {
          context_window: 200000,
          max_output_tokens: 1.5,
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_catalog: {
          input_modalities: ['text', 42],
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_catalog: {
          supports_search_tool: 'false',
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        model_catalog: {
          apply_patch_tool_type: 'json',
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

  it('requires canonical workspace identity fields', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        workspace_file_library_id: undefined,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        workspace_binding_mode: undefined,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        runtime_profile: undefined,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        task_home_segment: undefined,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        workspace_file_library_id: '',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        workspace_binding_mode: 'legacy_mount',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        runtime_profile: 'desktop',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        task_home_segment: '../task_1',
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('requires canonical task home, workspace, artifact, and library root path fields', () => {
    for (const value of [
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/workspace/.artifacts',
        library_root_path: '.',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        artifacts_path: '/home/task_1/workspace/.artifacts',
        library_root_path: '.',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        library_root_path: '.',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/workspace/.artifacts',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/workspace/.artifacts',
        library_root_path: 'agent-tasks/task_1',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/files',
        artifacts_path: '/home/task_1/files/.artifacts',
        library_root_path: '.',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/.artifacts',
        library_root_path: '.',
      },
      {
        task_id: 'task_1',
        workspace_file_library_id: 'flib_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'managed',
        task_home_segment: 'task_1',
        task_home_path: '/home/task_2',
        workspace_path: '/home/task_2/workspace',
        artifacts_path: '/home/task_2/workspace/.artifacts',
        library_root_path: '.',
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

  it('rejects retired secret delivery and disabled product-semantic fields', () => {
    for (const value of [
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        user_bearer_token: 'bearer_should_never_enter_context',
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        credential_files: [
          {
            relative_path: '.config/legacy-secret',
            content: 'secret',
          },
        ],
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        context_store: {
          scopes: ['project'],
        },
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        managed_credential_refresh: true,
      },
      {
        task_id: 'task_1',
        ...requiredTaskPaths,
        writable_scopes: ['project'],
      },
    ]) {
      expect(isTaskExecutionContext(value)).toBe(false);
      expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
    }
  });

  it('rejects unknown execution context fields to match the closed contract schema', () => {
    const value = {
      task_id: 'task_1',
      ...requiredTaskPaths,
      unexpected_secret: 'secret',
    };

    expect(isTaskExecutionContext(value)).toBe(false);
    expect(() => assertTaskExecutionContext(value)).toThrowError('task_execution_context_invalid');
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

  it('keeps legacy public protocol fields out of typed runner payloads', () => {
    type EnvelopeHasRunnerSessionId = 'runner_session_id' extends keyof AgentEnvelope
      ? true
      : false;
    type EnvelopeHasSessionId = 'session_id' extends keyof AgentEnvelope ? true : false;
    type StartPayloadHasExecutionContext =
      'execution_context' extends keyof AgentServerStartPayload ? true : false;
    type StartPayloadRequiresExecutionContext =
      AgentServerStartPayload extends { execution_context: TaskExecutionContext } ? true : false;
    type StartPayloadRequiresModel =
      AgentServerStartPayload extends { model: string } ? true : false;
    type StartPayloadRequiresStream =
      AgentServerStartPayload extends { stream: true } ? true : false;
    type StartPayloadRequiresMessages =
      AgentServerStartPayload extends { messages: Array<Record<string, unknown>> } ? true : false;
    type HelloPayloadHasResourceProxy =
      'resource_proxy' extends keyof AgentServerHelloPayload ? true : false;
    type ContextHasUserBearerToken =
      'user_bearer_token' extends keyof TaskExecutionContext ? true : false;
    type ContextHasCredentialFiles =
      'credential_files' extends keyof TaskExecutionContext ? true : false;
    type ContextHasInteractionKind =
      'interaction_kind' extends keyof TaskExecutionContext ? true : false;
    type ContextHasProjectedDependencies =
      'projected_dependencies' extends keyof TaskExecutionContext ? true : false;

    const envelopeHasRunnerSessionId = true satisfies EnvelopeHasRunnerSessionId;
    const envelopeHasSessionId = false satisfies EnvelopeHasSessionId;
    const startPayloadHasExecutionContext = true satisfies StartPayloadHasExecutionContext;
    const startPayloadRequiresExecutionContext = true satisfies StartPayloadRequiresExecutionContext;
    const startPayloadRequiresModel = true satisfies StartPayloadRequiresModel;
    const startPayloadRequiresStream = true satisfies StartPayloadRequiresStream;
    const startPayloadRequiresMessages = true satisfies StartPayloadRequiresMessages;
    const helloPayloadHasResourceProxy = false satisfies HelloPayloadHasResourceProxy;
    const contextHasUserBearerToken = false satisfies ContextHasUserBearerToken;
    const contextHasCredentialFiles = false satisfies ContextHasCredentialFiles;
    const contextHasInteractionKind = false satisfies ContextHasInteractionKind;
    const contextHasProjectedDependencies = true satisfies ContextHasProjectedDependencies;

    expect(envelopeHasRunnerSessionId).toBe(true);
    expect(envelopeHasSessionId).toBe(false);
    expect(startPayloadHasExecutionContext).toBe(true);
    expect(startPayloadRequiresExecutionContext).toBe(true);
    expect(startPayloadRequiresModel).toBe(true);
    expect(startPayloadRequiresStream).toBe(true);
    expect(startPayloadRequiresMessages).toBe(true);
    expect(helloPayloadHasResourceProxy).toBe(false);
    expect(contextHasUserBearerToken).toBe(false);
    expect(contextHasCredentialFiles).toBe(false);
    expect(contextHasInteractionKind).toBe(false);
    expect(contextHasProjectedDependencies).toBe(true);
  });
});
