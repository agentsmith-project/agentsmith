import { describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from './index.js';
import { dispatchDeveloperRunnerTestTaskRun } from './agent-runner-test-task-command.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';
import { getNotebookTaskRunState } from './notebook-task/task-run-coordination.js';
import { notebookTaskMessagesCollection, notebookTasksCollection } from './notebook-task/task-store.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import { JsonDocTaskFileLibraryBindingRepo } from './notebook-task/task-file-library-bindings.js';

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('dispatchDeveloperRunnerTestTaskRun', () => {
  async function createReadyEndpoint(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    input: {
      projectId?: string;
      name: string;
      model: string;
      upstreamProtocol: 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';
    },
  ) {
    const projectId = input.projectId ?? 'proj_1';
    const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
      name: `${input.name}-key`,
      value: 'sk-test',
    });
    return deps.endpointResourceService.createEndpoint('ws_default', projectId, {
      name: input.name,
      model: input.model,
      type: 'custom',
      base_url: 'https://example.com/v1',
      credential_ref: credential.id,
      status: 'active',
      upstream_protocol: input.upstreamProtocol,
      model_profile: {
        max_context_tokens: 128000,
        max_output_tokens: 8192,
      },
    });
  }

  async function seedAgentTaskModelSetting(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    endpointId: string,
    projectId = 'proj_1',
  ): Promise<void> {
    await new AgentTaskModelSettingService(deps).patchSetting({
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      expectedSettingRevision: null,
      actorUserId: 'user_test',
    });
  }

  it('fails closed before creating a runner test task when project model setting is missing', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const runnerEndpoint = await createReadyEndpoint(deps, {
        name: 'runner fallback endpoint',
        model: 'runner-fallback-model',
        upstreamProtocol: 'openai_chat_completions',
      });
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Developer runner without project setting',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        default_endpoint_id: runnerEndpoint.id,
        execution_preferences_json: {
          agent_task: {
            endpoint_id: runnerEndpoint.id,
            model: 'runner-fallback-model',
            wire_api: 'openai_chat_completions',
          },
        },
        capabilities: { task_execution: true, artifacts: true },
      });
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn();

      await expect(dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run self-check',
        requestId: 'req_missing_setting',
      })).resolves.toMatchObject({
        ok: false,
        errorCode: 'agent_task_model_setting_missing',
        message: 'agent_task_model_setting_missing',
      });

      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
      await expect(deps.docStore.list(notebookTasksCollection('ws_default'), {
        source: 'runner_test',
      })).resolves.toHaveLength(0);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('dispatches with the project model setting endpoint instead of runner defaults or preferences', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const runnerEndpoint = await createReadyEndpoint(deps, {
        name: 'runner default endpoint',
        model: 'runner-default-model',
        upstreamProtocol: 'openai_chat_completions',
      });
      const projectSettingEndpoint = await createReadyEndpoint(deps, {
        name: 'project setting endpoint',
        model: 'project-setting-model',
        upstreamProtocol: 'anthropic_messages',
      });
      await seedAgentTaskModelSetting(deps, projectSettingEndpoint.id);
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Developer runner with stale preferences',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        default_endpoint_id: runnerEndpoint.id,
        execution_preferences_json: {
          agent_task: {
            endpoint_id: runnerEndpoint.id,
            model: 'runner-default-model',
            wire_api: 'openai_chat_completions',
          },
        },
        capabilities: { task_execution: true, artifacts: true },
      });
      const streamGate = createDeferred<void>();
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_runner_test_project_setting',
        cancel: vi.fn(),
        stream: (async function* stream() {
          await streamGate.promise;
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;

      const result = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run self-check',
        requestId: 'req_project_setting',
      });

      expect(result).toMatchObject({
        ok: true,
        accepted: {
          resolvedRunnerId: runner.id,
        },
      });
      if (!result.ok) throw new Error(result.errorCode);
      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: runner.id,
            model: 'project-setting-model',
            executionContext: expect.objectContaining({
              endpoint_id: projectSettingEndpoint.id,
              model: 'project-setting-model',
              wire_api: 'anthropic_messages',
              agent_task_model: expect.objectContaining({
                endpoint_id: projectSettingEndpoint.id,
                resolved_model: 'project-setting-model',
                upstream_protocol: 'anthropic_messages',
              }),
            }),
          }),
        );
      });
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'runner-default-model',
        }),
      );
      await expect(getNotebookTaskRunState(deps.cache, result.accepted.taskId)).resolves.toMatchObject({
        task_id: result.accepted.taskId,
        run_id: result.accepted.runId,
        resolved_runner_id: runner.id,
        agent_task_model: expect.objectContaining({
          endpoint_id: projectSettingEndpoint.id,
          resolved_model: 'project-setting-model',
          upstream_protocol: 'anthropic_messages',
        }),
      });
      const storedTask = await deps.docStore.get<Record<string, unknown>>(
        notebookTasksCollection('ws_default'),
        result.accepted.taskId,
      );
      expect(storedTask).toMatchObject({
        source: 'runner_test',
        runner_test: true,
        workspace_file_library_id: expect.stringMatching(/^flib_/),
        task_home_segment: expect.stringMatching(/^flibhome_/),
        file_library_binding_generation: expect.any(Number),
        runtime_writable_affordance: 'task_internal_home',
      });
      const fileLibraryId = String(storedTask?.workspace_file_library_id);
      await expect(new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).getById(
        'ws_default',
        'proj_1',
        fileLibraryId,
      )).resolves.toMatchObject({
        id: fileLibraryId,
        file_library_home_segment: storedTask?.task_home_segment,
      });
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId,
      })).resolves.toMatchObject({
        taskId: result.accepted.taskId,
        bindingGeneration: storedTask?.file_library_binding_generation,
        runtimeWritableAffordance: 'task_internal_home',
        bindingState: 'bound',
      });

      streamGate.resolve();
      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, result.accepted.taskId)).toBeNull();
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('uses a canonical self-check prompt instead of forwarding diagnostic intent tokens to the runner', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await createReadyEndpoint(deps, {
        name: 'project setting endpoint',
        model: 'project-setting-model',
        upstreamProtocol: 'anthropic_messages',
      });
      await seedAgentTaskModelSetting(deps, endpoint.id);
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Developer runner self-check prompt',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        capabilities: { task_execution: true, artifacts: true },
      });
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_runner_test_prompt',
        cancel: vi.fn(),
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;

      const result = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'developer_runner_connection_check',
        requestId: 'req_prompt',
      });

      expect(result).toMatchObject({ ok: true });
      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              expect.objectContaining({
                role: 'user',
                content: expect.stringContaining('AGENTSMITH_RUNNER_TEST_OK'),
              }),
            ],
          }),
        );
      });
      const taskId = result.ok ? result.accepted.taskId : '';
      const messages = await deps.docStore.list<Record<string, unknown>>(
        notebookTaskMessagesCollection('ws_default'),
        { task_id: taskId },
      );
      expect(JSON.stringify(messages)).toContain('AGENTSMITH_RUNNER_TEST_OK');
      expect(JSON.stringify(messages)).not.toContain('developer_runner_connection_check');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rejects a second self-check for the same Developer runner while one is already running', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await createReadyEndpoint(deps, {
        name: 'project setting endpoint',
        model: 'project-setting-model',
        upstreamProtocol: 'anthropic_messages',
      });
      await seedAgentTaskModelSetting(deps, endpoint.id);
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Developer runner single self-check',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        capabilities: { task_execution: true, artifacts: true },
      });
      const streamGate = createDeferred<void>();
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_runner_test_singleflight',
        cancel: vi.fn(),
        stream: (async function* stream() {
          await streamGate.promise;
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;

      const first = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run first self-check',
        requestId: 'req_first',
      });
      expect(first).toMatchObject({ ok: true });

      const second = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run second self-check',
        requestId: 'req_second',
      });
      expect(second).toEqual({
        ok: false,
        errorCode: 'agent_runner_test_task_unavailable',
        message: 'runner_test_task_run_conflict',
      });

      await expect(deps.docStore.list(notebookTasksCollection('ws_default'), {
        source: 'runner_test',
      })).resolves.toHaveLength(1);

      streamGate.resolve();
      if (first.ok) {
        await vi.waitFor(async () => {
          expect(await getNotebookTaskRunState(deps.cache, first.accepted.taskId)).toBeNull();
        });
      }
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });
});
