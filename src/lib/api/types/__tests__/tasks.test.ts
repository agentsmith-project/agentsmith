import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { components, operations, paths } from '../../types.generated';
import type {
  CreateTaskRequest,
  StartTaskRunRequest,
  Task,
  TaskActivityItem,
  TaskRunnerBindingOptionsResponse,
} from '@/lib/types/task';

type ForbiddenCreateTaskSelectors = Extract<
  keyof CreateTaskRequest,
  | 'runner_selection'
  | 'runner_id'
  | 'agent_id'
  | 'agent_name'
  | 'is_default'
  | 'endpoint_id'
  | 'model'
  | 'default_endpoint_id'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenGeneratedCreateTaskSelectors = Extract<
  keyof components['schemas']['CreateTaskRequest'],
  | 'runner_selection'
  | 'runner_id'
  | 'agent_id'
  | 'agent_name'
  | 'is_default'
  | 'endpoint_id'
  | 'model'
  | 'default_endpoint_id'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenStartTaskRunRunnerFields = Extract<
  keyof StartTaskRunRequest,
  | 'runner_selection'
  | 'bound_runner_id'
  | 'runner_id'
  | 'agent_runner_id'
  | 'agent_id'
  | 'agent_name'
  | 'is_default'
  | 'endpoint_id'
  | 'model'
  | 'default_endpoint_id'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenGeneratedStartTaskRunRunnerFields = Extract<
  keyof components['schemas']['StartTaskRunRequest'],
  | 'runner_selection'
  | 'bound_runner_id'
  | 'runner_id'
  | 'agent_runner_id'
  | 'agent_id'
  | 'agent_name'
  | 'is_default'
  | 'endpoint_id'
  | 'model'
  | 'default_endpoint_id'
  | 'execution_preference'
  | 'execution_preferences'
>;
type ForbiddenBindingOptionSecrets = Extract<
  keyof TaskRunnerBindingOptionsResponse['options'][number],
  'default_endpoint_id' | 'diagnostics' | 'config' | 'endpoint' | 'key' | 'connection_info'
>;
type RunnerBindingOptionsPathParams = NonNullable<
  paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/runner-binding-options']['parameters']['path']
>;
type RunnerBindingOptionsOperationPathParams =
  operations['getTaskRunnerBindingOptions']['parameters']['path'];
type ExpectedRunnerBindingOptionsPathParams = {
  projectId: string;
  workspaceId: string;
};
type CreateTaskValidationError =
  operations['createTask']['responses'][422]['content']['application/json'];
type ExpectedCreateTaskValidationError =
  | components['schemas']['AgentTaskWorkspaceModeInvalidError']
  | components['schemas']['AgentTaskWorkspaceFileLibraryRequiredError']
  | components['schemas']['AgentTaskFileTemplateRequiredError']
  | components['schemas']['ApiError']
  | components['schemas']['InvalidBindingTargetError'];

