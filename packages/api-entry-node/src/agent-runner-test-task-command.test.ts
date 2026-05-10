import { describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from './index.js';
import { dispatchDeveloperRunnerTestTaskRun } from './agent-runner-test-task-command.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';
import { notebookTaskMessagesCollection, notebookTasksCollection } from './notebook-task/task-store.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';

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

  it('fails closed before creating a runner test task while the AFSCP developer connector is blocked', async () => {
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
        name: 'Developer runner blocked by storage connector',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
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
        requestId: 'req_developer_connector_blocked',
      })).resolves.toEqual({
        ok: false,
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
      });

      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
      await expect(deps.docStore.list(notebookTasksCollection('ws_default'), {
        source: 'runner_test',
      })).resolves.toHaveLength(0);
      await expect(new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).listByProject(
        'ws_default',
        'proj_1',
      )).resolves.toHaveLength(0);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('fails closed before model resolution while the AFSCP developer connector is blocked', async () => {
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
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
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

  it('does not create model-setting dispatch evidence while the AFSCP developer connector is blocked', async () => {
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
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn();

      const result = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run self-check',
        requestId: 'req_project_setting',
      });

      expect(result).toEqual({
        ok: false,
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
      });
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
      await expect(deps.docStore.list(notebookTasksCollection('ws_default'), {
        source: 'runner_test',
      })).resolves.toHaveLength(0);
      await expect(new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).listByProject(
        'ws_default',
        'proj_1',
      )).resolves.toHaveLength(0);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('does not persist self-check prompt material while the AFSCP developer connector is blocked', async () => {
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
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn();

      const result = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'developer_runner_connection_check',
        requestId: 'req_prompt',
      });

      expect(result).toEqual({
        ok: false,
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
      });
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
      const messages = await deps.docStore.list<Record<string, unknown>>(
        notebookTaskMessagesCollection('ws_default'),
        {},
      );
      expect(JSON.stringify(messages)).not.toContain('AGENTSMITH_RUNNER_TEST_OK');
      expect(JSON.stringify(messages)).not.toContain('developer_runner_connection_check');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('does not acquire a runner-test singleflight lease while the AFSCP developer connector is blocked', async () => {
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
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn();

      const first = await dispatchDeveloperRunnerTestTaskRun({
        deps,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        user: { id: 'user_test', email: 'user_test@example.com', name: 'Test User' },
        runner,
        intent: 'Run first self-check',
        requestId: 'req_first',
      });
      expect(first).toEqual({
        ok: false,
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
      });

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
        errorCode: 'TASK_HOME_BINDING_UNAVAILABLE_FOR_DEVELOPER_RUNNER',
        message: 'task_home_binding_unavailable_for_developer_runner',
      });

      await expect(deps.docStore.list(notebookTasksCollection('ws_default'), {
        source: 'runner_test',
      })).resolves.toHaveLength(0);
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });
});
