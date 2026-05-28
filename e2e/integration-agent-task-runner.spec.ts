import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_MODEL,
  BACKEND_REAL_OPENAI_BASE_URL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  createAgentTaskViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalConnectionViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  ensureIntegrationKeycloakUsers,
  expectAgentTaskRunnerEvidenceViaApi,
  expectTerminalSessionRunnerEvidenceViaApi,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  putContextEntryViaApi,
  readAgentTaskViaApi,
  runTerminalCommandInSession,
  startAgentTaskRunViaApi,
  startMockFeishuMcpServer,
  startMockJiraServer,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';

type PreparedAgentTaskProject = {
  projectId: string;
  runnerId: string;
  runnerName: string;
  endpointId: string;
};

function requireRealLaneApiKey(): string {
  const value = process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function prepareAgentTaskProject(
  page: Page,
  args: {
    projectPrefix: string;
    runnerTitle: string;
    username?: string;
    password?: string;
  },
): Promise<PreparedAgentTaskProject> {
  const providerApiKey = requireRealLaneApiKey();
  await keycloakLoginToWorkspace(
    page,
    WORKSPACE_ID,
    args.username ?? KEYCLOAK_DEV_ADMIN_USERNAME,
    args.password ?? KEYCLOAK_DEV_ADMIN_PASSWORD,
    { ensureProjectCreatorAccess: true },
  );
  const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, args.projectPrefix);
  const credentialName = `Provider Credential ${Date.now()}`;
  await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, providerApiKey);
  const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
    endpointName: `Provider Endpoint ${Date.now()}`,
    endpointModel: BACKEND_REAL_MODEL,
    upstreamBaseUrl: BACKEND_REAL_OPENAI_BASE_URL,
    credentialName,
  });
  const runner = await createManagedAgentRunnerViaApi(page, {
    workspaceId: WORKSPACE_ID,
    projectId,
    endpointId,
    title: `${args.runnerTitle}-${Date.now()}`,
  });

  expect(runner.status).toBe('ready');
  expect(runner.isDefault).toBe(true);

  return {
    projectId,
    runnerId: runner.runnerId,
    runnerName: runner.runnerName,
    endpointId,
  };
}

async function createRunnerlessAgentTask(args: {
  page: Page;
  projectId: string;
  title: string;
}): Promise<string> {
  const taskId = await createAgentTaskViaApi({
    page: args.page,
    workspaceId: WORKSPACE_ID,
    projectId: args.projectId,
    title: args.title,
    workspaceName: `${args.title} Workspace`,
  });
  const createdTask = await readAgentTaskViaApi({
    page: args.page,
    workspaceId: WORKSPACE_ID,
    projectId: args.projectId,
    taskId,
  });
  expect(createdTask.agent_id ?? null).toBeFalsy();
  expect(createdTask.active_run?.runner_id ?? null).toBeFalsy();
  return taskId;
}

function buildJiraProjectionEnvSmokeCommand(): string {
  const python = [
    'import json,os,sys,urllib.request',
    '[os.environ.pop(k,None) for k in ("http_proxy","https_proxy","all_proxy","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","no_proxy","NO_PROXY")]',
    'raw=os.environ.get("MBOS_AGENT_PROJECTED_DEPENDENCIES","")',
    'raw or sys.exit("missing_MBOS_AGENT_PROJECTED_DEPENDENCIES")',
    'data=json.loads(raw)',
    'deps=data.get("dependencies") if isinstance(data,dict) else None',
    'dep=deps.get("jira-auth") if isinstance(deps,dict) else None',
    'fields=dep.get("fields") if isinstance(dep,dict) else None',
    'base_url=fields.get("base_url") if isinstance(fields,dict) and isinstance(fields.get("base_url"),str) else None',
    'token=fields.get("token") if isinstance(fields,dict) and isinstance(fields.get("token"),str) else None',
    'base_url or sys.exit("missing_jira_base_url")',
    'token or sys.exit("missing_jira_token")',
    'url=base_url.rstrip("/")+"/rest/api/2/myself"',
    'request=urllib.request.Request(url,headers={"Authorization":"Bearer "+token})',
    'profile=json.loads(urllib.request.urlopen(request,timeout=10).read().decode("utf-8"))',
    'display_name=profile.get("displayName") if isinstance(profile,dict) and isinstance(profile.get("displayName"),str) else None',
    'display_name or sys.exit("missing_jira_displayName")',
    'print("JIRA_PROJECTION::"+display_name)',
  ].join('; ');

  return `python3 -c '${python}'`;
}

