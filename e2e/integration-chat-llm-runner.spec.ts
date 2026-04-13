import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createExternalConnectionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createProjectInWorkspace,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  openChatSession,
  putContextEntryViaApi,
  startChatRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { readStoredAuthToken } from './integration-workspace-access';

const CHAT_CONTINUITY_STORY = loadStoryDefinitionSync('chat-conversation-continuity');
const CHAT_CONTINUITY_BINDING = buildTraceStoryBinding(CHAT_CONTINUITY_STORY);

type ChatContinuityRuntime = {
  projectName: string;
  chatTitle: string;
  rememberToken: string;
  rememberPrompt: string;
  recallPrompt: string;
};

function resolveChatContinuityStep(stepId: string) {
  const step = CHAT_CONTINUITY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_chat_continuity_step:${stepId}`);
  }
  return step;
}

function requireChatContinuityRuntime(): ChatContinuityRuntime {
  const runtimeRoot = CHAT_CONTINUITY_STORY.runtimeData as Record<string, unknown> | undefined;
  const chat = runtimeRoot?.chat as Record<string, unknown> | undefined;
  const continuity = chat?.continuity as Record<string, unknown> | undefined;
  if (!continuity) {
    throw new Error('missing_chat_continuity_runtime_data');
  }
  for (const key of ['projectName', 'chatTitle', 'rememberToken', 'rememberPrompt', 'recallPrompt'] as const) {
    if (typeof continuity[key] !== 'string' || continuity[key].trim().length === 0) {
      throw new Error(`missing_chat_continuity_runtime_data:${key}`);
    }
  }
  return continuity as unknown as ChatContinuityRuntime;
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

async function waitForComposerReady(page: import('@playwright/test').Page): Promise<void> {
  const composer = page.getByTestId('chat__composer').locator('textarea');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 60_000 });
}

function workspaceRecreatedWarningText(): string {
  return LOCALE === 'zh-CN'
    ? '聊天工作区已被回收，之前生成的文件已经失效。如需使用，请让 AI 重新生成。'
    : 'The chat workspace was reclaimed, so previously generated files are no longer available. Ask AI to regenerate them if needed.';
}

async function waitForPersistedAssistantMessages(args: {
  page: import('@playwright/test').Page;
  projectId: string;
  sessionId: string;
  minAssistantMessages: number;
  requiredSubstrings?: string[];
}): Promise<Array<{ role?: string; content?: string }>> {
  const token = await readStoredAuthToken(args.page);
  let latestMessages: Array<{ role?: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        const sessionRes = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!sessionRes.ok()) return false;
        const sessionBody = (await sessionRes.json()) as { items?: Array<{ role?: string; content?: string }> };
        latestMessages = sessionBody.items ?? [];
        const assistantMessages = latestMessages.filter((item) => item.role === 'assistant');
        if (assistantMessages.length < args.minAssistantMessages) return false;
        return (args.requiredSubstrings ?? []).every((needle) =>
          assistantMessages.some((item) => item.content?.includes(needle)),
        );
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return latestMessages;
}

async function waitForLatestAssistantContent(args: {
  page: import('@playwright/test').Page;
  projectId: string;
  sessionId: string;
  requiredSubstring: string;
  minMessages?: number;
}): Promise<Array<Record<string, unknown>>> {
  const token = await readStoredAuthToken(args.page);
  let latestMessages: Array<Record<string, unknown>> = [];
  await expect
    .poll(
      async () => {
        const sessionRes = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!sessionRes.ok()) return false;
        const sessionBody = (await sessionRes.json()) as { items?: Array<Record<string, unknown>> };
        latestMessages = sessionBody.items ?? [];
        if (latestMessages.length < (args.minMessages ?? 1)) return false;
        const assistantMessages = latestMessages.filter((item) => item.role === 'assistant');
        const lastAssistant = assistantMessages.at(-1);
        if (!lastAssistant) return false;
        if (lastAssistant.message_status === 'failed') {
          throw new Error(
            `latest_assistant_failed:${String(lastAssistant.error_code ?? 'unknown')}:${String(lastAssistant.error_message ?? 'unknown')}`,
          );
        }
        return (
          typeof lastAssistant.content === 'string'
          && lastAssistant.content.includes(args.requiredSubstring)
          && lastAssistant.message_status === 'completed'
        );
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return latestMessages;
}

test.describe('@lane-real external agent chat-runner integration', () => {
  test('streams multi-turn chat through the real local chat runner and persists replies', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Agent Chat');
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const chatTitle = `chat-runner-chat-${Date.now()}`;
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: chatTitle,
      interactionKind: 'chat',
    });

    const runner = await startChatRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      await openChatSession(page, 'ws_default', projectId, chatTitle);
      const composer = page.getByTestId('chat__composer').locator('textarea');
      const sendButton = page.getByTestId('chat__send-btn');
      const firstToken = `REAL_CODEX_CHAT_OK_${Date.now()}`;
      await composer.fill(`Reply with the exact token ${firstToken} and one short confirming sentence.`);
      await sendButton.click();
      await expect(page.locator('[data-testid="chat__message"]').filter({ hasText: firstToken }).first()).toBeVisible({ timeout: 240_000 });

      const secondToken = `REAL_CODEX_CHAT_FOLLOWUP_${Date.now()}`;
      await page.waitForTimeout(20_000);
      await waitForComposerReady(page);
      await composer.fill(`Now mention both ${firstToken} and ${secondToken} in one short answer.`);
      await sendButton.click();
      await expect(page.locator('[data-testid="chat__message"]').filter({ hasText: secondToken }).first()).toBeVisible({ timeout: 240_000 });

      const messages = await waitForPersistedAssistantMessages({
        page,
        projectId,
        sessionId: agentBundle.sessionId,
        minAssistantMessages: 2,
        requiredSubstrings: [firstToken],
      });
      const agentReplies = messages.filter((item) => item.role === 'assistant');
      expect(agentReplies.length).toBeGreaterThanOrEqual(2);
      expect(agentReplies.some((item) => item.content?.includes(firstToken))).toBe(true);
    } finally {
      await runner.stop();
    }
  });

  test('preserves conversation continuity across refresh with story-bound trace evidence', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();
    const runtime = requireChatContinuityRuntime();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', runtime.projectName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const chatTitle = `${runtime.chatTitle}-${Date.now()}`;
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: chatTitle,
      interactionKind: 'chat',
    });
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-chat-llm-runner',
      storyId: CHAT_CONTINUITY_STORY.storyId,
      title: CHAT_CONTINUITY_STORY.title,
      actor: CHAT_CONTINUITY_STORY.actor,
      route: `/${LOCALE}/workspaces/ws_default/projects/${projectId}/chat`,
      specFile: 'e2e/integration-chat-llm-runner.spec.ts',
      browser: 'chromium',
      goal: CHAT_CONTINUITY_STORY.goal,
      preconditions: [...(CHAT_CONTINUITY_STORY.preconditions ?? [])],
      seedData: [...(CHAT_CONTINUITY_STORY.seedData ?? [])],
      storyBinding: CHAT_CONTINUITY_BINDING,
    });
    const captureTrace = async (stepId: string): Promise<void> => {
      const storyStep = resolveChatContinuityStep(stepId);
      await trace.capture(page, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    const runner = await startChatRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      await openChatSession(page, 'ws_default', projectId, chatTitle);
      await captureTrace('open-chat');

      const composer = page.getByTestId('chat__composer').locator('textarea');
      await composer.fill(runtime.rememberPrompt);
      await page.getByTestId('chat__send-btn').click();
      await expect(page.getByTestId('chat__message').filter({ hasText: runtime.rememberToken }).first()).toBeVisible({ timeout: 240_000 });
      await waitForLatestAssistantContent({
        page,
        projectId,
        sessionId: agentBundle.sessionId,
        requiredSubstring: runtime.rememberToken,
        minMessages: 2,
      });
      await captureTrace('remember-conversation');

      await page.reload();
      await openChatSession(page, 'ws_default', projectId, chatTitle);
      await expect(page.getByTestId('chat__message').filter({ hasText: runtime.rememberToken }).first()).toBeVisible({ timeout: 60_000 });
      await captureTrace('reload-chat-session');

      await page.waitForTimeout(20_000);
      await waitForComposerReady(page);
      await composer.fill(runtime.recallPrompt);
      await page.getByTestId('chat__send-btn').click();
      const sessionMessages = await waitForLatestAssistantContent({
        page,
        projectId,
        sessionId: agentBundle.sessionId,
        requiredSubstring: runtime.rememberToken,
        minMessages: 4,
      });
      expect(sessionMessages.length).toBeGreaterThanOrEqual(4);
      const assistantMessages = sessionMessages.filter((item) => item.role === 'assistant');
      expect(assistantMessages.some((item) => item.content?.includes(runtime.rememberToken))).toBe(true);
      expect(assistantMessages.at(-1)?.content?.includes(runtime.rememberToken)).toBe(true);
      await captureTrace('recall-conversation');
      outcome = 'pass';
    } finally {
      await runner.stop();
      await trace.finish({ outcome });
    }
  });

  test('warns and recreates the session workspace when the local chat workspace has been reclaimed', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();
    const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentsmith-chat-reclaim-'));

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Chat Runner Reclaim');
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const chatTitle = `chat-runner-reclaim-${Date.now()}`;
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: chatTitle,
      interactionKind: 'chat',
    });

    const runner = await startChatRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
      sessionRoot,
    });
    test.info().annotations.push({ type: 'chat_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      await openChatSession(page, 'ws_default', projectId, chatTitle);

      const composer = page.getByTestId('chat__composer').locator('textarea');
      const sendButton = page.getByTestId('chat__send-btn');
      const firstToken = `RECLAIM_FIRST_${Date.now()}`;
      await composer.fill(`Reply with the exact token ${firstToken}.`);
      await sendButton.click();
      await expect(page.getByTestId('chat__message').filter({ hasText: firstToken }).first()).toBeVisible({ timeout: 240_000 });

      const sessionDir = path.join(sessionRoot, encodeURIComponent(agentBundle.sessionId));
      await expect
        .poll(async () => {
          try {
            await fs.stat(sessionDir);
            return true;
          } catch {
            return false;
          }
        }, { timeout: 30_000, intervals: [250, 500, 1000] })
        .toBe(true);
      await fs.rm(sessionDir, { recursive: true, force: true });

      await waitForComposerReady(page);
      const secondToken = `RECLAIM_SECOND_${Date.now()}`;
      await composer.fill(`Reply with the exact token ${secondToken}.`);
      await sendButton.click();

      await expect(page.getByText(workspaceRecreatedWarningText()).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat__message').filter({ hasText: secondToken }).first()).toBeVisible({ timeout: 240_000 });
    } finally {
      await runner.stop();
      await fs.rm(sessionRoot, { recursive: true, force: true });
    }
  });

});
