import { expect, test } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  API_BASE,
  REAL_LANE_ANTHROPIC_BASE_URL,
  REAL_LANE_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalCodexAgentBundle,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  openChatSession,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireRealLaneApiKey(): string {
  const value = process.env.REAL_LANE_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_REAL_LANE_API_KEY');
  }
  return value;
}

async function waitForComposerReady(page: import('@playwright/test').Page): Promise<void> {
  const composer = page.getByTestId('chat__composer').locator('textarea');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 60_000 });
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

test.describe('@lane-real external agent codex-runner integration', () => {
  test('streams multi-turn chat through the real local codex runner and persists replies', async ({ page }) => {
    test.setTimeout(720_000);
    const glmApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Agent Chat');
    const credentialName = `GLM Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Endpoint ${Date.now()}`,
      endpointModel: REAL_LANE_MODEL,
      upstreamBaseUrl: REAL_LANE_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const chatTitle = `codex-runner-chat-${Date.now()}`;
    const agentBundle = await createExternalCodexAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: chatTitle,
    });

    const runner = await startCodexRunnerProcess({
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

  test('preserves session continuity across refresh with the real local codex runner', async ({ page }) => {
    test.setTimeout(720_000);
    const glmApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Agent Memory');
    const credentialName = `GLM Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Endpoint ${Date.now()}`,
      endpointModel: REAL_LANE_MODEL,
      upstreamBaseUrl: REAL_LANE_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const chatTitle = `codex-runner-memory-${Date.now()}`;
    const agentBundle = await createExternalCodexAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: chatTitle,
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      await openChatSession(page, 'ws_default', projectId, chatTitle);

      const rememberToken = `MEM_${Date.now()}`;
      const composer = page.getByTestId('chat__composer').locator('textarea');
      await composer.fill(`Remember this token for our session: ${rememberToken}. Make sure your reply includes the token.`);
      await page.getByTestId('chat__send-btn').click();
      await expect(page.getByTestId('chat__message').filter({ hasText: rememberToken }).first()).toBeVisible({ timeout: 240_000 });

      await page.reload();
      await openChatSession(page, 'ws_default', projectId, chatTitle);
      await expect(page.getByTestId('chat__message').filter({ hasText: rememberToken }).first()).toBeVisible({ timeout: 60_000 });

      await page.waitForTimeout(20_000);
      await waitForComposerReady(page);
      await composer.fill('What token did I ask you to remember? Reply with only the token.');
      await page.getByTestId('chat__send-btn').click();
      const sessionMessages = await waitForLatestAssistantContent({
        page,
        projectId,
        sessionId: agentBundle.sessionId,
        requiredSubstring: rememberToken,
        minMessages: 4,
      });
      expect(sessionMessages.length).toBeGreaterThanOrEqual(4);
      const assistantMessages = sessionMessages.filter((item) => item.role === 'assistant');
      expect(assistantMessages.some((item) => item.content?.includes(rememberToken))).toBe(true);
      expect(assistantMessages.at(-1)?.content?.includes(rememberToken)).toBe(true);
    } finally {
      await runner.stop();
    }
  });
});
