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
import {
  createInternalChatIsolationProbe,
  sessionHasInternalChatIsolationReply,
  type InternalChatIsolationProbe,
} from './internal-chat-isolation-probe';
import { readStoredAuthToken } from './integration-workspace-access';

const INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS = 240_000;

function requireInternalSandboxNamespace(): string {
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) {
    throw new Error('missing_SANDBOX_MANAGER_URL');
  }
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) {
    throw new Error('missing_SANDBOX_SERVICE_KEY');
  }
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  if (!namespace) {
    throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  }
  return namespace;
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
  options?: { timeoutMs?: number },
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
      ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
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

async function waitForAssistantIsolationReply(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  probe: InternalChatIsolationProbe;
}): Promise<Array<{ role?: string; content?: string }>> {
  let latest: Array<{ role?: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        latest = await listSessionMessages(args.page, args.workspaceId, args.projectId, args.sessionId);
        return sessionHasInternalChatIsolationReply(latest, args.probe);
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return latest;
}

test.describe('@lane-real internal chat runner integration', () => {
  test('starts a distinct internal chat pod per session and keeps session transcripts isolated across sessions', async ({ page }) => {
    test.setTimeout(720_000);
    const namespace = requireInternalSandboxNamespace();
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
    const sessionOneProbe = createInternalChatIsolationProbe('session-one');
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionOne.id,
      sessionOneProbe.prompt,
      { timeoutMs: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS },
    );
    const sessionOneMessages = await waitForAssistantIsolationReply({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionOne.id,
      probe: sessionOneProbe,
    });

    const workloadIdOne = sanitizeWorkloadId(sessionOne.id);
    const podOne = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadIdOne, timeoutMs: 180_000 });

    const sessionTwo = await createChatSessionViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: `internal-chat-session-two-${Date.now()}`,
      externalAgentId: internalAgent.agentId,
    });
    const sessionTwoProbe = createInternalChatIsolationProbe('session-two');
    await runChatStreamTurn(
      page,
      'ws_default',
      projectId,
      sessionTwo.id,
      sessionTwoProbe.prompt,
      { timeoutMs: INTERNAL_CHAT_STREAM_COLD_START_TIMEOUT_MS },
    );
    const sessionTwoMessages = await waitForAssistantIsolationReply({
      page,
      workspaceId: 'ws_default',
      projectId,
      sessionId: sessionTwo.id,
      probe: sessionTwoProbe,
    });

    const workloadIdTwo = sanitizeWorkloadId(sessionTwo.id);
    const podTwo = await waitForWorkloadPodIdentity({ namespace, workloadId: workloadIdTwo, timeoutMs: 180_000 });
    expect(podTwo.uid).not.toBe(podOne.uid);
    expect(podTwo.name).not.toBe(podOne.name);

    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionOneProbe)).toBe(true);
    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionTwoProbe)).toBe(false);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionTwoProbe)).toBe(true);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionOneProbe)).toBe(false);
  });
});
