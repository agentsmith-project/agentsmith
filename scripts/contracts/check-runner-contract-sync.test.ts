import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  checkRunnerContractSync,
  formatRunnerContractSyncErrors,
} from './check-runner-contract-sync';
import {
  RUNNER_CONTRACT_TERMINAL_FIXTURES,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
} from '../../packages/agent-runner/src/contract-schema.js';

function createExecutionContextSchema(options: {
  required?: string[];
  extraProperties?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const required = options.required ?? [
    'task_id',
    'workspace_file_library_id',
    'workspace_binding_mode',
    'runtime_profile',
    'task_home_segment',
    'task_home_path',
    'workspace_path',
    'artifacts_path',
    'library_root_path',
  ];
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      api_base: { type: 'string' },
      workspace_id: { type: 'string' },
      project_id: { type: 'string' },
      task_id: { type: 'string' },
      run_id: { type: 'string' },
      runner_id: { type: 'string' },
      runner_session_scope: {
        type: 'string',
        enum: ['agent_presence', 'task_execution'],
      },
      execution_ticket: { type: 'string' },
      endpoint_id: { type: 'string' },
      agent_task_model: {
        type: 'object',
        additionalProperties: false,
        required: ['endpoint_id', 'resolved_model', 'setting_revision', 'resolved_at'],
        properties: {
          endpoint_id: { type: 'string' },
          endpoint_display_name: { type: 'string' },
          resolved_model: { type: 'string' },
          upstream_protocol: {
            type: 'string',
            enum: ['openai_chat_completions', 'openai_responses', 'anthropic_messages'],
          },
          setting_revision: { type: 'string' },
          policy_decision_id: { type: 'string' },
          resolved_at: { type: 'string', format: 'date-time' },
        },
      },
      resource_proxy: {
        type: 'object',
        additionalProperties: false,
        required: ['base_url'],
        properties: {
          base_url: { type: 'string' },
        },
      },
      wire_api: {
        type: 'string',
        enum: ['openai_chat_completions', 'openai_responses', 'anthropic_messages'],
      },
      model: { type: 'string' },
      username: { type: 'string' },
      workspace_file_library_id: { type: 'string' },
      workspace_binding_mode: {
        type: 'string',
        enum: ['file_library', 'pre_mounted'],
      },
      runtime_profile: {
        type: 'string',
        enum: ['managed', 'developer'],
      },
      task_home_segment: { type: 'string' },
      task_home_path: { type: 'string' },
      workspace_path: { type: 'string' },
      artifacts_path: { type: 'string' },
      library_root_path: { const: '.' },
      workspace_file_library_name: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
      },
      task_inputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      model_context_window: { type: 'integer', minimum: 1 },
      model_auto_compact_token_limit: { type: 'integer', minimum: 1 },
      model_limits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          context_window: { type: 'integer', minimum: 1 },
          max_output_tokens: { type: 'integer', minimum: 1 },
        },
      },
      model_catalog: {
        type: 'object',
        additionalProperties: false,
        properties: {
          input_modalities: {
            type: 'array',
            items: { type: 'string' },
          },
          supports_search_tool: { type: 'boolean' },
          supports_parallel_tool_calls: { type: 'boolean' },
          apply_patch_tool_type: {
            type: 'string',
            enum: ['freeform', 'function'],
          },
        },
      },
      ...(options.extraProperties ?? {}),
    },
  };
}

