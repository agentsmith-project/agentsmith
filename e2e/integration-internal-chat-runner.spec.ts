import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createChatSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createInternalChatAgent,
  createProjectInWorkspace,
  ensureInternalChatRunnerImage,
  INTERNAL_CHAT_AGENT_IMAGE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  keycloakLoginToWorkspace,
  sanitizeWorkloadId,
  waitForWorkloadPodIdentity,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function resolveInternalSandboxNamespace(): string | null {
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) {
    return null;
  }
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) {
    return null;
  }
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  return namespace && namespace.length > 0 ? namespace : null;
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

async function runChatStreamTurn(
  page: Page,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  content: string,
): Promise<void> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/stream`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        input: {
          role: 'user',
          content,
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function listSessionMessages(
  page: Page,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<Array<{ role?: string; content?: string }>> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { items?: Array<{ role?: string; content?: string }> };
  return payload.items ?? [];
}

async function waitForAssistantToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  token: string;
}): Promise<Array<{ role?: string; content?: string }>> {
  let latest: Array<{ role?: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        latest = await listSessionMessages(args.page, args.workspaceId, args.projectId, args.sessionId);
        return latest.some((item) => item.role === 'assistant' && item.content?.includes(args.token));
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return latest;
}

test.describe('@lane-real internal chat runner integration', () => {
  test('starts one shared internal chat pod and keeps session transcripts isolated across sessions', async ({ page }) => {
    test.setTimeout(720_000);
    const namespace = resolveInternalSandboxNamespace();
    test.skip(!namespace, 'internal chat sandbox manager environment is not configured for this lane');
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Internal Chat Runner');
    const credentialName = `Internal Chat Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Internal Chat Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const image = await ensureInternalChatRunnerImage();
    expect(image).toBe(INTERNAL_CHAT_AGENT_IMAGE);

    const internalAgent = await createInternalChatAgent(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'internal-chat',
      image,
      idleTimeoutSec: 300,
      maxLifetimeSec: 1800,
    });

    const sessionOne = await createChatSessionViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `internal-chat-session-one-${Date.now()}`,
      externalAgentId: internalAgent.agentId,
    });
    const tokenOne = `INTERNAL_CHAT_ONE_${Date.now()}`;
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionOne.id,
      `Reply with the exact token ${tokenOne} and nothing else.`,
    );
    const sessionOneMessages = await waitForAssistantToken({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionOne.id,
      token: tokenOne,
    });

    const workloadId = sanitizeWorkloadId(internalAgent.agentId);
    const podOne = await waitForWorkloadPodIdentity({ namespace, workloadId, timeoutMs: 180_000 });

    const sessionTwo = await createChatSessionViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `internal-chat-session-two-${Date.now()}`,
      externalAgentId: internalAgent.agentId,
    });
    const tokenTwo = `INTERNAL_CHAT_TWO_${Date.now()}`;
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionTwo.id,
      `Reply with the exact token ${tokenTwo} and nothing else.`,
    );
    const sessionTwoMessages = await waitForAssistantToken({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionTwo.id,
      token: tokenTwo,
    });

    const podTwo = await waitForWorkloadPodIdentity({ namespace, workloadId, timeoutMs: 60_000 });
    expect(podTwo).toBe(podOne);

    expect(sessionOneMessages.some((item) => item.role === 'assistant' && item.content?.includes(tokenOne))).toBe(true);
    expect(sessionOneMessages.some((item) => item.role === 'assistant' && item.content?.includes(tokenTwo))).toBe(false);
    expect(sessionTwoMessages.some((item) => item.role === 'assistant' && item.content?.includes(tokenTwo))).toBe(true);
    expect(sessionTwoMessages.some((item) => item.role === 'assistant' && item.content?.includes(tokenOne))).toBe(false);
  });
});
