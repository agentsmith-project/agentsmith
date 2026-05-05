import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND_REAL_MODEL,
  BACKEND_REAL_OPENAI_BASE_URL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createAgentTaskViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  expectTerminalSessionRunnerEvidenceViaApi,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_ID = 'ws_default';
const SPEC_FILE = 'e2e/integration-agent-task-terminal-ux.spec.ts';
const TERMINAL_MULTI_SESSION_STORY = loadStoryDefinitionSync('agent-task-terminal-workspace-multi-session');
const TERMINAL_MULTI_SESSION_BINDING = buildTraceStoryBinding(TERMINAL_MULTI_SESSION_STORY);
const TERMINAL_TRUTH_RETRY_STORY = loadStoryDefinitionSync('agent-task-terminal-truth-unavailable-retry');
const TERMINAL_TRUTH_RETRY_BINDING = buildTraceStoryBinding(TERMINAL_TRUTH_RETRY_STORY);
const TERMINAL_REENTRY_STORY = loadStoryDefinitionSync('agent-task-terminal-reentry-recovery');
const TERMINAL_REENTRY_BINDING = buildTraceStoryBinding(TERMINAL_REENTRY_STORY);

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function prepareTerminalUxTask(page: Page): Promise<{
  projectId: string;
  taskId: string;
  runnerId: string;
}> {
  const providerApiKey = requireRealLaneApiKey();
  await keycloakLoginToWorkspace(
    page,
    WORKSPACE_ID,
    KEYCLOAK_DEV_ADMIN_USERNAME,
    KEYCLOAK_DEV_ADMIN_PASSWORD,
    { ensureProjectCreatorAccess: true },
  );
  const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Agent Task Terminal UX');
  const credentialName = `Terminal UX Credential ${Date.now()}`;
  await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, providerApiKey);
  const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
    endpointName: `Terminal UX Endpoint ${Date.now()}`,
    endpointModel: BACKEND_REAL_MODEL,
    upstreamBaseUrl: BACKEND_REAL_OPENAI_BASE_URL,
    credentialName,
  });
  const runner = await createManagedAgentRunnerViaApi(page, {
    workspaceId: WORKSPACE_ID,
    projectId,
    endpointId,
    title: `agent-task-terminal-ux-runner-${Date.now()}`,
  });
  const taskId = await createAgentTaskViaApi({
    page,
    workspaceId: WORKSPACE_ID,
    projectId,
    title: `Agent Task Terminal UX ${Date.now()}`,
    workspaceName: `Agent Task Terminal UX Workspace ${Date.now()}`,
  });

  return {
    projectId,
    taskId,
    runnerId: runner.runnerId,
  };
}

test.describe('@lane-real Agent Task terminal workspace UX', () => {
  test('shows an active Agent Task terminal session without wrapping legacy coverage', async ({ page }) => {
    test.setTimeout(720_000);
    const prepared = await prepareTerminalUxTask(page);
    const multiSessionTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_MULTI_SESSION_STORY.storyId,
      title: TERMINAL_MULTI_SESSION_STORY.title,
      actor: TERMINAL_MULTI_SESSION_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_MULTI_SESSION_STORY.goal,
      preconditions: [...(TERMINAL_MULTI_SESSION_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_MULTI_SESSION_STORY.seedData ?? [])],
      storyBinding: TERMINAL_MULTI_SESSION_BINDING,
    });
    const truthRetryTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_TRUTH_RETRY_STORY.storyId,
      title: TERMINAL_TRUTH_RETRY_STORY.title,
      actor: TERMINAL_TRUTH_RETRY_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_TRUTH_RETRY_STORY.goal,
      preconditions: [...(TERMINAL_TRUTH_RETRY_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_TRUTH_RETRY_STORY.seedData ?? [])],
      storyBinding: TERMINAL_TRUTH_RETRY_BINDING,
    });
    const reentryTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_REENTRY_STORY.storyId,
      title: TERMINAL_REENTRY_STORY.title,
      actor: TERMINAL_REENTRY_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_REENTRY_STORY.goal,
      preconditions: [...(TERMINAL_REENTRY_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_REENTRY_STORY.seedData ?? [])],
      storyBinding: TERMINAL_REENTRY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      const terminalSession = await createTerminalSessionViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        shell: '/usr/bin/bash',
      });
      await expectTerminalSessionRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
        runnerId: prepared.runnerId,
        createdSession: terminalSession,
      });

      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`);
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
      await multiSessionTrace.capture(page, {
        stepId: 'return-to-agent-task',
        action: 'Return to Agent Task',
        target: 'agent-task__task-header',
        note: 'Canonical Agent Task terminal route is active.',
      });
      await reentryTrace.capture(page, {
        stepId: 'return-to-interrupted-agent-task',
        action: 'Return to the interrupted Agent Task',
        target: 'agent-task__task-header',
        note: 'Canonical Agent Task terminal re-entry route is active.',
      });
      await expect(page.getByTestId('agent-task__task-header-terminal-summary')).toContainText('1 terminal session', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('agent-tasks__task-terminal-status-strip')).toContainText('1 terminal session');
      await truthRetryTrace.capture(page, {
        stepId: 'return-to-task-while-terminal-truth-is-unavailable',
        action: 'Return to the task while terminal session truth is temporarily unavailable',
        target: 'agent-tasks__task-terminal-status-strip',
        note: 'Terminal truth is visible through the Agent Task status strip.',
      });
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0);

      await page.getByTestId('agent-task__task-header-mode-terminal').click();
      await expect(page.getByTestId('agent-tasks__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-tasks__task-terminal-create')).toBeVisible();
      await multiSessionTrace.capture(page, {
        stepId: 'open-terminal-workspace',
        action: 'Open terminal workspace',
        target: 'agent-tasks__task-terminal-workspace',
        note: 'Terminal workspace opens under the canonical Agent Task route.',
      });
      outcome = 'pass';
    } finally {
      await Promise.all([
        multiSessionTrace.finish({ outcome }),
        truthRetryTrace.finish({ outcome }),
        reentryTrace.finish({ outcome }),
      ]);
    }
  });
});