function createAsyncApiFixture(options: {
  executionContextSchema?: Record<string, unknown>;
  includeTerminalStart?: boolean;
  includeTerminalAdopt?: boolean;
  includeTerminalClose?: boolean;
  includeRecovery?: boolean;
} = {}): Record<string, unknown> {
  const executionContextSchema = options.executionContextSchema ?? createExecutionContextSchema();
  return {
    asyncapi: '3.0.0',
    components: {
      schemas: {
        TaskExecutionContext: executionContextSchema,
        RunnerActiveTerminalDescriptor: {
          type: 'object',
          required: [
            'terminal_session_id',
            'runner_session_id',
            'generation',
            'cols',
            'rows',
          ],
          properties: {
            terminal_session_id: { type: 'string' },
            runner_session_id: { type: 'string' },
            generation: { type: 'integer', minimum: 1 },
            cols: { type: 'integer', minimum: 20 },
            rows: { type: 'integer', minimum: 5 },
            cwd: { type: 'string' },
          },
        },
      },
      messages: {
        ...(options.includeTerminalStart !== false
          ? {
            serverTerminalStart: {
              name: 'server.terminal.start',
              payload: {
                type: 'object',
                required: [
                  'type',
                  'runner_session_id',
                  'terminal_session_id',
                  'timestamp',
                  'payload',
                ],
                properties: {
                  type: { const: 'server.terminal.start' },
                  runner_session_id: { type: 'string' },
                  terminal_session_id: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  payload: {
                    type: 'object',
                    required: ['cols', 'rows', 'execution_context'],
                    properties: {
                      cols: { type: 'integer', minimum: 20 },
                      rows: { type: 'integer', minimum: 5 },
                      shell: { type: 'string' },
                      cwd: { type: 'string' },
                      execution_context: executionContextSchema,
                    },
                  },
                },
              },
            },
          }
          : {}),
        ...(options.includeTerminalAdopt !== false
          ? {
            serverTerminalAdopt: {
              name: 'server.terminal.adopt',
              payload: {
                type: 'object',
                properties: {
                  type: { const: 'server.terminal.adopt' },
                  payload: {
                    type: 'object',
                    required: [
                      'adopt_attempt_id',
                      'connection_epoch',
                      'generation',
                      'cols',
                      'rows',
                    ],
                    properties: {
                      adopt_attempt_id: { type: 'string' },
                      connection_epoch: { type: 'integer', minimum: 1 },
                      generation: { type: 'integer', minimum: 1 },
                      cols: { type: 'integer', minimum: 20 },
                      rows: { type: 'integer', minimum: 5 },
                    },
                  },
                },
              },
            },
          }
          : {}),
        ...(options.includeTerminalClose !== false
          ? {
            serverTerminalClose: {
              name: 'server.terminal.close',
              payload: {
                type: 'object',
                properties: {
                  type: { const: 'server.terminal.close' },
                  payload: {
                    type: 'object',
                    required: [
                      'close_attempt_id',
                      'generation',
                      'connection_epoch',
                      'reason',
                    ],
                    properties: {
                      close_attempt_id: { type: 'string' },
                      generation: { type: 'integer', minimum: 1 },
                      connection_epoch: { type: 'integer', minimum: 1 },
                      reason: {
                        type: 'string',
                        enum: [
                          'user_requested',
                          'permission_revoked',
                          'garbage_collect',
                          'shutdown',
                        ],
                      },
                    },
                  },
                },
              },
            },
          }
          : {}),
        ...(options.includeRecovery !== false
          ? {
            agentReady: {
              name: 'agent.ready',
              payload: {
                type: 'object',
                properties: {
                  type: { const: 'agent.ready' },
                  payload: {
                    type: 'object',
                    properties: {
                      active_terminals: {
                        type: 'array',
                        maxItems: 64,
                        items: {
                          type: 'object',
                          required: [
                            'terminal_session_id',
                            'runner_session_id',
                            'generation',
                            'cols',
                            'rows',
                          ],
                          properties: {
                            terminal_session_id: { type: 'string' },
                            runner_session_id: { type: 'string' },
                            generation: { type: 'integer', minimum: 1 },
                            cols: { type: 'integer', minimum: 20 },
                            rows: { type: 'integer', minimum: 5 },
                            cwd: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }
          : {}),
      },
    },
  };
}

describe('check-runner-contract-sync', () => {
  it('passes when AsyncAPI execution_context and terminal recovery frames match runner contract truth', () => {
    expect(checkRunnerContractSync(createAsyncApiFixture()).errors).toEqual([]);
  });

  it('rejects AsyncAPI execution_context fields not exported by the runner contract', () => {
    const result = checkRunnerContractSync(createAsyncApiFixture({
      executionContextSchema: createExecutionContextSchema({
        extraProperties: {
          user_bearer_token: { type: 'string' },
          credential_files: { type: 'array' },
        },
      }),
    }));

    expect(result.errors).toEqual([
      {
        code: 'execution_context_extra_fields',
        message: 'server.terminal.start payload.execution_context has fields not in runner contract: credential_files, user_bearer_token',
        path: 'components.messages.serverTerminalStart.payload.properties.payload.properties.execution_context',
      },
    ]);
    expect(formatRunnerContractSyncErrors(result.errors)).toContain('credential_files');
    expect(formatRunnerContractSyncErrors(result.errors)).toContain('user_bearer_token');
  });

  it('rejects AsyncAPI execution_context schemas missing runner contract required fields', () => {
    const result = checkRunnerContractSync(createAsyncApiFixture({
      executionContextSchema: createExecutionContextSchema({
        required: ['task_id'],
      }),
    }));

    expect(result.errors).toEqual([
      {
        code: 'execution_context_missing_required_fields',
        message: 'server.terminal.start payload.execution_context is missing required runner contract fields: artifacts_path, library_root_path, runtime_profile, task_home_path, task_home_segment, workspace_binding_mode, workspace_file_library_id, workspace_path',
        path: 'components.messages.serverTerminalStart.payload.properties.payload.properties.execution_context.required',
      },
    ]);
  });

  it('rejects nested execution_context schema drift against the runner contract schema', () => {
    const executionContextSchema = createExecutionContextSchema();
    const properties = executionContextSchema.properties as Record<string, unknown>;
    const resourceProxy = properties.resource_proxy as Record<string, unknown>;
    const resourceProxyProperties = resourceProxy.properties as Record<string, unknown>;

    resourceProxyProperties.base_url = { type: 'integer' };

    expect(checkRunnerContractSync(createAsyncApiFixture({
      executionContextSchema,
    })).errors).toEqual([
      {
        code: 'execution_context_schema_mismatch',
        message: 'server.terminal.start payload.execution_context schema differs from runner contract at properties.resource_proxy.properties.base_url.type: expected "string", got "integer"',
        path: 'components.messages.serverTerminalStart.payload.properties.payload.properties.execution_context.properties.resource_proxy.properties.base_url.type',
      },
    ]);
  });

  it('passes against the real checked-in AsyncAPI JSON', () => {
    const asyncApi = JSON.parse(
      readFileSync(path.join(process.cwd(), 'docs/contracts/specs/asyncapi.json'), 'utf8'),
    ) as unknown;

    expect(checkRunnerContractSync(asyncApi).errors).toEqual([]);
  });

  it('accepts terminal recovery active terminal descriptors through local component refs', () => {
    const asyncApi = createAsyncApiFixture();
    const messages = ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>;
    const agentReady = messages.agentReady as Record<string, unknown>;
    const payload = agentReady.payload as Record<string, unknown>;
    const properties = payload.properties as Record<string, unknown>;
    const framePayload = (properties.payload as Record<string, unknown>);
    const framePayloadProperties = framePayload.properties as Record<string, unknown>;
    const activeTerminals = framePayloadProperties.active_terminals as Record<string, unknown>;

    activeTerminals.items = { $ref: '#/components/schemas/RunnerActiveTerminalDescriptor' };

    expect(checkRunnerContractSync(asyncApi).errors).toEqual([]);
  });

  it('accepts execution_context schemas through local component refs', () => {
    const asyncApi = createAsyncApiFixture();
    const messages = ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>;
    const serverTerminalStart = messages.serverTerminalStart as Record<string, unknown>;
    const payload = serverTerminalStart.payload as Record<string, unknown>;
    const properties = payload.properties as Record<string, unknown>;
    const framePayload = properties.payload as Record<string, unknown>;
    const framePayloadProperties = framePayload.properties as Record<string, unknown>;

    framePayloadProperties.execution_context = {
      $ref: '#/components/schemas/TaskExecutionContext',
    };

    expect(checkRunnerContractSync(asyncApi).errors).toEqual([]);
  });

  it('requires server terminal start, adopt, close, and recovery active terminal schemas', () => {
    const result = checkRunnerContractSync(createAsyncApiFixture({
      includeTerminalStart: false,
      includeTerminalAdopt: false,
      includeTerminalClose: false,
      includeRecovery: false,
    }));

    expect(result.errors).toEqual([
      {
        code: 'missing_message',
        message: 'AsyncAPI is missing required runner message: server.terminal.start',
        path: 'components.messages',
      },
      {
        code: 'missing_message',
        message: 'AsyncAPI is missing required runner message: server.terminal.adopt',
        path: 'components.messages',
      },
      {
        code: 'missing_message',
        message: 'AsyncAPI is missing required runner message: server.terminal.close',
        path: 'components.messages',
      },
      {
        code: 'missing_terminal_recovery_schema',
        message: 'AsyncAPI agent.ready payload must expose active_terminals for terminal recovery',
        path: 'components.messages',
      },
    ]);
  });

  it('rejects terminal fixture payload required-key drift in AsyncAPI messages', () => {
    const asyncApi = createAsyncApiFixture();
    const messages = ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>;
    const serverTerminalStart = messages.serverTerminalStart as Record<string, unknown>;
    const payload = serverTerminalStart.payload as Record<string, unknown>;
    const properties = payload.properties as Record<string, unknown>;
    const framePayload = properties.payload as Record<string, unknown>;

    framePayload.required = ['cols', 'rows'];

    expect(checkRunnerContractSync(asyncApi).errors).toEqual([
      {
        code: 'terminal_payload_required_keys_mismatch',
        message: 'server.terminal.start payload required keys differ from runner fixture: expected cols, execution_context, rows, got cols, rows',
        path: 'components.messages.serverTerminalStart.payload.properties.payload.required',
      },
    ]);
  });

  it('rejects terminal recovery active terminal required-key drift in AsyncAPI messages', () => {
    const asyncApi = createAsyncApiFixture();
    const messages = ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>;
    const agentReady = messages.agentReady as Record<string, unknown>;
    const payload = agentReady.payload as Record<string, unknown>;
    const properties = payload.properties as Record<string, unknown>;
    const framePayload = properties.payload as Record<string, unknown>;
    const framePayloadProperties = framePayload.properties as Record<string, unknown>;
    const activeTerminals = framePayloadProperties.active_terminals as Record<string, unknown>;
    const activeTerminalItems = activeTerminals.items as Record<string, unknown>;

    activeTerminalItems.required = [
      'terminal_session_id',
      'runner_session_id',
      'generation',
      'cols',
    ];

    expect(checkRunnerContractSync(asyncApi).errors).toEqual([
      {
        code: 'terminal_recovery_required_keys_mismatch',
        message: 'agent.ready active terminal required keys differ from runner fixture: expected cols, generation, rows, runner_session_id, terminal_session_id, got cols, generation, runner_session_id, terminal_session_id',
        path: 'components.messages.agentReady.payload.properties.payload.properties.active_terminals.items.required',
      },
    ]);
  });

  it('keeps terminal fixture payload keys aligned with the real AsyncAPI schemas', () => {
    const asyncApi = JSON.parse(
      readFileSync(path.join(process.cwd(), 'docs/contracts/specs/asyncapi.json'), 'utf8'),
    ) as Record<string, unknown>;
    const messages = ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>;
    const expectations = [
      ['serverTerminalStart', RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.payload],
      ['serverTerminalAdopt', RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalAdopt.payload],
      ['serverTerminalClose', RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalClose.payload],
    ] as const;

    for (const [messageKey, fixturePayload] of expectations) {
      const message = messages[messageKey] as Record<string, unknown>;
      const payload = message.payload as Record<string, unknown>;
      const properties = payload.properties as Record<string, unknown>;
      const framePayload = properties.payload as Record<string, unknown>;
      const required = [...((framePayload.required ?? []) as string[])].sort();

      expect(required).toEqual(Object.keys(fixturePayload).sort());
    }

    const agentReady = messages.agentReady as Record<string, unknown>;
    const readyPayload = agentReady.payload as Record<string, unknown>;
    const readyProperties = readyPayload.properties as Record<string, unknown>;
    const readyFramePayload = readyProperties.payload as Record<string, unknown>;
    const readyFramePayloadProperties = readyFramePayload.properties as Record<string, unknown>;

    expect(readyFramePayloadProperties.active_terminals).toBeTruthy();
    expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('is exposed as an npm contract gate and wired into contracts:check', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['contracts:check-runner-contract-sync']).toBe(
      'tsx scripts/contracts/check-runner-contract-sync.ts',
    );
    expect(scripts['contracts:check']).toContain(
      'npm run contracts:check-runner-contract-sync',
    );
    expect(scripts['contracts:check']).toContain(
      'npm run contracts:check-release-boundary',
    );
  });
});