describe('Agent Task bound runner contracts', () => {
  it('keeps runner binding task-scoped in local and generated task types', () => {
    expectTypeOf<ForbiddenCreateTaskSelectors>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenGeneratedCreateTaskSelectors>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenStartTaskRunRunnerFields>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenGeneratedStartTaskRunRunnerFields>().toEqualTypeOf<never>();

    expectTypeOf<CreateTaskRequest['bound_runner_id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<components['schemas']['CreateTaskRequest']['bound_runner_id']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Task>().toMatchTypeOf<{
      bound_runner_id?: string;
      bound_runner_kind?: 'managed' | 'developer';
      runner_binding_source?: 'default_managed' | 'explicit';
      bound_at?: string;
      bound_by_user_id?: string;
    }>();
    expectTypeOf<components['schemas']['Task']>().toMatchTypeOf<{
      bound_runner_id?: string;
      bound_runner_kind?: 'managed' | 'developer';
      runner_binding_source?: 'default_managed' | 'explicit';
      bound_at?: string;
      bound_by_user_id?: string;
    }>();

    const createRequest: CreateTaskRequest = {
      title: 'Bind this task to a Developer runner',
      bound_runner_id: 'arun_developer_1',
    };
    expect(createRequest.bound_runner_id).toBe('arun_developer_1');

    const runRequest: StartTaskRunRequest = {
      intent: 'Run on the task bound runner',
    };
    expect(runRequest.intent).toBe('Run on the task bound runner');

    const localTypes = readFileSync(resolve(process.cwd(), 'src/lib/types/task.ts'), 'utf8');
    expect(localTypes).toContain('bound_runner_id?: string;');
    expect(localTypes).not.toContain('export interface TaskRunRunnerSelection');
    expect(localTypes).not.toContain('runner_selection?:');

    const generatedTypes = readFileSync(resolve(process.cwd(), 'src/lib/api/types.generated.ts'), 'utf8');
    expect(generatedTypes).toContain('bound_runner_id?: string;');
    expect(generatedTypes).not.toContain('TaskRunRunnerSelection:');
    expect(generatedTypes).not.toContain('runner_selection?:');
  });

  it('documents bound_runner_id only on CreateTaskRequest in OpenAPI sources', () => {
    const yamlSource = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(yamlSource).toContain('bound_runner_id:');
    expect(yamlSource).not.toContain('TaskRunRunnerSelection:');
    expect(yamlSource).not.toContain('runner_selection:');
    expect(yamlSource).not.toContain('run-selection-snapshot');

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      components?: {
        schemas?: Record<string, {
          properties?: Record<string, unknown>;
        }>;
      };
    };
    expect(
      jsonSource.components?.schemas?.CreateTaskRequest?.properties?.bound_runner_id,
    ).toEqual({ type: 'string', minLength: 1 });
    expect(
      jsonSource.components?.schemas?.StartTaskRunRequest?.properties,
    ).not.toHaveProperty('runner_selection');
    expect(
      jsonSource.components?.schemas?.CreateTaskRequest?.properties,
    ).not.toHaveProperty('endpoint_id');
    expect(
      jsonSource.components?.schemas?.CreateTaskRequest?.properties,
    ).not.toHaveProperty('model');
    expect(
      jsonSource.components?.schemas?.StartTaskRunRequest?.properties,
    ).not.toHaveProperty('endpoint_id');
    expect(
      jsonSource.components?.schemas?.StartTaskRunRequest?.properties,
    ).not.toHaveProperty('model');
  });

  it('types task creation validation errors with explicit field contracts', () => {
    expectTypeOf<components['schemas']['AgentTaskWorkspaceModeInvalidError']>().toEqualTypeOf<{
      error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID';
      message: 'agent_task_workspace_mode_invalid';
      field: 'workspace_mode';
      request_id?: string;
      workspace_mode?: string;
    }>();
    expectTypeOf<components['schemas']['AgentTaskWorkspaceFileLibraryRequiredError']>().toEqualTypeOf<{
      error_code: 'AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED';
      message: 'agent_task_workspace_file_library_required';
      field: 'workspace_file_library_id';
      request_id?: string;
    }>();
    expectTypeOf<components['schemas']['InvalidBindingTargetError']>().toEqualTypeOf<{
      error_code: 'invalid_binding_target';
      message: 'invalid_binding_target';
      field: 'bound_runner_id';
      details?: {
        [key: string]: unknown;
      };
    }>();
    expectTypeOf<CreateTaskValidationError>().toEqualTypeOf<ExpectedCreateTaskValidationError>();

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      components?: {
        schemas?: Record<string, {
          properties?: Record<string, unknown>;
        }>;
      };
    };
    expect(jsonSource.components?.schemas?.InvalidBindingTargetError?.properties).toMatchObject({
      error_code: { type: 'string', enum: ['invalid_binding_target'] },
      message: { type: 'string', enum: ['invalid_binding_target'] },
      field: { type: 'string', enum: ['bound_runner_id'] },
    });
    expect(jsonSource.components?.schemas?.AgentTaskWorkspaceModeInvalidError?.properties).toMatchObject({
      error_code: { type: 'string', enum: ['AGENT_TASK_WORKSPACE_MODE_INVALID'] },
      message: { type: 'string', enum: ['agent_task_workspace_mode_invalid'] },
      field: { type: 'string', enum: ['workspace_mode'] },
      workspace_mode: { type: 'string' },
    });
    expect(
      jsonSource.components?.schemas?.AgentTaskWorkspaceFileLibraryRequiredError?.properties,
    ).toMatchObject({
      error_code: { type: 'string', enum: ['AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED'] },
      message: { type: 'string', enum: ['agent_task_workspace_file_library_required'] },
      field: { type: 'string', enum: ['workspace_file_library_id'] },
    });
  });

  it('tracks the display-safe task runner binding options contract', () => {
    expectTypeOf<RunnerBindingOptionsPathParams>().toEqualTypeOf<ExpectedRunnerBindingOptionsPathParams>();
    expectTypeOf<RunnerBindingOptionsOperationPathParams>().toEqualTypeOf<ExpectedRunnerBindingOptionsPathParams>();
    expectTypeOf<ForbiddenBindingOptionSecrets>().toEqualTypeOf<never>();
    expectTypeOf<TaskRunnerBindingOptionsResponse>().toMatchTypeOf<{
      options: Array<{
        option_id: string;
        label: string;
        bound_runner_kind: 'managed' | 'developer';
        actions: {
          bind_to_task: {
            operation: 'bind_to_task';
            visible: boolean;
            allowed: boolean;
            required_permissions: string[];
            danger_level: 'none';
          };
        };
      }>;
    }>();
    expectTypeOf<components['schemas']['TaskRunnerBindingOptionsResponse']>().toMatchTypeOf<TaskRunnerBindingOptionsResponse>();

    const yamlSource = readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8');
    expect(yamlSource).toContain('runner-binding-options');
    expect(yamlSource).toContain('TaskRunnerBindingOption:');
    expect(yamlSource).toContain('bind_to_task:');
    expect(yamlSource).not.toContain('select_for_task');

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      paths?: Record<string, {
        parameters?: Array<{
          name?: string;
          in?: string;
          required?: boolean;
          schema?: { type?: string };
        }>;
        get?: {
          parameters?: Array<{
            name?: string;
            in?: string;
            required?: boolean;
            schema?: { type?: string };
          }>;
        };
      }>;
    };
    const runnerBindingPathItem = jsonSource.paths?.[
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/runner-binding-options'
    ];
    expect(runnerBindingPathItem?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'workspaceId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }),
      expect.objectContaining({
        name: 'projectId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }),
    ]));

    const generatedTypes = readFileSync(resolve(process.cwd(), 'src/lib/api/types.generated.ts'), 'utf8');
    expect(generatedTypes).toContain('TaskRunnerBindingOptionsResponse:');
    expect(generatedTypes).toContain('TaskRunnerBindingOption:');
    expect(generatedTypes).toContain('bind_to_task:');
    expect(generatedTypes).not.toContain('select_for_task');
    const generatedRunnerBindingOperation = generatedTypes.slice(
      generatedTypes.indexOf('getTaskRunnerBindingOptions:'),
      generatedTypes.indexOf('get_usage:'),
    );
    expect(generatedRunnerBindingOperation).toContain('path: {');
    expect(generatedRunnerBindingOperation).toContain('projectId: string;');
    expect(generatedRunnerBindingOperation).toContain('workspaceId: string;');
    expect(generatedRunnerBindingOperation).not.toContain('path?: never;');
  });

  it('carries runner_test source markers on task activity items and active run summaries', () => {
    expectTypeOf<TaskActivityItem>().toMatchTypeOf<{
      source?: 'runner_test';
      runner_test?: true;
    }>();
    expectTypeOf<components['schemas']['TaskActivityItem']>().toMatchTypeOf<{
      source?: 'runner_test';
      runner_test?: true;
    }>();
    expectTypeOf<NonNullable<Task['active_run']>>().toMatchTypeOf<{
      source?: 'runner_test';
      runner_test?: true;
    }>();
    expectTypeOf<components['schemas']['TaskRunSummary']>().toMatchTypeOf<{
      source?: 'runner_test';
      runner_test?: true;
    }>();

    const localTypes = readFileSync(resolve(process.cwd(), 'src/lib/types/task.ts'), 'utf8');
    const taskActivityLocal = localTypes.slice(
      localTypes.indexOf('export interface TaskActivityItem'),
      localTypes.indexOf('export type ArtifactType'),
    );
    expect(taskActivityLocal).toContain("source?: 'runner_test';");
    expect(taskActivityLocal).toContain('runner_test?: true;');
    expect(localTypes).toMatch(/active_run\?: \{[\s\S]*source\?: 'runner_test';[\s\S]*runner_test\?: true;[\s\S]*\};/);

    const jsonSource = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as {
      components?: {
        schemas?: Record<string, {
          properties?: Record<string, unknown>;
        }>;
      };
    };
    expect(jsonSource.components?.schemas?.TaskActivityItem?.properties).toMatchObject({
      source: { type: 'string', enum: ['runner_test'] },
      runner_test: { type: 'boolean', enum: [true] },
    });
    expect(jsonSource.components?.schemas?.TaskRunSummary?.properties).toMatchObject({
      source: { type: 'string', enum: ['runner_test'] },
      runner_test: { type: 'boolean', enum: [true] },
    });

    const generatedTypes = readFileSync(resolve(process.cwd(), 'src/lib/api/types.generated.ts'), 'utf8');
    const generatedActivity = generatedTypes.slice(
      generatedTypes.indexOf('TaskActivityItem:'),
      generatedTypes.indexOf('TaskAgentPresence:'),
    );
    expect(generatedActivity).toContain('source?: "runner_test";');
    expect(generatedActivity).toContain('runner_test?: true;');
    const generatedRunSummary = generatedTypes.slice(
      generatedTypes.indexOf('TaskRunSummary:'),
      generatedTypes.indexOf('TaskStats:'),
    );
    expect(generatedRunSummary).toContain('source?: "runner_test";');
    expect(generatedRunSummary).toContain('runner_test?: true;');
  });
});