test.describe('@lane-real Agent Task runner via managed Agent Runner', () => {
  test('reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    const prepared = await prepareAgentTaskProject(page, {
      projectPrefix: 'Agent Task Context',
      runnerTitle: 'agent-task-context-runner',
    });
    const taskId = await createRunnerlessAgentTask({
      page,
      projectId: prepared.projectId,
      title: `Agent Task Context ${Date.now()}`,
    });

    const taskNote = `TASK_CTX_${Date.now()}`;
    await putContextEntryViaApi({
      page,
      scope: 'task',
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      key: 'notes.current_task',
      content: taskNote,
    });

    const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      intent: [
        'Run this exact shell command and use its stdout value in your final reply:',
        '`python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key notes.current_task`',
        'Reply with exactly one line in this format and no extra text:',
        '`CTX_TASK::<note>`',
      ].join(' '),
    });

    await expectAgentTaskRunnerEvidenceViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      runnerId: prepared.runnerId,
    });
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      token: taskNote,
      runnerOutputActivityId,
      runId,
    });
  });

  test('writes task context through mbos-context and persists it for the task owner', async ({ page }) => {
    test.setTimeout(720_000);
    const prepared = await prepareAgentTaskProject(page, {
      projectPrefix: 'Agent Task Context Write',
      runnerTitle: 'agent-task-context-write-runner',
    });
    const taskId = await createRunnerlessAgentTask({
      page,
      projectId: prepared.projectId,
      title: `Agent Task Context Write ${Date.now()}`,
    });
    const contextKey = `notes.task_roundtrip_${Date.now()}`;
    const contextValue = `CTX_TASK_VALUE_${Date.now()}`;

    const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      intent: [
        'Run these exact shell commands and use their stdout values in your final reply:',
        `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope task --key ${contextKey} --content ${contextValue}`,
        `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key ${contextKey}`,
        'Reply with exactly one line in this format and no extra text:',
        '`CTX_TASK_WRITE::<value>`',
      ].join(' '),
    });

    await expectAgentTaskRunnerEvidenceViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      runnerId: prepared.runnerId,
    });
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      token: contextValue,
      runnerOutputActivityId,
      runId,
    });

    const persisted = await getContextEntryViaApi({
      page,
      scope: 'task',
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      key: contextKey,
    });
    expect(persisted.body).toEqual(expect.objectContaining({
      scope: 'task',
      key: contextKey,
      content: contextValue,
      task_id: taskId,
    }));
  });

  test('uses jira-ops task context before member context in a real Agent Task run resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    let stage = 'init';
    const memberToken = `jira_member_${Date.now()}`;
    const taskToken = `jira_task_${Date.now()}`;
    const memberServer = await startMockJiraServer({
      displayName: `jira-member-${Date.now()}`,
      expectedToken: memberToken,
    });
    const taskServer = await startMockJiraServer({
      displayName: `jira-task-${Date.now()}`,
      expectedToken: taskToken,
    });

    try {
      const prepared = await prepareAgentTaskProject(page, {
        projectPrefix: 'Agent Task Jira Skill',
        runnerTitle: 'agent-task-jira-runner',
      });
      const taskId = await createRunnerlessAgentTask({
        page,
        projectId: prepared.projectId,
        title: `Agent Task Jira ${Date.now()}`,
      });

      stage = 'put_member_jira_base_url';
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: WORKSPACE_ID,
        key: 'credentials.jira_base_url',
        content: memberServer.baseUrl,
      });
      stage = 'put_member_jira_token';
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: WORKSPACE_ID,
        key: 'credentials.jira_token',
        content: memberToken,
      });

      stage = 'put_task_jira_base_url';
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        key: 'credentials.jira_base_url',
        content: taskServer.baseUrl,
      });
      stage = 'put_task_jira_token';
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        key: 'credentials.jira_token',
        content: taskToken,
      });

      stage = 'start_task_run';
      const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        intent: [
          'Run this exact shell command and use its stdout value in your final reply:',
          '`python3 ~/.agents/skills/jira-ops/scripts/jira_ops.py myself | python3 -c "import json,sys; print(\\\'JIRA_TASK_SCOPE::\\\' + json.load(sys.stdin)[\\\'displayName\\\'])"`',
          'Reply with exactly one line and no extra text.',
        ].join(' '),
      });
      stage = 'verify_runner_evidence';
      await expectAgentTaskRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        runnerId: prepared.runnerId,
      });
      stage = 'wait_for_jira_task_scope';
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        token: 'JIRA_TASK_SCOPE::jira-task-',
        runnerOutputActivityId,
        runId,
      });
      stage = 'verify_not_member_token';
      const authToken = await readStoredAuthToken(page);
      const activityResponse = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/tasks/${taskId}/activity`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      expect(activityResponse.ok()).toBeTruthy();
      const activity = (await activityResponse.json()) as Array<{ content?: string; actor?: string; kind?: string }>;
      const runnerOutputContent = activity
        .filter((item) => item.actor === 'runner' && item.kind === 'runner_output')
        .map((item) => item.content ?? '')
        .join('\n');
      expect(runnerOutputContent).toContain('JIRA_TASK_SCOPE::jira-task-');
      expect(runnerOutputContent).not.toContain('JIRA_TASK_SCOPE::jira-member-');
      stage = 'done';
    } catch (error) {
      throw new Error(`jira_task_real_smoke_failed:${stage}:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await memberServer.stop();
      await taskServer.stop();
    }
  });

  test('uses request-scoped projected dependencies through agentsmith-runner in a real Agent Task run resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    let stage = 'init';
    const memberToken = `jira_projection_member_${Date.now()}`;
    const taskToken = `jira_projection_task_${Date.now()}`;
    const memberDisplayName = `jira-projection-member-${Date.now()}`;
    const taskDisplayName = `jira-projection-task-${Date.now()}`;
    const memberServer = await startMockJiraServer({
      displayName: memberDisplayName,
      expectedToken: memberToken,
    });
    const taskServer = await startMockJiraServer({
      displayName: taskDisplayName,
      expectedToken: taskToken,
    });

    try {
      const prepared = await prepareAgentTaskProject(page, {
        projectPrefix: 'Agentsmith Runner Projection',
        runnerTitle: 'agentsmith-runner-projection',
      });
      const taskId = await createRunnerlessAgentTask({
        page,
        projectId: prepared.projectId,
        title: `Agent Task Projection ${Date.now()}`,
      });

      stage = 'put_member_projection_context';
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: WORKSPACE_ID,
        key: 'credentials.jira_base_url',
        content: memberServer.baseUrl,
      });
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: WORKSPACE_ID,
        key: 'credentials.jira_token',
        content: memberToken,
      });

      stage = 'put_task_projection_context';
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        key: 'credentials.jira_base_url',
        content: taskServer.baseUrl,
      });
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        key: 'credentials.jira_token',
        content: taskToken,
      });

      stage = 'start_task_run';
      const jiraProjectionCommand = buildJiraProjectionEnvSmokeCommand();
      expect(jiraProjectionCommand).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
      const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        intent: [
          'Run this exact shell command and use its stdout value in your final reply:',
          `\`${jiraProjectionCommand}\``,
          'Reply with exactly one line and no extra text.',
        ].join(' '),
      });

      stage = 'verify_runner_evidence';
      await expectAgentTaskRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        runnerId: prepared.runnerId,
      });
      stage = 'wait_for_task_projection';
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        token: `JIRA_PROJECTION::${taskDisplayName}`,
        runnerOutputActivityId,
        runId,
      });

      stage = 'verify_task_projection_won';
      const authToken = await readStoredAuthToken(page);
      const activityResponse = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/tasks/${taskId}/activity`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      expect(activityResponse.ok()).toBeTruthy();
      const activity = (await activityResponse.json()) as Array<{ content?: string; actor?: string; kind?: string }>;
      const runnerOutputContent = activity
        .filter((item) => item.actor === 'runner' && item.kind === 'runner_output')
        .map((item) => item.content ?? '')
        .join('\n');
      expect(runnerOutputContent).toContain(`JIRA_PROJECTION::${taskDisplayName}`);
      expect(runnerOutputContent).not.toContain(`JIRA_PROJECTION::${memberDisplayName}`);
      expect(runnerOutputContent).not.toContain(taskToken);
      expect(runnerOutputContent).not.toContain(memberToken);
      stage = 'done';
    } catch (error) {
      throw new Error(`jira_projection_real_smoke_failed:${stage}:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await memberServer.stop();
      await taskServer.stop();
    }
  });

  test('uses feishu-docs managed credential projection in a real Agent Task run resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    const feishuToken = `feishu_mock_token_${Date.now()}`;
    const toolName = `mock_feishu_tool_${Date.now()}`;
    const feishuServer = await startMockFeishuMcpServer({
      expectedToken: feishuToken,
      toolName,
    });

    try {
      await ensureIntegrationKeycloakUsers();
      const prepared = await prepareAgentTaskProject(page, {
        projectPrefix: 'Agent Task Feishu Skill',
        runnerTitle: 'agent-task-feishu-runner',
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        password: KEYCLOAK_INTEGRATION_USER_PASSWORD,
      });
      const taskId = await createRunnerlessAgentTask({
        page,
        projectId: prepared.projectId,
        title: `Agent Task Feishu ${Date.now()}`,
      });

      const authToken = await readStoredAuthToken(page);
      expect(authToken).toBeTruthy();
      await createExternalConnectionViaApi({
        request: page.request,
        token: authToken!,
        provider: 'feishu',
        kind: 'oauth_account',
        displayName: `member-feishu-${Date.now()}`,
        fields: [
          { key: 'access_token', value: feishuToken, secret: true },
          { key: 'feishu_mcp_endpoint', value: feishuServer.endpoint, secret: false },
        ],
      });

      const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        intent: [
          'Run this exact shell command and use its stdout value in your final reply:',
          '`python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py tools-list | python3 -c "import json,sys; payload=json.load(sys.stdin); print(\\\'FEISHU_TOOLS::\\\' + payload[\\\'result\\\'][\\\'tools\\\'][0][\\\'name\\\'])"`',
          'Reply with exactly one line and no extra text.',
        ].join(' '),
      });
      await expectAgentTaskRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        runnerId: prepared.runnerId,
      });
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        token: `FEISHU_TOOLS::${toolName}`,
        runnerOutputActivityId,
        runId,
      });
    } finally {
      await feishuServer.stop();
    }
  });

  test('reads task context through mbos-context inside a real Agent Task terminal session resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    const prepared = await prepareAgentTaskProject(page, {
      projectPrefix: 'Agent Task Terminal Context',
      runnerTitle: 'agent-task-terminal-context-runner',
    });
    const taskId = await createRunnerlessAgentTask({
      page,
      projectId: prepared.projectId,
      title: `Agent Task Terminal Context ${Date.now()}`,
    });
    const taskNote = `TERM_TASK_CTX_${Date.now()}`;
    const doneMarker = `TERM_CTX_DONE_${Date.now()}`;
    await putContextEntryViaApi({
      page,
      scope: 'task',
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      key: 'notes.current_task',
      content: taskNote,
    });

    const terminalSession = await createTerminalSessionViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      shell: '/usr/bin/bash',
    });
    await expectTerminalSessionRunnerEvidenceViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      sessionId: terminalSession.sessionId,
      runnerId: prepared.runnerId,
      createdSession: terminalSession,
    });

    const output = await runTerminalCommandInSession({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      sessionId: terminalSession.sessionId,
      command: `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key notes.current_task; printf '${doneMarker}\\n'`,
      waitFor: [taskNote, doneMarker],
    });

    expect(output).toContain(taskNote);
    expect(output).toContain(doneMarker);
  });

  test('rejects shared workspace context writes inside a real Agent Task terminal session resolved by the default Agent Runner', async ({ page }) => {
    test.setTimeout(720_000);
    const prepared = await prepareAgentTaskProject(page, {
      projectPrefix: 'Agent Task Terminal Shared Read Only',
      runnerTitle: 'agent-task-terminal-shared-ro-runner',
    });
    const taskId = await createRunnerlessAgentTask({
      page,
      projectId: prepared.projectId,
      title: `Agent Task Terminal Shared Read Only ${Date.now()}`,
    });
    const doneMarker = `TERM_SHARED_DONE_${Date.now()}`;
    const terminalSession = await createTerminalSessionViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      shell: '/usr/bin/bash',
    });
    await expectTerminalSessionRunnerEvidenceViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      sessionId: terminalSession.sessionId,
      runnerId: prepared.runnerId,
      createdSession: terminalSession,
    });

    const output = await runTerminalCommandInSession({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      sessionId: terminalSession.sessionId,
      command: `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope workspace --key shared.terminal_attempt --content denied 2>&1 || true; printf '${doneMarker}\\n'`,
      waitFor: ['context_scope_read_only_for_agent', doneMarker],
    });

    expect(output.toLowerCase()).toContain('context_scope_read_only_for_agent');
    expect(output).toContain(doneMarker);
  });
});
