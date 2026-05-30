import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_MODEL,
  BACKEND_REAL_OPENAI_BASE_URL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createAgentTaskViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  expectAgentTaskRunnerEvidenceViaApi,
  expectManagedAgentRunnerImageEvidenceViaApi,
  expectManagedWorkloadPodImage,
  expectTerminalSessionRunnerEvidenceViaApi,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  putContextEntryViaApi,
  readAgentTaskViaApi,
  runTerminalCommandInSession,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';

type PreparedAgentTaskProject = {
  projectId: string;
  runnerId: string;
  runnerName: string;
  runnerConfiguredImage: string | null;
  endpointId: string;
};

const INTERNAL_AGENT_K8S_NAMESPACE =
  process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim() || 'agentsmith-sandbox';

function requireRealLaneApiKey(): string {
  const value = process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

function expectRunnerOutputNotToLeakSecret(
  runnerOutputContent: string,
  secret: string,
  redactedLabel: string,
): void {
  const leaked = secret.length > 0 && runnerOutputContent.includes(secret);
  expect(leaked, `${redactedLabel} leaked into runner output`).toBe(false);
}

async function prepareAgentTaskProject(
  page: Page,
  args: {
    projectPrefix: string;
    runnerTitle: string;
    runnerImage?: string;
    forceManagedRunnerUpsert?: boolean;
    runnerDiagnostics?: Record<string, unknown>;
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
    image: args.runnerImage,
    forceManagedRunnerUpsert: args.forceManagedRunnerUpsert,
    diagnostics: args.runnerDiagnostics,
  });

  expect(runner.status).toBe('ready');
  expect(runner.isDefault).toBe(true);

  return {
    projectId,
    runnerId: runner.runnerId,
    runnerName: runner.runnerName,
    runnerConfiguredImage: runner.configuredImage,
    endpointId,
  };
}

function readRunnerProjectionSmokeImage(): string | null {
  if (process.env.INTEGRATION_RUNNER_PROJECTION_SMOKE !== '1') {
    return null;
  }
  const image = process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim();
  if (!image) {
    throw new Error('runner_projection_smoke_missing_INTEGRATION_INTERNAL_AGENT_IMAGE');
  }
  if (image.includes('agent-task-runner') || !image.includes('agentsmith-runner')) {
    throw new Error(`runner_projection_smoke_non_canonical_image:${image}`);
  }
  return image;
}

