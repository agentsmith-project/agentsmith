import { describe, expect, it } from 'vitest';
import {
  PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
  RUNNER_CONTRACT_TERMINAL_FIXTURES,
  TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS,
  TASK_EXECUTION_CONTEXT_FIXTURES,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
  TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
  TASK_EXECUTION_CONTEXT_REJECTED_LEGACY_FIELDS,
  getTaskExecutionContextFixture,
} from './contract-schema.js';
import {
  RUNNER_CONTRACT_TERMINAL_FIXTURES as PUBLIC_RUNNER_CONTRACT_TERMINAL_FIXTURES,
  TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS as PUBLIC_TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA as PUBLIC_TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
  TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS as PUBLIC_TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
} from './index.js';
import { assertTaskExecutionContext } from './protocol.js';

describe('agent-runner contract schema', () => {
  it('exports the canonical TaskExecutionContext required and allowed field sets', () => {
    expect(TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS).toEqual([
      'task_id',
      'workspace_file_library_id',
      'workspace_binding_mode',
      'runtime_profile',
      'task_home_segment',
      'task_home_path',
      'workspace_path',
      'artifacts_path',
      'library_root_path',
    ]);

    expect(TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS).toEqual([
      'api_base',
      'workspace_id',
      'project_id',
      'task_id',
      'run_id',
      'runner_id',
      'runner_session_scope',
      'execution_ticket',
      'endpoint_id',
      'agent_task_model',
      'resource_proxy',
      'projected_dependencies',
      'wire_api',
      'model',
      'username',
      'workspace_file_library_id',
      'workspace_binding_mode',
      'runtime_profile',
      'task_home_segment',
      'task_home_path',
      'workspace_path',
      'artifacts_path',
      'library_root_path',
      'workspace_file_library_name',
      'task_inputs',
      'model_context_window',
      'model_auto_compact_token_limit',
      'model_limits',
      'model_catalog',
    ]);
  });

  it('publishes a closed JSON schema that rejects retired execution context fields', () => {
    expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA.required).toEqual([
      ...TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
    ]);

    for (const field of TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS) {
      expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA.properties).toHaveProperty(field);
    }
    for (const legacyField of TASK_EXECUTION_CONTEXT_REJECTED_LEGACY_FIELDS) {
      expect(TASK_EXECUTION_CONTEXT_JSON_SCHEMA.properties).not.toHaveProperty(legacyField);
    }
    expect(TASK_EXECUTION_CONTEXT_REJECTED_LEGACY_FIELDS).toEqual(
      expect.arrayContaining([
        'user_bearer_token',
        'credential_files',
        'context_store',
        'managed_credential_refresh',
        'writable_scopes',
      ]),
    );
  });

  it('publishes projected dependencies as an optional closed execution context field', () => {
    const properties = TASK_EXECUTION_CONTEXT_JSON_SCHEMA.properties;
    const payloadObjectSchema = PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA.oneOf[0];
    const fieldsSchema = payloadObjectSchema.properties.fields;

    expect(TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS).not.toContain('projected_dependencies');
    expect(properties.projected_dependencies).toBe(PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA);
    expect(fieldsSchema.propertyNames).toMatchObject({
      type: 'string',
      pattern: expect.stringContaining('context[_]store'),
    });
    for (const rejected of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
      expect(JSON.stringify(fieldsSchema)).not.toContain(rejected);
    }
    expect(assertTaskExecutionContext({
      ...TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun,
      projected_dependencies: PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    })).toEqual({
      ...TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun,
      projected_dependencies: PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    });
  });

  it('projects runtime guard string and path constraints into the JSON schema', () => {
    const properties = TASK_EXECUTION_CONTEXT_JSON_SCHEMA.properties;
    const agentTaskModel = properties.agent_task_model.properties;
    const resourceProxy = properties.resource_proxy.properties;
    const nonEmptyStringSchema = {
      type: 'string',
      minLength: 1,
      pattern: '\\S',
    };
    const absoluteTaskPathSchema = {
      type: 'string',
      minLength: 1,
      pattern: '^(?!.*(?:^|/)[.][.](?:/|$))/',
    };

    expect(properties.task_id).toMatchObject(nonEmptyStringSchema);
    expect(properties.workspace_file_library_id).toMatchObject(nonEmptyStringSchema);
    expect(properties.task_home_segment).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
    });
    expect(properties.task_home_path).toMatchObject(absoluteTaskPathSchema);
    expect(properties.workspace_path).toMatchObject(absoluteTaskPathSchema);
    expect(properties.artifacts_path).toMatchObject(absoluteTaskPathSchema);
    expect(agentTaskModel.endpoint_id).toMatchObject(nonEmptyStringSchema);
    expect(agentTaskModel.resolved_model).toMatchObject(nonEmptyStringSchema);
    expect(agentTaskModel.setting_revision).toMatchObject(nonEmptyStringSchema);
    expect(agentTaskModel.resolved_at).toMatchObject({
      ...nonEmptyStringSchema,
      format: 'date-time',
    });
    expect(resourceProxy.base_url).toMatchObject(nonEmptyStringSchema);
  });

  it('exports runner contract schema through the public package entrypoint', () => {
    expect(PUBLIC_TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS).toBe(
      TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
    );
    expect(PUBLIC_TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS).toBe(
      TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS,
    );
    expect(PUBLIC_TASK_EXECUTION_CONTEXT_JSON_SCHEMA).toBe(TASK_EXECUTION_CONTEXT_JSON_SCHEMA);
    expect(PUBLIC_RUNNER_CONTRACT_TERMINAL_FIXTURES).toBe(
      RUNNER_CONTRACT_TERMINAL_FIXTURES,
    );
  });

  it('ships canonical task run, terminal start, and recovery contexts accepted by protocol guards', () => {
    for (const fixture of Object.values(TASK_EXECUTION_CONTEXT_FIXTURES)) {
      expect(assertTaskExecutionContext(fixture)).toEqual(fixture);
    }

    expect(getTaskExecutionContextFixture('managedTaskRun')).toEqual(
      TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun,
    );
    expect(getTaskExecutionContextFixture('terminalStart')).toEqual(
      TASK_EXECUTION_CONTEXT_FIXTURES.terminalStart,
    );
  });

  it('publishes terminal start, adopt, close, and recovery fixtures for downstream contract checks', () => {
    expect(RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart).toMatchObject({
      type: 'server.terminal.start',
      runner_session_id: 'task_1',
      terminal_session_id: 'term_1',
      payload: {
        cols: 120,
        rows: 30,
        execution_context: TASK_EXECUTION_CONTEXT_FIXTURES.terminalStart,
      },
    });
    expect(RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalAdopt).toMatchObject({
      type: 'server.terminal.adopt',
      runner_session_id: 'task_1',
      terminal_session_id: 'term_1',
      payload: {
        adopt_attempt_id: 'adopt_1',
        connection_epoch: 7,
        generation: 1,
        cols: 120,
        rows: 30,
      },
    });
    expect(RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalClose).toMatchObject({
      type: 'server.terminal.close',
      runner_session_id: 'task_1',
      terminal_session_id: 'term_1',
      payload: {
        close_attempt_id: 'close_1',
        generation: 1,
        connection_epoch: 7,
        reason: 'user_requested',
      },
    });
    expect(RUNNER_CONTRACT_TERMINAL_FIXTURES.terminalRecoveryReady).toMatchObject({
      type: 'agent.ready',
      payload: {
        connection_epoch: 7,
        active_terminals: [
          {
            terminal_session_id: 'term_1',
            runner_session_id: 'task_1',
            generation: 1,
          },
        ],
      },
    });
  });
});
