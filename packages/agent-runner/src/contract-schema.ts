import type {
  AgentWireApi,
  TaskExecutionContext,
  TaskRuntimeProfile,
  TaskWorkspaceBindingMode,
} from './protocol.js';

export type JsonSchema = {
  readonly type?: string;
  readonly const?: string | number | boolean | null;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly format?: string;
  readonly minimum?: number;
  readonly additionalProperties?: boolean | JsonSchema;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly oneOf?: readonly JsonSchema[];
};

export type TaskExecutionContextField = keyof TaskExecutionContext;
export type TaskExecutionContextFixtureName = keyof typeof TASK_EXECUTION_CONTEXT_FIXTURES;

const taskExecutionContextAllowedFieldMap = {
  api_base: true,
  workspace_id: true,
  project_id: true,
  task_id: true,
  run_id: true,
  runner_id: true,
  runner_session_scope: true,
  execution_ticket: true,
  endpoint_id: true,
  agent_task_model: true,
  resource_proxy: true,
  wire_api: true,
  model: true,
  username: true,
  workspace_file_library_id: true,
  workspace_binding_mode: true,
  runtime_profile: true,
  task_home_segment: true,
  task_home_path: true,
  workspace_path: true,
  artifacts_path: true,
  library_root_path: true,
  workspace_file_library_name: true,
  task_inputs: true,
  model_context_window: true,
  model_auto_compact_token_limit: true,
  model_limits: true,
  model_catalog: true,
} satisfies Record<TaskExecutionContextField, true>;

function objectKeys<T extends object>(value: T): Array<keyof T> {
  return Object.keys(value) as Array<keyof T>;
}

export const TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS = [
  'task_id',
  'workspace_file_library_id',
  'workspace_binding_mode',
  'runtime_profile',
  'task_home_segment',
  'task_home_path',
  'workspace_path',
  'artifacts_path',
  'library_root_path',
] as const satisfies readonly TaskExecutionContextField[];

export const TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS = objectKeys(
  taskExecutionContextAllowedFieldMap,
) as TaskExecutionContextField[];

export const TASK_EXECUTION_CONTEXT_REJECTED_LEGACY_FIELDS = [
  'external_agent_id',
  'externalAgentId',
  'transport',
  'internalAgent',
  'interaction_kind',
  'workload',
  'session_id',
  'chat',
  'notebook',
  'chat_runner',
  'notebook_runner',
  'container_workspace_path',
  'workspace_dir_name',
  'user_bearer_token',
  'credential_files',
] as const;

const supportedAgentWireApis = [
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
] as const satisfies readonly AgentWireApi[];

const supportedWorkspaceBindingModes = [
  'file_library',
  'pre_mounted',
] as const satisfies readonly TaskWorkspaceBindingMode[];

const supportedRuntimeProfiles = [
  'managed',
  'developer',
] as const satisfies readonly TaskRuntimeProfile[];

export const TASK_EXECUTION_CONTEXT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
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
          enum: supportedAgentWireApis,
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
      enum: supportedAgentWireApis,
    },
    model: { type: 'string' },
    username: { type: 'string' },
    workspace_file_library_id: { type: 'string' },
    workspace_binding_mode: {
      type: 'string',
      enum: supportedWorkspaceBindingModes,
    },
    runtime_profile: {
      type: 'string',
      enum: supportedRuntimeProfiles,
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
  },
} as const satisfies JsonSchema;