function readRunnerLockedRuntimeSmokeImage(): string | null {
  if (process.env.INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE !== '1') {
    return null;
  }
  const image = process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim();
  if (!image) {
    throw new Error('runner_locked_runtime_smoke_missing_INTEGRATION_INTERNAL_AGENT_IMAGE');
  }
  if (image.includes('agent-task-runner') || !image.includes('agentsmith-runner')) {
    throw new Error(`runner_locked_runtime_smoke_non_canonical_image:${image}`);
  }
  return image;
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

function buildProviderNeutralProjectionSmokeCommand(args: {
  contextKey: string;
  includeRunnerBoundarySmoke?: boolean;
}): string {
  const python = [
    'import json,os,subprocess,sys',
    '[os.environ.pop(k,None) for k in ("http_proxy","https_proxy","all_proxy","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","no_proxy","NO_PROXY")]',
    ...(args.includeRunnerBoundarySmoke
      ? [
          'home=os.environ.get("HOME","")',
          'task_home=os.environ.get("TASK_HOME","")',
          'workspace_path=os.environ.get("WORKSPACE_PATH","")',
          'artifacts_path=os.environ.get("ARTIFACTS_PATH","")',
          'if not home: sys.exit("missing_HOME")',
          'if not task_home: sys.exit("missing_TASK_HOME")',
          'if home != task_home: sys.exit("home_task_home_mismatch")',
          'if not (task_home.startswith("/home/") and task_home.count("/") == 2 and len(task_home) > len("/home/")): sys.exit("invalid_TASK_HOME")',
          'if os.getcwd() != workspace_path: sys.exit("cwd_workspace_mismatch")',
          'if workspace_path != task_home + "/workspace": sys.exit("workspace_path_mismatch")',
          'if artifacts_path != workspace_path + "/.artifacts": sys.exit("artifacts_path_mismatch")',
          'if "MBOS_AGENT_KEY" in os.environ: sys.exit("control_env_leak:MBOS_AGENT_KEY")',
          'if "MBOS_AGENT_WS_URL" in os.environ: sys.exit("control_env_leak:MBOS_AGENT_WS_URL")',
          'if "AGENT_KEY" in os.environ: sys.exit("control_env_leak:AGENT_KEY")',
          'if "AGENT_WS_URL" in os.environ: sys.exit("control_env_leak:AGENT_WS_URL")',
        ]
      : []),
    `context_key=${JSON.stringify(args.contextKey)}`,
    'context_value=subprocess.check_output(["python3", os.path.expanduser("~/.agents/skills/mbos-context/scripts/context_cli.py"), "get", "--scope", "task", "--key", context_key], text=True).strip()',
    'context_value or sys.exit("missing_context_value")',
    'raw=os.environ.get("MBOS_AGENT_PROJECTED_DEPENDENCIES","")',
    'if raw:',
    '    data=json.loads(raw)',
    '    deps=data.get("dependencies") if isinstance(data,dict) else None',
    '    if isinstance(deps,dict) and len(deps) > 0:',
    '        sys.exit("unexpected_projected_dependencies:"+",".join(sorted(str(k) for k in deps.keys())))',
    ...(args.includeRunnerBoundarySmoke
      ? [
          'context_bytes=context_value.encode("utf-8")',
          'leak_path=None',
          'checked_files=0',
          'checked_bytes=0',
          'max_files=200',
          'max_bytes=1048576',
          'for root, dirs, files in os.walk(task_home):',
          '    dirs[:]=[name for name in dirs if name not in (".git","node_modules",".next",".cache",".codex")]',
          '    for name in files:',
          '        if checked_files >= max_files or checked_bytes >= max_bytes:',
          '            break',
          '        file_path=os.path.join(root,name)',
          '        try:',
          '            if os.path.islink(file_path):',
          '                continue',
          '            read_size=min(os.path.getsize(file_path),65536,max_bytes-checked_bytes)',
          '            if read_size <= 0:',
          '                break',
          '            with open(file_path,"rb") as handle:',
          '                chunk=handle.read(read_size)',
          '            checked_files+=1',
          '            checked_bytes+=read_size',
          '        except OSError:',
          '            continue',
          '        if context_bytes in chunk:',
          '            leak_path=os.path.relpath(file_path,task_home)',
          '            break',
          '    if leak_path or checked_files >= max_files or checked_bytes >= max_bytes:',
          '        break',
          'if leak_path:',
          '    sys.exit("context_value_persisted:"+leak_path)',
          'print("PROJECTION_SMOKE::"+context_value+" RUNNER_PROJECTION_BOUNDARY::ok RUNNER_SEMANTIC_SOURCE::blue")',
        ]
      : [
          'print("PROJECTION_SMOKE::"+context_value)',
        ]),
  ].join('\n');

  return `python3 -c 'exec(${JSON.stringify(python)})'`;
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

  test('keeps provider-neutral projection smoke on mbos-context without projected dependencies', async ({ page }) => {
    test.setTimeout(720_000);
    let stage = 'init';
    const projectionSmokeImage = readRunnerProjectionSmokeImage();
    const projectionSmokeImageId =
      process.env.INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID?.trim() || null;

    try {
      const prepared = await prepareAgentTaskProject(page, {
        projectPrefix: 'Agentsmith Runner Projection',
        runnerTitle: 'agentsmith-runner-projection',
        ...(projectionSmokeImage
          ? {
              runnerImage: projectionSmokeImage,
              forceManagedRunnerUpsert: true,
              runnerDiagnostics: {
                runner_projection_smoke: true,
                runner_projection_smoke_expected_image: projectionSmokeImage,
                ...(projectionSmokeImageId
                  ? { runner_projection_smoke_image_id: projectionSmokeImageId }
                  : {}),
              },
            }
          : {}),
      });
      if (projectionSmokeImage) {
        expect(prepared.runnerConfiguredImage).toBe(projectionSmokeImage);
        await expectManagedAgentRunnerImageEvidenceViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId: prepared.projectId,
          runnerId: prepared.runnerId,
          expectedImage: projectionSmokeImage,
          expectedImageId: projectionSmokeImageId,
        });
      }
      const taskId = await createRunnerlessAgentTask({
        page,
        projectId: prepared.projectId,
        title: `Agent Task Projection ${Date.now()}`,
      });

      stage = 'put_task_projection_context';
      const contextKey = `notes.projection_smoke_${Date.now()}`;
      const contextValue = `PROJECTION_CTX_${Date.now()}`;
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        key: contextKey,
        content: contextValue,
      });

      stage = 'start_task_run';
      const projectionCommand = buildProviderNeutralProjectionSmokeCommand({
        contextKey,
        includeRunnerBoundarySmoke: Boolean(projectionSmokeImage),
      });
      expect(projectionCommand).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
      if (projectionSmokeImage) {
        expect(projectionCommand).toContain('RUNNER_PROJECTION_BOUNDARY::ok');
        expect(projectionCommand).toContain('RUNNER_SEMANTIC_SOURCE::blue');
      }
      const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        intent: [
          'Run this exact shell command and use its stdout value in your final reply:',
          `\`${projectionCommand}\``,
          ...(projectionSmokeImage
            ? [
                'Your final reply must preserve the stdout PROJECTION_SMOKE marker. Find the color value after RUNNER_SEMANTIC_SOURCE:: in stdout, uppercase that value, and append a marker using prefix RUNNER_LLM_SEMANTIC:: followed by the uppercased value.',
              ]
            : []),
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
      if (projectionSmokeImage) {
        stage = 'verify_workload_pod_image';
        await expectManagedWorkloadPodImage({
          namespace: INTERNAL_AGENT_K8S_NAMESPACE,
          workspaceId: WORKSPACE_ID,
          projectId: prepared.projectId,
          workloadId: taskId,
          expectedImage: projectionSmokeImage,
        });
      }
      stage = 'wait_for_task_projection';
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId,
        token: `PROJECTION_SMOKE::${contextValue}`,
        runnerOutputActivityId,
        runId,
      });
      if (projectionSmokeImage) {
        stage = 'wait_for_llm_semantic_marker';
        await waitForRunnerOutputToken({
          page,
          workspaceId: WORKSPACE_ID,
          projectId: prepared.projectId,
          taskId,
          token: 'RUNNER_LLM_SEMANTIC::BLUE',
          runnerOutputActivityId,
          runId,
        });
      }

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
      expect(runnerOutputContent).toContain(`PROJECTION_SMOKE::${contextValue}`);
      if (projectionSmokeImage) {
        expect(runnerOutputContent).toContain('RUNNER_PROJECTION_BOUNDARY::ok');
        expect(runnerOutputContent).toContain('RUNNER_LLM_SEMANTIC::BLUE');
      }
      expectRunnerOutputNotToLeakSecret(runnerOutputContent, requireRealLaneApiKey(), 'redacted provider endpoint api key');
      stage = 'done';
    } catch (error) {
      throw new Error(`provider_neutral_projection_real_smoke_failed:${stage}:${error instanceof Error ? error.message : String(error)}`);
    }
  });

  test('keeps locked agentsmith-runner image provider-neutral for projection smoke in a real Agent Task run', async ({ page }) => {
    test.setTimeout(720_000);
    const lockedRuntimeSmokeImage = readRunnerLockedRuntimeSmokeImage();
    test.skip(!lockedRuntimeSmokeImage, 'locked runtime smoke runs only under INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE=1');
    if (!lockedRuntimeSmokeImage) return;
    const lockedRuntimeSmokeImageId =
      process.env.INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID?.trim() || null;
    const prepared = await prepareAgentTaskProject(page, {
      projectPrefix: 'Agentsmith Locked Runtime Projection',
      runnerTitle: 'agentsmith-runner-locked-runtime',
      runnerImage: lockedRuntimeSmokeImage,
      forceManagedRunnerUpsert: true,
      runnerDiagnostics: {
        runner_locked_runtime_smoke: true,
        runner_locked_runtime_smoke_expected_image: lockedRuntimeSmokeImage,
        ...(lockedRuntimeSmokeImageId
          ? { runner_locked_runtime_smoke_image_id: lockedRuntimeSmokeImageId }
          : {}),
      },
    });
    expect(prepared.runnerConfiguredImage).toBe(lockedRuntimeSmokeImage);
    await expectManagedAgentRunnerImageEvidenceViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      runnerId: prepared.runnerId,
      expectedImage: lockedRuntimeSmokeImage,
      expectedImageId: lockedRuntimeSmokeImageId,
      diagnosticsPrefix: 'runner_locked_runtime_smoke',
    });

    const taskId = await createRunnerlessAgentTask({
      page,
      projectId: prepared.projectId,
      title: `Agent Task Locked Runtime Projection ${Date.now()}`,
    });
    const contextKey = `notes.locked_projection_smoke_${Date.now()}`;
    const contextValue = `LOCKED_PROJECTION_CTX_${Date.now()}`;
    await putContextEntryViaApi({
      page,
      scope: 'task',
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      key: contextKey,
      content: contextValue,
    });

    const projectionCommand = buildProviderNeutralProjectionSmokeCommand({
      contextKey,
      includeRunnerBoundarySmoke: true,
    });
    expect(projectionCommand).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
    expect(projectionCommand).toContain('PROJECTION_SMOKE::');
    const { runnerOutputActivityId, runId } = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      intent: [
        'Run this exact shell command and use its stdout value in your final reply:',
        `\`${projectionCommand}\``,
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
    await expectManagedWorkloadPodImage({
      namespace: INTERNAL_AGENT_K8S_NAMESPACE,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      workloadId: taskId,
      expectedImage: lockedRuntimeSmokeImage,
    });
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId: prepared.projectId,
      taskId,
      token: `PROJECTION_SMOKE::${contextValue}`,
      runnerOutputActivityId,
      runId,
    });

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
    expect(runnerOutputContent).toContain(`PROJECTION_SMOKE::${contextValue}`);
    expect(runnerOutputContent).toContain('RUNNER_PROJECTION_BOUNDARY::ok');
    expectRunnerOutputNotToLeakSecret(runnerOutputContent, requireRealLaneApiKey(), 'redacted provider endpoint api key');
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