const managedTaskRunFixture = {
  api_base: 'http://localhost:20000/api/v1',
  workspace_id: 'ws_1',
  project_id: 'proj_1',
  task_id: 'task_1',
  run_id: 'run_1',
  runner_id: 'runner_1',
  runner_session_scope: 'task_execution',
  execution_ticket: 'exec_1',
  endpoint_id: 'ep_1',
  agent_task_model: {
    endpoint_id: 'ep_1',
    endpoint_display_name: 'Primary OpenAI',
    resolved_model: 'gpt-5-codex',
    upstream_protocol: 'openai_responses',
    setting_revision: 'set_1',
    policy_decision_id: 'policy_1',
    resolved_at: '2026-05-07T00:00:00.000Z',
  },
  resource_proxy: {
    base_url: 'http://localhost:20000/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_1/proxy/openai',
  },
  wire_api: 'openai_responses',
  model: 'gpt-5-codex',
  username: 'alice@example.com',
  workspace_file_library_id: 'flib_1',
  workspace_binding_mode: 'file_library',
  runtime_profile: 'managed',
  task_home_segment: 'task_1',
  task_home_path: '/home/task_1',
  workspace_path: '/home/task_1/workspace',
  artifacts_path: '/home/task_1/workspace/.artifacts',
  library_root_path: '.',
  workspace_file_library_name: 'Project workspace',
  task_inputs: [{ kind: 'library_object', key: 'input.csv' }],
  model_context_window: 200000,
  model_auto_compact_token_limit: 160000,
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
} as const satisfies TaskExecutionContext;

const terminalStartFixture = {
  api_base: 'http://localhost:20000/api/v1',
  workspace_id: 'ws_1',
  project_id: 'proj_1',
  task_id: 'task_1',
  run_id: 'run_1',
  runner_id: 'runner_1',
  runner_session_scope: 'task_execution',
  execution_ticket: 'exec_terminal_1',
  username: 'alice@example.com',
  workspace_file_library_id: 'flib_1',
  workspace_binding_mode: 'file_library',
  runtime_profile: 'managed',
  task_home_segment: 'task_1',
  task_home_path: '/home/task_1',
  workspace_path: '/home/task_1/workspace',
  artifacts_path: '/home/task_1/workspace/.artifacts',
  library_root_path: '.',
  workspace_file_library_name: 'Project workspace',
} as const satisfies TaskExecutionContext;

export const TASK_EXECUTION_CONTEXT_FIXTURES = {
  managedTaskRun: managedTaskRunFixture,
  terminalStart: terminalStartFixture,
  terminalRecovery: terminalStartFixture,
} as const satisfies Record<string, TaskExecutionContext>;

export function getTaskExecutionContextFixture(
  name: TaskExecutionContextFixtureName,
): TaskExecutionContext {
  return TASK_EXECUTION_CONTEXT_FIXTURES[name];
}

export const RUNNER_CONTRACT_TERMINAL_FIXTURES = {
  serverTerminalStart: {
    type: 'server.terminal.start',
    runner_session_id: 'task_1',
    terminal_session_id: 'term_1',
    timestamp: '2026-05-07T00:00:00.000Z',
    payload: {
      cols: 120,
      rows: 30,
      execution_context: terminalStartFixture,
    },
  },
  serverTerminalAdopt: {
    type: 'server.terminal.adopt',
    request_id: 'adopt_1',
    runner_session_id: 'task_1',
    terminal_session_id: 'term_1',
    timestamp: '2026-05-07T00:00:01.000Z',
    payload: {
      adopt_attempt_id: 'adopt_1',
      connection_epoch: 7,
      generation: 1,
      cols: 120,
      rows: 30,
    },
  },
  serverTerminalClose: {
    type: 'server.terminal.close',
    request_id: 'close_1',
    runner_session_id: 'task_1',
    terminal_session_id: 'term_1',
    timestamp: '2026-05-07T00:00:02.000Z',
    payload: {
      close_attempt_id: 'close_1',
      generation: 1,
      connection_epoch: 7,
      reason: 'user_requested',
    },
  },
  terminalRecoveryReady: {
    type: 'agent.ready',
    timestamp: '2026-05-07T00:00:03.000Z',
    payload: {
      runner_instance_id: 'runner_instance_1',
      connection_epoch: 7,
      active_terminals: [
        {
          terminal_session_id: 'term_1',
          runner_session_id: 'task_1',
          generation: 1,
          cols: 120,
          rows: 30,
          cwd: '/home/task_1/workspace',
        },
      ],
    },
  },
} as const;
